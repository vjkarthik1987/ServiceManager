
const router = require('express').Router({ mergeParams: true });
const { downloadFile, previewFile } = require('./file.controller');
router.get('/:fileId/download', downloadFile);
router.get('/:fileId/preview', previewFile);
module.exports = router;
