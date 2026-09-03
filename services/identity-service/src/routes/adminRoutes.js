import crypto from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import { AdminUser } from '../models/AdminUser.js';
import { ServiceUser } from '../models/ServiceUser.js';
import { hashPassword } from '../password.js';

export const adminRouter = express.Router();

const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1000;
const EMAIL_CHANGE_TTL_MS = 60 * 60 * 1000;

function oneTimeToken(ttlMs = ACTIVATION_TTL_MS) {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash, expiresAt: new Date(Date.now() + ttlMs) };
}

function activationToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash, expiresAt: new Date(Date.now() + ACTIVATION_TTL_MS) };
}

adminRouter.post('/', async (req, res, next) => {
  try {
    const organizationId = req.body.organizationId;
    const name = req.body.name?.trim();
    const email = req.body.email?.trim().toLowerCase();
    const role = req.body.role || 'owner';
    const temporaryPassword = req.body.password || crypto.randomBytes(18).toString('base64url');
    const requestedStatus = req.body.status === 'pending' ? 'pending' : (req.body.status === 'inactive' ? 'inactive' : 'active');
    const issueActivationToken = req.body.issueActivationToken === true || req.body.issueActivationToken === 'true';

    if (!mongoose.Types.ObjectId.isValid(organizationId)) {
      return res.status(400).json({ message: 'Valid organization id is required.' });
    }

    if (!name) return res.status(400).json({ message: 'Admin name is required.' });
    if (!email) return res.status(400).json({ message: 'Admin email is required.' });

    const [existing, existingServiceUser] = await Promise.all([
      AdminUser.findOne({ organizationId, email }),
      ServiceUser.findOne({ organizationId, email })
    ]);
    if (existing) {
      existing.name = name;
      existing.role = role;
      if (!existing.passwordHash) existing.passwordHash = hashPassword(temporaryPassword);
      if (requestedStatus === 'pending' && existing.status !== 'active') existing.status = 'pending';
      let rawActivationToken = '';
      let activationExpiresAt = null;
      if (issueActivationToken && existing.status === 'pending') {
        const activation = activationToken();
        existing.activationTokenHash = activation.hash;
        existing.activationTokenExpiresAt = activation.expiresAt;
        rawActivationToken = activation.token;
        activationExpiresAt = activation.expiresAt;
      }
      await existing.save();
      return res.status(200).json({ admin: existing, alreadyExisted: true, activationToken: rawActivationToken, activationExpiresAt });
    }

    const activation = issueActivationToken && requestedStatus === 'pending' ? activationToken() : null;
    const admin = await AdminUser.create({
      organizationId,
      name,
      email,
      role,
      passwordHash: hashPassword(temporaryPassword),
      mustChangePassword: requestedStatus !== 'pending',
      status: requestedStatus,
      activationTokenHash: activation?.hash || '',
      activationTokenExpiresAt: activation?.expiresAt || null
    });
    res.status(201).json({ admin, activationToken: activation?.token || '', activationExpiresAt: activation?.expiresAt || null });
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/email-availability', async (req, res, next) => {
  try {
    const email = String(req.query.email || '').trim().toLowerCase();
    const excludeAdminId = String(req.query.excludeAdminId || '').trim();
    const organizationId = String(req.query.organizationId || '').trim();
    if (!email) return res.status(400).json({ message: 'Email is required.' });
    const scope = mongoose.Types.ObjectId.isValid(organizationId) ? { organizationId } : {};
    const [admin, user] = await Promise.all([AdminUser.findOne({ ...scope, email }), ServiceUser.findOne({ ...scope, email })]);
    const adminConflict = admin && (!excludeAdminId || String(admin._id) !== excludeAdminId);
    res.json({ available: !adminConflict && !user, email });
  } catch (error) { next(error); }
});

adminRouter.post('/:adminId/email-change', async (req, res, next) => {
  try {
    const organizationId = String(req.body.organizationId || '');
    const newEmail = String(req.body.newEmail || '').trim().toLowerCase();
    if (!mongoose.Types.ObjectId.isValid(organizationId) || !mongoose.Types.ObjectId.isValid(req.params.adminId)) return res.status(400).json({ message: 'Valid organization and administrator ids are required.' });
    if (!/.+@.+\..+/.test(newEmail)) return res.status(400).json({ message: 'Enter a valid new email address.' });
    const admin = await AdminUser.findOne({ _id: req.params.adminId, organizationId });
    if (!admin) return res.status(404).json({ message: 'Administrator not found.' });
    if (newEmail === admin.email) return res.status(400).json({ message: 'The new email is the same as the current email.' });
    const [adminConflict, userConflict] = await Promise.all([AdminUser.findOne({ organizationId, email: newEmail, _id: { $ne: admin._id } }), ServiceUser.findOne({ organizationId, email: newEmail })]);
    if (adminConflict || userConflict) return res.status(409).json({ message: 'This email is already used by another Service Desk account.' });
    const change = oneTimeToken(EMAIL_CHANGE_TTL_MS);
    admin.pendingEmail = newEmail;
    admin.emailChangeTokenHash = change.hash;
    admin.emailChangeTokenExpiresAt = change.expiresAt;
    await admin.save();
    res.json({ accepted: true, adminId: String(admin._id), currentEmail: admin.email, pendingEmail: newEmail, token: change.token, expiresAt: change.expiresAt, name: admin.name });
  } catch (error) { next(error); }
});

adminRouter.get('/', async (req, res, next) => {
  try {
    const organizationId = req.query.organizationId;
    if (!mongoose.Types.ObjectId.isValid(organizationId)) {
      return res.status(400).json({ message: 'Valid organization id is required.' });
    }

    const admins = await AdminUser.find({ organizationId }).sort({ createdAt: 1 });
    res.json({ admins });
  } catch (error) {
    next(error);
  }
});
