const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { User } = require('./user.model');
const { createMembershipsForNewUser, getMembershipsForUser } = require('../memberships/membership.service');
const { sendNewUserProvisioningEmail, sendForgotPasswordEmail } = require('./user-provisioning.service');

function sanitizeString(value = '') {
  return String(value).trim().replace(/\s+/g, ' ');
}

function normalizeEmail(email = '') {
  return sanitizeString(email).toLowerCase();
}

function validateRole(role) {
  if (!['superadmin', 'agent', 'client'].includes(role)) {
    const err = new Error('Role must be superadmin, agent, or client.');
    err.status = 400;
    throw err;
  }
}

async function createUserForTenant({ tenantId, tenant = null, name, email, password, role, entityId, entityIds = [], createdByUser = null, sendProvisioningEmail = true }) {
  const cleanName = sanitizeString(name);
  const cleanEmail = normalizeEmail(email);
  const cleanPassword = String(password || '');

  if (!cleanName) {
    const err = new Error('Name is required.');
    err.status = 400;
    throw err;
  }

  if (!cleanEmail) {
    const err = new Error('Email is required.');
    err.status = 400;
    throw err;
  }

  if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
    const err = new Error('A valid email address is required.');
    err.status = 400;
    throw err;
  }

  if (cleanPassword.length < 8) {
    const err = new Error('Password must be at least 8 characters long.');
    err.status = 400;
    throw err;
  }

  validateRole(role);

  const existing = await User.findOne({ tenantId, email: cleanEmail });
  if (existing) {
    const err = new Error('A user with this email already exists.');
    err.status = 409;
    throw err;
  }

  const passwordHash = await bcrypt.hash(cleanPassword, 10);
  const user = await User.create({
    tenantId,
    name: cleanName,
    email: cleanEmail,
    passwordHash,
    role,
    isActive: true
  });

  await createMembershipsForNewUser({ tenantId, user, role, entityId, entityIds });

  let provisioningEmail = { delivered: false, skipped: true, reason: 'disabled' };
  if (sendProvisioningEmail) {
    provisioningEmail = await sendNewUserProvisioningEmail({ tenant, user, password: cleanPassword, createdByUser });
  }

  return { user, provisioningEmail };
}




async function requestPasswordResetForTenant({ tenant, email }) {
  const cleanEmail = normalizeEmail(email);
  const generic = { delivered: true, maskedEmail: cleanEmail ? cleanEmail.replace(/(^.).*(@.*$)/, '$1***$2') : '' };

  if (!tenant?._id || !cleanEmail) return generic;

  const user = await User.findOne({ tenantId: tenant._id, email: cleanEmail, isActive: true });
  if (!user) return generic;

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  user.resetPasswordTokenHash = tokenHash;
  user.resetPasswordExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await user.save();

  const resetUrl = `${process.env.APP_BASE_URL || 'http://localhost:3000'}/${tenant.slug}/reset-password/${rawToken}`;
  const mailResult = await sendForgotPasswordEmail({ tenant, user, resetUrl });
  return { ...generic, mailResult };
}

async function resetPasswordWithTokenForTenant({ tenantId, token, newPassword }) {
  const rawToken = String(token || '').trim();
  const nextPassword = String(newPassword || '');
  if (!rawToken) {
    const err = new Error('Reset token is required.');
    err.status = 400;
    throw err;
  }
  if (nextPassword.length < 8) {
    const err = new Error('New password must be at least 8 characters long.');
    err.status = 400;
    throw err;
  }

  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const user = await User.findOne({
    tenantId,
    resetPasswordTokenHash: tokenHash,
    resetPasswordExpiresAt: { $gt: new Date() },
    isActive: true
  });

  if (!user) {
    const err = new Error('Reset link is invalid or has expired.');
    err.status = 400;
    throw err;
  }

  user.passwordHash = await bcrypt.hash(nextPassword, 10);
  user.resetPasswordTokenHash = '';
  user.resetPasswordExpiresAt = null;
  await user.save();
  return user;
}

async function listUsersForTenant(tenantId, role = null) {
  const filter = { tenantId };
  if (role) filter.role = role;
  const users = await User.find(filter).sort({ createdAt: -1 });
  const hydrated = [];
  for (const user of users) {
    const memberships = await getMembershipsForUser({ tenantId, userId: user._id, status: 'active' });
    hydrated.push({ user, memberships });
  }
  return hydrated;
}

async function updateUserForTenant({ tenantId, userId, updates = {} }) {
  const user = await User.findOne({ _id: userId, tenantId });
  if (!user) { const err = new Error('User not found.'); err.status = 404; throw err; }
  if (updates.name !== undefined) {
    const cleanName = sanitizeString(updates.name);
    if (!cleanName) { const err = new Error('Name is required.'); err.status = 400; throw err; }
    user.name = cleanName;
  }
  if (updates.email !== undefined) {
    const cleanEmail = normalizeEmail(updates.email);
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) { const err = new Error('A valid email address is required.'); err.status = 400; throw err; }
    const existing = await User.findOne({ tenantId, email: cleanEmail, _id: { $ne: user._id } });
    if (existing) { const err = new Error('A user with this email already exists.'); err.status = 409; throw err; }
    user.email = cleanEmail;
  }
  if (updates.role !== undefined) { validateRole(updates.role); user.role = updates.role; }
  if (updates.isActive !== undefined) user.isActive = Boolean(updates.isActive);
  if (updates.password) {
    const cleanPassword = String(updates.password || '');
    if (cleanPassword.length < 8) { const err = new Error('Password must be at least 8 characters long.'); err.status = 400; throw err; }
    user.passwordHash = await bcrypt.hash(cleanPassword, 10);
  }
  await user.save();
  return user;
}


async function changePasswordForUser({ tenantId, userId, currentPassword, newPassword }) {
  const user = await User.findOne({ _id: userId, tenantId });
  if (!user) {
    const err = new Error('User not found.');
    err.status = 404;
    throw err;
  }

  const current = String(currentPassword || '');
  const nextPassword = String(newPassword || '');

  const matches = await bcrypt.compare(current, user.passwordHash);
  if (!matches) {
    const err = new Error('Current password is incorrect.');
    err.status = 400;
    throw err;
  }

  if (nextPassword.length < 8) {
    const err = new Error('New password must be at least 8 characters long.');
    err.status = 400;
    throw err;
  }

  if (current === nextPassword) {
    const err = new Error('New password must be different from the current password.');
    err.status = 400;
    throw err;
  }

  user.passwordHash = await bcrypt.hash(nextPassword, 10);
  await user.save();
  return user;
}

module.exports = { createUserForTenant, listUsersForTenant, updateUserForTenant, changePasswordForUser, requestPasswordResetForTenant, resetPasswordWithTokenForTenant }; 
