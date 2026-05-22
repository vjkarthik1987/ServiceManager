const { testSharePointConnection, getConfig } = require('./sharepoint.service');

async function testConnection(req, res, next) {
  try {
    const result = await testSharePointConnection();
    return res.json(result);
  } catch (error) {
    return next(error);
  }
}

async function getSharePointConfig(req, res) {
  const config = getConfig();
  return res.json({
    storageProvider: process.env.STORAGE_PROVIDER || 'local',
    configured: Boolean(config.tenantId && config.clientId && config.clientSecret && config.driveId),
    tenantIdPresent: Boolean(config.tenantId),
    clientIdPresent: Boolean(config.clientId),
    clientSecretPresent: Boolean(config.clientSecret),
    siteIdPresent: Boolean(config.siteId),
    driveIdPresent: Boolean(config.driveId),
    rootFolder: config.rootFolder
  });
}

module.exports = { testConnection, getSharePointConfig };
