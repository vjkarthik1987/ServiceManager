import crypto from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import { AdminUser } from '../models/AdminUser.js';
import { ServiceUser } from '../models/ServiceUser.js';
import { hashPassword, verifyPassword } from '../password.js';

export const authRouter = express.Router();

const clientRoles = new Set(['clientUser']);
const agentRoles = new Set(['partnerUser', 'agentUser', 'agentManager', 'engagementManager']);
const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;

function defaultLevelsForRole(role) {
  if (role === 'clientUser') return ['L1'];
  if (role === 'partnerUser') return ['L2'];
  return ['L3'];
}

function normalizedAssignments(user) {
  if (user.assignments?.length) return user.assignments;
  const role = user.userType === 'client' ? 'clientUser' : (user.userType || 'agentUser');
  return (user.clientScopes || []).map((scope) => ({
    clientId: scope.clientId,
    role,
    includeChildren: scope.includeChildren,
    supportLevels: defaultLevelsForRole(role)
  }));
}

function publicAdmin(admin) {
  return {
    _id: admin._id,
    organizationId: admin.organizationId,
    name: admin.name,
    email: admin.email,
    userType: 'organizationAdmin',
    role: admin.role,
    status: admin.status,
    assignments: [],
    mustChangePassword: admin.mustChangePassword
  };
}

function publicUser(user) {
  return {
    _id: user._id,
    organizationId: user.organizationId,
    name: user.name,
    email: user.email,
    userType: 'serviceUser',
    status: user.status,
    assignments: normalizedAssignments(user),
    mustChangePassword: user.mustChangePassword
  };
}

