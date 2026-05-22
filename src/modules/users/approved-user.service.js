const { ApprovedUser } = require('./approved-user.model');

function sanitizeString(value = '') {
  return String(value).trim().replace(/\s+/g, ' ');
}

function normalizeEmail(email = '') {
  return sanitizeString(email).toLowerCase();
}

function validateNameEmail({ name, email }) {
  const cleanName = sanitizeString(name);
  const cleanEmail = normalizeEmail(email);

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
  return { cleanName, cleanEmail };
}

function parseBulkApprovedUsers(rawText = '') {
  return String(rawText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split(/[;,\t|]/).map((item) => item.trim()).filter(Boolean);
      if (parts.length < 2) {
        const err = new Error(`Bulk row ${index + 1} must contain name and email.`);
        err.status = 400;
        throw err;
      }
      return { name: parts[0], email: parts[1] };
    });
}

async function listApprovedUsersForTenant({ tenantId, q = '', onlyActive = false } = {}) {
  const filter = { tenantId };
  if (onlyActive) filter.isActive = true;
  if (q) {
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: regex }, { email: regex }];
  }
  return ApprovedUser.find(filter).sort({ name: 1, email: 1 });
}

async function createApprovedUserForTenant({ tenantId, name, email, createdByUserId = null }) {
  const { cleanName, cleanEmail } = validateNameEmail({ name, email });
  const existing = await ApprovedUser.findOne({ tenantId, email: cleanEmail });
  if (existing) {
    if (!existing.isActive || existing.name !== cleanName) {
      existing.name = cleanName;
      existing.isActive = true;
      existing.createdByUserId = createdByUserId || existing.createdByUserId;
      await existing.save();
    }
    return { approvedUser: existing, created: false };
  }
  const approvedUser = await ApprovedUser.create({ tenantId, name: cleanName, email: cleanEmail, createdByUserId });
  return { approvedUser, created: true };
}

async function bulkCreateApprovedUsersForTenant({ tenantId, entries = [], createdByUserId = null }) {
  const results = [];
  for (const entry of entries) {
    const result = await createApprovedUserForTenant({ tenantId, name: entry.name, email: entry.email, createdByUserId });
    results.push(result);
  }
  return results;
}

async function getApprovedUserForTenantById({ tenantId, approvedUserId }) {
  const approvedUser = await ApprovedUser.findOne({ _id: approvedUserId, tenantId });
  if (!approvedUser) {
    const err = new Error('Approved user not found.');
    err.status = 404;
    throw err;
  }
  return approvedUser;
}

async function toggleApprovedUserForTenant({ tenantId, approvedUserId, isActive }) {
  const approvedUser = await getApprovedUserForTenantById({ tenantId, approvedUserId });
  approvedUser.isActive = Boolean(isActive);
  await approvedUser.save();
  return approvedUser;
}

async function linkApprovedUserToUser({ tenantId, email, userId }) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail) return null;
  const approvedUser = await ApprovedUser.findOne({ tenantId, email: cleanEmail });
  if (!approvedUser) return null;
  approvedUser.linkedUserId = userId;
  await approvedUser.save();
  return approvedUser;
}

module.exports = {
  parseBulkApprovedUsers,
  listApprovedUsersForTenant,
  createApprovedUserForTenant,
  bulkCreateApprovedUsersForTenant,
  getApprovedUserForTenantById,
  toggleApprovedUserForTenant,
  linkApprovedUserToUser
};
