const path = require('path');

const FILE_TYPE_DEFINITIONS = {
  '.png': { mimeTypes: ['image/png'], category: 'image', previewKind: 'image', defaultMaxSizeBytes: 5 * 1024 * 1024 },
  '.jpg': { mimeTypes: ['image/jpeg'], category: 'image', previewKind: 'image', defaultMaxSizeBytes: 5 * 1024 * 1024 },
  '.jpeg': { mimeTypes: ['image/jpeg'], category: 'image', previewKind: 'image', defaultMaxSizeBytes: 5 * 1024 * 1024 },
  '.webp': { mimeTypes: ['image/webp'], category: 'image', previewKind: 'image', defaultMaxSizeBytes: 5 * 1024 * 1024 },
  '.gif': { mimeTypes: ['image/gif'], category: 'image', previewKind: 'image', defaultMaxSizeBytes: 5 * 1024 * 1024 },
  '.bmp': { mimeTypes: ['image/bmp'], category: 'image', previewKind: 'image', defaultMaxSizeBytes: 5 * 1024 * 1024 },
  '.svg': { mimeTypes: ['image/svg+xml', 'text/xml', 'application/xml', 'text/plain'], category: 'image', previewKind: 'image', defaultMaxSizeBytes: 2 * 1024 * 1024 },
  '.pdf': { mimeTypes: ['application/pdf'], category: 'pdf', previewKind: 'pdf', defaultMaxSizeBytes: 15 * 1024 * 1024 },
  '.txt': { mimeTypes: ['text/plain', 'application/octet-stream'], category: 'text', previewKind: null, defaultMaxSizeBytes: 2 * 1024 * 1024 },
  '.log': { mimeTypes: ['text/plain', 'application/octet-stream'], category: 'text', previewKind: null, defaultMaxSizeBytes: 2 * 1024 * 1024 },
  '.md': { mimeTypes: ['text/markdown', 'text/plain', 'application/octet-stream'], category: 'text', previewKind: null, defaultMaxSizeBytes: 2 * 1024 * 1024 },
  '.xml': { mimeTypes: ['text/xml', 'application/xml', 'text/plain', 'application/octet-stream'], category: 'data', previewKind: null, defaultMaxSizeBytes: 2 * 1024 * 1024 },
  '.json': { mimeTypes: ['application/json', 'text/plain', 'application/octet-stream'], category: 'data', previewKind: null, defaultMaxSizeBytes: 2 * 1024 * 1024 },
  '.csv': { mimeTypes: ['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream'], category: 'data', previewKind: null, defaultMaxSizeBytes: 3 * 1024 * 1024 },
  '.zip': { mimeTypes: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], category: 'archive', previewKind: null, defaultMaxSizeBytes: 20 * 1024 * 1024 },
  '.rar': { mimeTypes: ['application/x-rar-compressed', 'application/vnd.rar', 'application/octet-stream'], category: 'archive', previewKind: null, defaultMaxSizeBytes: 20 * 1024 * 1024 },
  '.7z': { mimeTypes: ['application/x-7z-compressed', 'application/octet-stream'], category: 'archive', previewKind: null, defaultMaxSizeBytes: 20 * 1024 * 1024 },
  '.gz': { mimeTypes: ['application/gzip', 'application/x-gzip', 'application/octet-stream'], category: 'archive', previewKind: null, defaultMaxSizeBytes: 20 * 1024 * 1024 },
  '.doc': { mimeTypes: ['application/msword', 'application/octet-stream'], category: 'office', previewKind: null, defaultMaxSizeBytes: 10 * 1024 * 1024 },
  '.docx': { mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream'], category: 'office', previewKind: null, defaultMaxSizeBytes: 10 * 1024 * 1024 },
  '.rtf': { mimeTypes: ['application/rtf', 'text/rtf', 'text/plain', 'application/octet-stream'], category: 'office', previewKind: null, defaultMaxSizeBytes: 5 * 1024 * 1024 },
  '.xls': { mimeTypes: ['application/vnd.ms-excel', 'application/octet-stream'], category: 'office', previewKind: null, defaultMaxSizeBytes: 10 * 1024 * 1024 },
  '.xlsx': { mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream'], category: 'office', previewKind: null, defaultMaxSizeBytes: 10 * 1024 * 1024 },
  '.ppt': { mimeTypes: ['application/vnd.ms-powerpoint', 'application/octet-stream'], category: 'office', previewKind: null, defaultMaxSizeBytes: 15 * 1024 * 1024 },
  '.pptx': { mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream'], category: 'office', previewKind: null, defaultMaxSizeBytes: 15 * 1024 * 1024 },
  '.odt': { mimeTypes: ['application/vnd.oasis.opendocument.text', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream'], category: 'office', previewKind: null, defaultMaxSizeBytes: 10 * 1024 * 1024 },
  '.ods': { mimeTypes: ['application/vnd.oasis.opendocument.spreadsheet', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream'], category: 'office', previewKind: null, defaultMaxSizeBytes: 10 * 1024 * 1024 },
  '.odp': { mimeTypes: ['application/vnd.oasis.opendocument.presentation', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream'], category: 'office', previewKind: null, defaultMaxSizeBytes: 15 * 1024 * 1024 },
  '.eml': { mimeTypes: ['message/rfc822', 'text/plain', 'application/octet-stream'], category: 'email', previewKind: null, defaultMaxSizeBytes: 5 * 1024 * 1024 }
};

function parseExtensionsList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => (item.startsWith('.') ? item : `.${item}`));
}

const DEFAULT_ALLOWED_EXTENSIONS = Object.keys(FILE_TYPE_DEFINITIONS);
const allowedExtensions = Array.from(new Set(parseExtensionsList(process.env.UPLOAD_ALLOWED_EXTENSIONS).length
  ? parseExtensionsList(process.env.UPLOAD_ALLOWED_EXTENSIONS)
  : DEFAULT_ALLOWED_EXTENSIONS));

function parseSizeOverrides(rawValue) {
  if (!rawValue) return {};
  try {
    const parsed = JSON.parse(rawValue);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (error) {}
  return {};
}

const sizeOverrides = parseSizeOverrides(process.env.UPLOAD_MAX_SIZE_BY_TYPE_JSON);

function getFileDefinitionByExtension(extension) {
  return FILE_TYPE_DEFINITIONS[String(extension || '').toLowerCase()] || null;
}

function getAllowedFileDefinitions() {
  return allowedExtensions
    .map((extension) => [extension, getFileDefinitionByExtension(extension)])
    .filter(([, definition]) => !!definition)
    .reduce((acc, [extension, definition]) => {
      acc[extension] = definition;
      return acc;
    }, {});
}

const allowedDefinitions = getAllowedFileDefinitions();
const allowedMimeTypes = new Set(Object.values(allowedDefinitions).flatMap((definition) => definition.mimeTypes));
const maxPerFileBytes = Object.entries(allowedDefinitions).reduce((max, [extension, definition]) => {
  const limit = getMaxSizeBytesForExtension(extension, definition);
  return Math.max(max, limit);
}, 1024 * 1024);

function getMaxSizeBytesForExtension(extension, definition = null) {
  const resolvedDefinition = definition || getFileDefinitionByExtension(extension);
  if (!resolvedDefinition) return Number(process.env.UPLOAD_DEFAULT_MAX_FILE_SIZE_BYTES || 10 * 1024 * 1024);
  const override = sizeOverrides[extension] || sizeOverrides[resolvedDefinition.category];
  const parsed = Number(override);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return resolvedDefinition.defaultMaxSizeBytes;
}

function getExtensionFromFilename(filename) {
  return path.extname(String(filename || '')).toLowerCase();
}

function getAcceptAttribute() {
  return allowedExtensions.join(',');
}

function getUploadUiConfig() {
  return {
    maxFileCount: Number(process.env.UPLOAD_MAX_FILE_COUNT || 5),
    accept: getAcceptAttribute(),
    allowedExtensions,
    sizeSummary: allowedExtensions.map((extension) => ({
      extension,
      maxSizeBytes: getMaxSizeBytesForExtension(extension, allowedDefinitions[extension]),
      maxSizeMb: Number((getMaxSizeBytesForExtension(extension, allowedDefinitions[extension]) / (1024 * 1024)).toFixed(1)),
      category: allowedDefinitions[extension]?.category || 'other'
    }))
  };
}

function getPreviewKindForMimeOrName({ mimeType, filename, originalName }) {
  const extension = getExtensionFromFilename(originalName || filename);
  const definition = allowedDefinitions[extension] || getFileDefinitionByExtension(extension);
  if (definition?.previewKind) return definition.previewKind;
  if (String(mimeType || '').startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  return null;
}

module.exports = {
  FILE_TYPE_DEFINITIONS,
  allowedDefinitions,
  allowedExtensions,
  allowedMimeTypes,
  getFileDefinitionByExtension,
  getMaxSizeBytesForExtension,
  getExtensionFromFilename,
  getAcceptAttribute,
  getUploadUiConfig,
  getPreviewKindForMimeOrName,
  maxPerFileBytes
};
