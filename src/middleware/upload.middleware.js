const multer = require('multer');
const {
  allowedDefinitions,
  allowedMimeTypes,
  getFileDefinitionByExtension,
  getMaxSizeBytesForExtension,
  getExtensionFromFilename,
  maxPerFileBytes
} = require('../config/uploads');

const MAX_FILE_COUNT = Number(process.env.UPLOAD_MAX_FILE_COUNT || 5);
const zipContainerExtensions = new Set(['.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp']);
const textLikeExtensions = new Set(['.txt', '.log', '.md', '.xml', '.json', '.csv', '.svg', '.rtf', '.eml']);

function detectMimeFromBuffer(buffer, fallbackMimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return fallbackMimeType || 'application/octet-stream';

  if (buffer.slice(0, 4).equals(Buffer.from([0x25, 0x50, 0x44, 0x46]))) return 'application/pdf';
  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.slice(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.slice(0, 6).toString('ascii') === 'GIF87a' || buffer.slice(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (buffer.slice(0, 2).toString('ascii') === 'BM') return 'image/bmp';
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.slice(0, 2).equals(Buffer.from([0x50, 0x4b]))) return 'application/zip';
  if (buffer.slice(0, 6).equals(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]))) return 'application/x-rar-compressed';
  if (buffer.slice(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))) return 'application/x-7z-compressed';
  if (buffer.slice(0, 2).equals(Buffer.from([0x1f, 0x8b]))) return 'application/gzip';
  if (buffer.slice(0, 5).toString('utf8').toLowerCase() === '<?xml') return 'application/xml';
  if (buffer.slice(0, 15).toString('utf8').toLowerCase().includes('<svg')) return 'image/svg+xml';
  if (buffer.slice(0, 5).toString('ascii') === '{\\rtf') return 'application/rtf';

  const isLikelyText = buffer.slice(0, 64).every((byte) => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126));
  if (isLikelyText) return fallbackMimeType || 'text/plain';

  return fallbackMimeType || 'application/octet-stream';
}

function isMimeAllowedForExtension(extension, mimeType) {
  const definition = getFileDefinitionByExtension(extension);
  return !!definition && definition.mimeTypes.includes(mimeType);
}

function buildUploadMiddleware(fieldName) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxPerFileBytes,
      files: MAX_FILE_COUNT
    },
    fileFilter(req, file, cb) {
      const extension = getExtensionFromFilename(file.originalname);
      const definition = allowedDefinitions[extension];
      if (!definition) {
        const error = new Error('Unsupported file extension.');
        error.status = 400;
        return cb(error);
      }

      if (!allowedMimeTypes.has(file.mimetype) || !definition.mimeTypes.includes(file.mimetype)) {
        const error = new Error('Unsupported or mismatched attachment type.');
        error.status = 400;
        return cb(error);
      }

      return cb(null, true);
    }
  });

  return (req, res, next) => {
    upload.array(fieldName, MAX_FILE_COUNT)(req, res, (error) => {
      if (error) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          error.status = 400;
          error.message = `One of the attachments exceeded the platform maximum upload size of ${Math.round(maxPerFileBytes / (1024 * 1024))}MB.`;
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
          error.status = 400;
          error.message = `You can upload up to ${MAX_FILE_COUNT} attachments at a time.`;
        }
        return next(error);
      }

      try {
        for (const file of req.files || []) {
          const extension = getExtensionFromFilename(file.originalname);
          const definition = allowedDefinitions[extension];
          if (!definition) {
            const extensionError = new Error('Unsupported file extension.');
            extensionError.status = 400;
            throw extensionError;
          }

          const sizeLimitBytes = getMaxSizeBytesForExtension(extension, definition);
          if ((file.size || 0) > sizeLimitBytes) {
            const sizeError = new Error(`File ${file.originalname} exceeds the ${Number((sizeLimitBytes / (1024 * 1024)).toFixed(1))}MB limit for ${extension} files.`);
            sizeError.status = 400;
            throw sizeError;
          }

          const detectedMimeType = detectMimeFromBuffer(file.buffer, file.mimetype);
          const declaredMimeType = file.mimetype;

          const declaredAllowed = isMimeAllowedForExtension(extension, declaredMimeType);
          if (!declaredAllowed) {
            const mimeError = new Error('Unsupported or mismatched attachment type.');
            mimeError.status = 400;
            throw mimeError;
          }

          const detectedAllowed = isMimeAllowedForExtension(extension, detectedMimeType);
          const zipContainerAllowed = zipContainerExtensions.has(extension) && detectedMimeType === 'application/zip';
          const textLikeAllowed = textLikeExtensions.has(extension) && (
            detectedMimeType === declaredMimeType ||
            detectedMimeType === 'text/plain' ||
            detectedMimeType === 'application/octet-stream'
          );
          const octetStreamAllowed = declaredMimeType === 'application/octet-stream';

          if (!detectedAllowed && !zipContainerAllowed && !textLikeAllowed && !octetStreamAllowed) {
            const mimeError = new Error('Attachment content does not match the declared file type.');
            mimeError.status = 400;
            throw mimeError;
          }

          file.detectedMimeType = detectedAllowed || zipContainerAllowed || textLikeAllowed
            ? detectedMimeType
            : declaredMimeType;
          file.maxSizeBytes = sizeLimitBytes;
          file.uploadCategory = definition.category;
        }
        return next();
      } catch (validationError) {
        return next(validationError);
      }
    });
  };
}

module.exports = {
  uploadAttachments: buildUploadMiddleware,
  MAX_FILE_COUNT,
  MAX_FILE_SIZE_BYTES: maxPerFileBytes,
  detectMimeFromBuffer
};
