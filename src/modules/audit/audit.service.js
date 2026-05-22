const crypto = require('crypto');
const { AuditLog } = require('./audit.model');

async function logAudit({ tenantId, actorUserId, action, entityType, entityId, before = null, after = null }) {
  const immutableHash = crypto.createHash('sha256').update(JSON.stringify({ tenantId, actorUserId, action, entityType, entityId, before, after, at: new Date().toISOString().slice(0,19) })).digest('hex');
  return AuditLog.create({ tenantId, actorUserId, action, entityType, entityId, before, after, immutableHash });
}

module.exports = { logAudit };
