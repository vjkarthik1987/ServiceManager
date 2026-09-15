import crypto from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import { ServiceUser } from '../models/ServiceUser.js';
import { AdminUser } from '../models/AdminUser.js';
import { hashPassword } from '../password.js';

export const userRouter = express.Router();

const allowedRoles = new Set(['clientUser', 'partnerUser', 'agentUser', 'agentManager', 'engagementManager']);
const allowedLevels = new Set(['L1', 'L2', 'L3']);
const EMAIL_CHANGE_TTL_MS = 60 * 60 * 1000;

function oneTimeToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash, expiresAt: new Date(Date.now() + EMAIL_CHANGE_TTL_MS) };
}

function defaultLevelsForRole(role) {
  if (role === 'clientUser') return ['L1'];
  if (role === 'partnerUser') return ['L2'];
  return ['L3'];
}

function normalizeAssignments(body) {
  const incoming = Array.isArray(body.assignments) ? body.assignments : [];
  const seen = new Set();
  const assignments = [];

  incoming.forEach((item) => {
    const clientId = String(item?.clientId || '').trim();
    const role = String(item?.role || '').trim();
    if (!mongoose.Types.ObjectId.isValid(clientId) || !allowedRoles.has(role)) return;
    const key = `${clientId}:${role}`;
    if (seen.has(key)) return;
    seen.add(key);
    const levels = (Array.isArray(item.supportLevels) ? item.supportLevels : [])
      .map(String)
      .filter((level) => allowedLevels.has(level));
    assignments.push({
      clientId,
      role,
      includeChildren: item.includeChildren === true || item.includeChildren === 'true',
      supportLevels: levels.length ? [...new Set(levels)] : defaultLevelsForRole(role)
    });
  });

  return assignments;
}

function legacyAssignments(user) {
  if (user.assignments?.length) return user.assignments;
  const role = user.userType === 'client' ? 'clientUser' : (allowedRoles.has(user.userType) ? user.userType : 'agentUser');
  return (user.clientScopes || []).map((scope) => ({
    clientId: scope.clientId,
    role,
    includeChildren: scope.includeChildren,
    supportLevels: defaultLevelsForRole(role)
  }));
}

function publicUser(user) {
  const value = user.toObject ? user.toObject() : user;
  return { ...value, assignments: legacyAssignments(value) };
}

userRouter.get('/', async (req, res, next) => {
  try {
    const organizationId = req.query.organizationId;
    if (!mongoose.Types.ObjectId.isValid(organizationId)) {
      return res.status(400).json({ message: 'Valid organization id is required.' });
    }
    const users = await ServiceUser.find({ organizationId }).sort({ name: 1 });
    res.json({ users: users.map(publicUser) });
  } catch (error) {
    next(error);
  }
});

userRouter.post('/', async (req, res, next) => {
  try {
    const organizationId = req.body.organizationId;
    const name = req.body.name?.trim();
    const email = req.body.email?.trim().toLowerCase();
    const temporaryPassword = req.body.password || 'password';
    const assignments = normalizeAssignments(req.body);
    const allowEmptyAssignments = req.body.allowEmptyAssignments === true || req.body.allowEmptyAssignments === 'true';

    if (!mongoose.Types.ObjectId.isValid(organizationId)) return res.status(400).json({ message: 'Valid organization id is required.' });
    if (!name) return res.status(400).json({ message: 'User name is required.' });
    if (!email) return res.status(400).json({ message: 'User email is required.' });
    if (!assignments.length && !allowEmptyAssignments) return res.status(400).json({ message: 'At least one client assignment is required unless this identity is an organization administrator.' });

    const [existingUser, existingAdmin] = await Promise.all([
      ServiceUser.findOne({ organizationId, email }),
      AdminUser.findOne({ organizationId, email })
    ]);
    if (existingUser) return res.status(409).json({ message: 'This email is already used by another user in this tenant.' });
    // A tenant administrator may also have a ServiceUser record with the same email.
    // That is one identity with two access surfaces, not a cross-tenant conflict.

    const user = await ServiceUser.create({
      organizationId,
      name,
      email,
      assignments,
      passwordHash: hashPassword(temporaryPassword),
      status: req.body.status === 'inactive' ? 'inactive' : 'active',
      mustChangePassword: true
    });

    res.status(201).json({ user: publicUser(user), temporaryPassword });
  } catch (error) {
    next(error);
  }
});

userRouter.post('/:userId/email-change', async (req, res, next) => {
  try {
    const organizationId = String(req.body.organizationId || '');
    const newEmail = String(req.body.newEmail || '').trim().toLowerCase();
    if (!mongoose.Types.ObjectId.isValid(organizationId) || !mongoose.Types.ObjectId.isValid(req.params.userId)) {
      return res.status(400).json({ message: 'Valid organization and user ids are required.' });
    }
    if (!/.+@.+\..+/.test(newEmail)) return res.status(400).json({ message: 'Enter a valid new email address.' });
    const user = await ServiceUser.findOne({ _id: req.params.userId, organizationId });
    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (newEmail === user.email) return res.status(400).json({ message: 'The new email is the same as the current email.' });
    const [userConflict, adminConflict] = await Promise.all([
      ServiceUser.findOne({ organizationId, email: newEmail, _id: { $ne: user._id } }),
      AdminUser.findOne({ organizationId, email: newEmail })
    ]);
    if (userConflict || adminConflict) return res.status(409).json({ message: 'This email is already used by another identity in this tenant.' });
    const change = oneTimeToken();
    user.pendingEmail = newEmail;
    user.emailChangeTokenHash = change.hash;
    user.emailChangeTokenExpiresAt = change.expiresAt;
    await user.save();
    res.json({ accepted: true, userId: String(user._id), currentEmail: user.email, pendingEmail: newEmail, token: change.token, expiresAt: change.expiresAt, name: user.name });
  } catch (error) { next(error); }
});

userRouter.post('/:userId', async (req, res, next) => {
  try {
    const organizationId = req.body.organizationId;
    if (!mongoose.Types.ObjectId.isValid(organizationId) || !mongoose.Types.ObjectId.isValid(req.params.userId)) {
      return res.status(400).json({ message: 'Valid organization and user ids are required.' });
    }
    const user = await ServiceUser.findOne({ _id: req.params.userId, organizationId });
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const assignments = normalizeAssignments(req.body);
    const allowEmptyAssignments = req.body.allowEmptyAssignments === true || req.body.allowEmptyAssignments === 'true';
    if (!assignments.length && !allowEmptyAssignments) return res.status(400).json({ message: 'At least one client assignment is required unless this identity is an organization administrator.' });

    if (req.body.name?.trim()) user.name = req.body.name.trim();
    user.assignments = assignments;
    user.status = req.body.status === 'inactive' ? 'inactive' : 'active';
    if (req.body.password) {
      user.passwordHash = hashPassword(req.body.password);
      user.mustChangePassword = true;
    }
    await user.save();
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});
