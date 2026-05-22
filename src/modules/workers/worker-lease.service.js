const crypto = require('crypto');
const { WorkerLease } = require('./worker-lease.model');

const ownerId = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;

async function acquireLease(name, ttlMs = 30000) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const existing = await WorkerLease.findOneAndUpdate(
    {
      name,
      $or: [
        { expiresAt: { $lte: now } },
        { ownerId }
      ]
    },
    { $set: { name, ownerId, expiresAt } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).catch(async (error) => {
    if (error?.code !== 11000) throw error;
    return WorkerLease.findOne({ name });
  });
  return !!existing && existing.ownerId === ownerId;
}

async function renewLease(name, ttlMs = 30000) {
  const expiresAt = new Date(Date.now() + ttlMs);
  const updated = await WorkerLease.findOneAndUpdate({ name, ownerId }, { $set: { expiresAt } }, { new: true });
  return !!updated;
}

async function releaseLease(name) {
  return WorkerLease.deleteOne({ name, ownerId });
}

function getWorkerOwnerId() {
  return ownerId;
}

module.exports = { acquireLease, renewLease, releaseLease, getWorkerOwnerId };
