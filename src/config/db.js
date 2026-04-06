const mongoose = require('mongoose');

async function normalizeLegacyIndexes() {
  const issueCollection = mongoose.connection.collection('issues');
  const issueIndexes = await issueCollection.indexes().catch(() => []);
  const hasLegacyGlobalIssueNumberIndex = issueIndexes.some((index) => index.name === 'issueNumber_1' && index.unique);

  if (hasLegacyGlobalIssueNumberIndex) {
    await issueCollection.dropIndex('issueNumber_1').catch(() => null);
  }

  const issueCounterCollection = mongoose.connection.collection('issuecounters');
  const issueCounterIndexes = await issueCounterCollection.indexes().catch(() => []);
  const hasLegacyTenantOnlyUniqueIndex = issueCounterIndexes.some(
    (index) => index.name === 'tenantId_1' && index.unique
  );

  if (hasLegacyTenantOnlyUniqueIndex) {
    await issueCounterCollection.dropIndex('tenantId_1').catch(() => null);
  }

  const hasCompositeTenantEntityUniqueIndex = issueCounterIndexes.some(
    (index) => index.name === 'tenantId_1_entityId_1' && index.unique
  );

  if (!hasCompositeTenantEntityUniqueIndex) {
    await issueCounterCollection.createIndex({ tenantId: 1, entityId: 1 }, { unique: true }).catch(() => null);
  }
}

async function connectDb() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/esop_v6';
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  await normalizeLegacyIndexes();
  console.log('MongoDB connected');
}

module.exports = { connectDb };
