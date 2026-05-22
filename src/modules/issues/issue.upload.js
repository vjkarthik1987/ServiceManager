const { uploadAttachments } = require('../../middleware/upload.middleware');

function optionalFiles(fieldName) {
  return uploadAttachments(fieldName);
}

module.exports = {
  optionalFiles
};
