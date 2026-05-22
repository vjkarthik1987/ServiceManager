const { testCloudinaryConnection, getConfig } = require('./cloudinary.service');

async function testConnection(req, res, next) {
  try {
    const result = await testCloudinaryConnection();
    return res.json(result);
  } catch (error) {
    return next(error);
  }
}

async function getCloudinaryConfig(req, res) {
  const config = getConfig();
  return res.json({
    storageProvider: process.env.STORAGE_PROVIDER || 'local',
    configured: config.isConfigured,
    cloudNamePresent: Boolean(config.cloudName),
    apiKeyPresent: Boolean(config.apiKey),
    apiSecretPresent: Boolean(config.apiSecret),
    rootFolder: config.rootFolder
  });
}

module.exports = { testConnection, getCloudinaryConfig };
