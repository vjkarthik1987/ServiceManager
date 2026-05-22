const router = require('express').Router({ mergeParams: true });
const { testConnection, getCloudinaryConfig } = require('./cloudinary.controller');

router.get('/config', getCloudinaryConfig);
router.post('/test', testConnection);

module.exports = router;