function hasPortalRole(user, portal) {
  const roles = new Set(normalizedAssignments(user).map((item) => item.role));
  if (portal === 'client') return [...roles].some((role) => clientRoles.has(role));
  if (portal === 'agent') return [...roles].some((role) => agentRoles.has(role));
  return false;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

function validPassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

async function findActivationAdmin(token) {
  const hash = tokenHash(token);
  if (!token || !hash) return null;
  return AdminUser.findOne({
    status: 'pending',
    activationTokenHash: hash,
    activationTokenExpiresAt: { $gt: new Date() }
  });
}

async function findResetAccount(token) {
  const hash = tokenHash(token);
  if (!token || !hash) return null;
  const now = new Date();
  const admin = await AdminUser.findOne({ status: 'active', resetTokenHash: hash, resetTokenExpiresAt: { $gt: now } });
  if (admin) return { accountType: 'admin', account: admin };
  const user = await ServiceUser.findOne({ status: 'active', resetTokenHash: hash, resetTokenExpiresAt: { $gt: now } });
  return user ? { accountType: 'user', account: user } : null;
}

authRouter.post('/login', async (req, res, next) => {
  try {
    const portal = String(req.body.portal || '').trim();
    const email = req.body.email?.trim().toLowerCase();
    const password = String(req.body.password || '');
    const organizationId = req.body.organizationId ? String(req.body.organizationId) : '';

    if (!['admin', 'tenant', 'client', 'agent'].includes(portal)) return res.status(400).json({ message: 'Valid portal is required.' });
    if (!email) return res.status(400).json({ message: 'Email is required.' });
    if (!password) return res.status(400).json({ message: 'Password is required.' });

    if (portal === 'admin') {
      const adminQuery = { email, status: 'active' };
      if (organizationId) adminQuery.organizationId = organizationId;
      const admins = await AdminUser.find(adminQuery).limit(2);
      if (admins.length !== 1) return res.status(401).json({ message: admins.length > 1 ? 'Multiple admin accounts use this email for this tenant. Contact support.' : 'Invalid tenant, email or password.' });
      const admin = admins[0];
      if (!admin.passwordHash && password === 'password') {
        admin.passwordHash = hashPassword('password');
        admin.mustChangePassword = true;
        await admin.save();
      }
      if (!verifyPassword(password, admin.passwordHash)) return res.status(401).json({ message: 'Invalid email or password.' });
      return res.json({ actor: publicAdmin(admin), portal, organizationId: admin.organizationId });
    }

    const userQuery = { email, status: 'active' };
    if (organizationId) userQuery.organizationId = organizationId;
    const users = await ServiceUser.find(userQuery).limit(2);
    if (users.length !== 1) return res.status(401).json({ message: users.length > 1 ? 'Multiple accounts use this email for this tenant. Contact your administrator.' : 'Invalid tenant, email or password.' });
    const user = users[0];
    if (portal === 'tenant') {
      const roles = new Set(normalizedAssignments(user).map((item) => item.role));
      const hasTenantRole = [...roles].some((role) => clientRoles.has(role) || agentRoles.has(role));
      if (!hasTenantRole) return res.status(403).json({ message: 'This account has no tenant portal assignment.' });
    } else if (!hasPortalRole(user, portal)) {
      return res.status(403).json({ message: `This account has no ${portal} portal assignment.` });
    }
    if (!verifyPassword(password, user.passwordHash)) return res.status(401).json({ message: 'Invalid email or password.' });
    res.json({ actor: publicUser(user), portal, organizationId: user.organizationId });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/activation/validate', async (req, res, next) => {
  try {
    const admin = await findActivationAdmin(req.body.token);
    if (!admin) return res.status(400).json({ message: 'This activation link is invalid or has expired.' });
    res.json({ valid: true, admin: publicAdmin(admin), organizationId: admin.organizationId });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/activation/complete', async (req, res, next) => {
  try {
    const password = String(req.body.password || '');
    if (!validPassword(password)) return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    const admin = await findActivationAdmin(req.body.token);
    if (!admin) return res.status(400).json({ message: 'This activation link is invalid or has expired.' });
    admin.passwordHash = hashPassword(password);
    admin.mustChangePassword = false;
    admin.status = 'active';
    admin.activatedAt = new Date();
    admin.activationTokenHash = '';
    admin.activationTokenExpiresAt = null;
    await admin.save();
    res.json({ activated: true, admin: publicAdmin(admin), organizationId: admin.organizationId });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/email-change/validate', async (req, res, next) => {
  try {
    const token = String(req.body.token || '');
    const hash = tokenHash(token);
    const now = new Date();
    const admin = await AdminUser.findOne({ emailChangeTokenHash: hash, emailChangeTokenExpiresAt: { $gt: now }, pendingEmail: { $ne: '' } });
    if (admin) return res.json({ valid: true, accountType: 'admin', organizationId: admin.organizationId, account: { _id: admin._id, name: admin.name, email: admin.email, pendingEmail: admin.pendingEmail } });
    const user = await ServiceUser.findOne({ emailChangeTokenHash: hash, emailChangeTokenExpiresAt: { $gt: now }, pendingEmail: { $ne: '' } });
    if (user) return res.json({ valid: true, accountType: 'user', organizationId: user.organizationId, account: { _id: user._id, name: user.name, email: user.email, pendingEmail: user.pendingEmail } });
    return res.status(400).json({ message: 'This email verification link is invalid or has expired.' });
  } catch (error) { next(error); }
});

authRouter.post('/email-change/complete', async (req, res, next) => {
  try {
    const token = String(req.body.token || '');
    const hash = tokenHash(token);
    const now = new Date();
    let accountType = 'admin';
    let account = await AdminUser.findOne({ emailChangeTokenHash: hash, emailChangeTokenExpiresAt: { $gt: now }, pendingEmail: { $ne: '' } });
    if (!account) {
      accountType = 'user';
      account = await ServiceUser.findOne({ emailChangeTokenHash: hash, emailChangeTokenExpiresAt: { $gt: now }, pendingEmail: { $ne: '' } });
    }
    if (!account) return res.status(400).json({ message: 'This email verification link is invalid or has expired.' });

    const organizationId = account.organizationId;
    const newEmail = account.pendingEmail;
    const oldEmail = account.email;
    if (accountType === 'admin') {
      const [adminConflict, userConflict] = await Promise.all([
        AdminUser.findOne({ organizationId, email: newEmail, _id: { $ne: account._id } }),
        ServiceUser.findOne({ organizationId, email: newEmail })
      ]);
      if (adminConflict || userConflict) return res.status(409).json({ message: 'This email is already used by another identity in this tenant.' });
      account.email = newEmail;
      account.pendingEmail = '';
      account.emailChangeTokenHash = '';
      account.emailChangeTokenExpiresAt = null;
      await account.save();
      // If this tenant admin also has an operational ServiceUser identity, keep both login surfaces aligned.
      await ServiceUser.updateMany({ organizationId, email: oldEmail }, { $set: { email: newEmail } });
    } else {
      const [userConflict, adminConflict] = await Promise.all([
        ServiceUser.findOne({ organizationId, email: newEmail, _id: { $ne: account._id } }),
        AdminUser.findOne({ organizationId, email: newEmail })
      ]);
      if (userConflict || adminConflict) return res.status(409).json({ message: 'This email is already used by another identity in this tenant.' });
      account.email = newEmail;
      account.pendingEmail = '';
      account.emailChangeTokenHash = '';
      account.emailChangeTokenExpiresAt = null;
      await account.save();
      await AdminUser.updateMany({ organizationId, email: oldEmail }, { $set: { email: newEmail } });
    }
    res.json({ changed: true, accountType, organizationId, accountId: account._id, name: account.name, oldEmail, newEmail });
  } catch (error) { next(error); }
});

authRouter.post('/password/forgot', async (req, res, next) => {
  try {
    const organizationId = String(req.body.organizationId || '');
    const email = String(req.body.email || '').trim().toLowerCase();
    const portal = String(req.body.portal || 'tenant').trim().toLowerCase();
    if (!mongoose.Types.ObjectId.isValid(organizationId) || !email) {
      return res.json({ accepted: true, message: 'If the account exists, a reset link will be sent.' });
    }

    const token = newToken();
    const hash = tokenHash(token);
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);
    let account = null;
    let accountType = '';

    if (portal === 'admin') {
      account = await AdminUser.findOne({ organizationId, email, status: 'active' });
      accountType = 'admin';
    } else {
      account = await ServiceUser.findOne({ organizationId, email, status: 'active' });
      accountType = 'user';
    }

    if (account) {
      account.resetTokenHash = hash;
      account.resetTokenExpiresAt = expiresAt;
      await account.save();
    }

    res.json({
      accepted: true,
      message: 'If the account exists, a reset link will be sent.',
      ...(account ? { resetToken: token, accountType, organizationId, email: account.email, name: account.name, expiresAt } : {})
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/password/reset/validate', async (req, res, next) => {
  try {
    const found = await findResetAccount(req.body.token);
    if (!found) return res.status(400).json({ message: 'This password reset link is invalid or has expired.' });
    res.json({
      valid: true,
      accountType: found.accountType,
      organizationId: found.account.organizationId,
      email: found.account.email,
      name: found.account.name
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/password/reset', async (req, res, next) => {
  try {
    const password = String(req.body.password || '');
    if (!validPassword(password)) return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    const found = await findResetAccount(req.body.token);
    if (!found) return res.status(400).json({ message: 'This password reset link is invalid or has expired.' });
    found.account.passwordHash = hashPassword(password);
    found.account.mustChangePassword = false;
    found.account.resetTokenHash = '';
    found.account.resetTokenExpiresAt = null;
    await found.account.save();
    res.json({ reset: true, accountType: found.accountType, organizationId: found.account.organizationId });
  } catch (error) {
    next(error);
  }
});
