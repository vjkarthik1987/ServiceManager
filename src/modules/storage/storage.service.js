const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FileAsset } = require('./file-asset.model');
const sharepointService = require('../integrations/sharepoint/sharepoint.service');
const cloudinaryService = require('../integrations/cloudinary/cloudinary.service');

function getStorageProvider() {
  return String(process.env.STORAGE_PROVIDER || 'local').toLowerCase();
}
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_ROOT || path.join(process.cwd(), 'uploads'));
const fileMetadataCache = new Map();
const FILE_METADATA_CACHE_LIMIT = 1000;

function cacheFileMetadata(metadata) {
  if (!metadata || !metadata._id) return metadata;
  const key = String(metadata._id);
  fileMetadataCache.set(key, metadata);
  if (fileMetadataCache.size > FILE_METADATA_CACHE_LIMIT) {
    const firstKey = fileMetadataCache.keys().next().value;
    if (firstKey) fileMetadataCache.delete(firstKey);
  }
  return metadata;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeSegment(value, fallback = 'unknown') {
  const cleaned = String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return cleaned || fallback;
}

function sanitizeOriginalName(fileName) {
  const base = path.basename(String(fileName || 'file'));
  return sanitizeSegment(base, 'file');
}

function buildStoredFilename(originalName) {
  const extension = path.extname(originalName || '').toLowerCase();
  const stem = path.basename(originalName || 'file', extension);
  const safeStem = sanitizeSegment(stem, 'file').slice(0, 80);
  const token = crypto.randomBytes(8).toString('hex');
  return `${Date.now()}-${token}-${safeStem}${extension}`;
}

function resolveLocalAbsolutePath(relativePath) {
  const normalized = path.normalize(relativePath).replace(/^([.][.][/\\])+/, '');
  const absolute = path.resolve(UPLOAD_ROOT, normalized);
  if (!absolute.startsWith(UPLOAD_ROOT)) {
    const error = new Error('Unsafe storage path detected.');
    error.status = 400;
    throw error;
  }
  return absolute;
}

async function uploadLocalFile({ file, tenantId, issueId, uploadedBy, commentId = null, entityId = null, visibility = 'EXTERNAL', isInternalOnly = false }) {
  const safeOriginalName = sanitizeOriginalName(file.originalname);
  const storedFilename = buildStoredFilename(safeOriginalName);
  const safeTenantId = sanitizeSegment(tenantId);
  const safeIssueId = sanitizeSegment(issueId);
  const relativeDir = path.join(safeTenantId, safeIssueId);
  const absoluteDir = resolveLocalAbsolutePath(relativeDir);
  ensureDir(absoluteDir);

  const relativePath = path.join(relativeDir, storedFilename);
  const absolutePath = resolveLocalAbsolutePath(relativePath);

  await fs.promises.writeFile(absolutePath, file.buffer);
  const checksumSha256 = crypto.createHash('sha256').update(file.buffer || Buffer.alloc(0)).digest('hex');

  const asset = await FileAsset.create({
    filename: storedFilename,
    originalName: safeOriginalName,
    mimeType: file.detectedMimeType || file.mimetype || 'application/octet-stream',
    size: file.size || file.buffer?.length || 0,
    tenantId,
    issueId,
    commentId,
    uploadedByUserId: uploadedBy,
    storageProvider: 'local',
    storagePath: relativePath,
    checksumSha256,
    visibility,
    isInternalOnly,
    malwareScanStatus: 'NOT_SCANNED',
    entityId
  });

  cacheFileMetadata(asset.toObject ? asset.toObject() : asset);
  return asset;
}

async function uploadSharePointFile({ file, tenantId, issueId, uploadedBy, commentId = null, entityId = null, visibility = 'EXTERNAL', isInternalOnly = false }) {
  const safeOriginalName = sanitizeOriginalName(file.originalname);
  const storedFilename = buildStoredFilename(safeOriginalName);
  const config = sharepointService.getConfig();
  const safeTenantId = sanitizeSegment(tenantId);
  const safeIssueId = sanitizeSegment(issueId);
  const relativePath = [config.rootFolder, safeTenantId, safeIssueId, storedFilename].filter(Boolean).join('/');
  const checksumSha256 = crypto.createHash('sha256').update(file.buffer || Buffer.alloc(0)).digest('hex');
  const uploadedItem = await sharepointService.uploadSmallFile({
    relativePath,
    buffer: file.buffer || Buffer.alloc(0),
    mimeType: file.detectedMimeType || file.mimetype || 'application/octet-stream'
  });

  const asset = await FileAsset.create({
    filename: storedFilename,
    originalName: safeOriginalName,
    mimeType: file.detectedMimeType || file.mimetype || 'application/octet-stream',
    size: file.size || file.buffer?.length || 0,
    tenantId,
    issueId,
    commentId,
    uploadedByUserId: uploadedBy,
    storageProvider: 'sharepoint',
    storagePath: relativePath,
    storageExternalId: uploadedItem.id || '',
    storageWebUrl: uploadedItem.webUrl || '',
    checksumSha256,
    visibility,
    isInternalOnly,
    malwareScanStatus: 'NOT_SCANNED',
    entityId
  });

  cacheFileMetadata(asset.toObject ? asset.toObject() : asset);
  return asset;
}


async function uploadCloudinaryFile({ file, tenantId, issueId, uploadedBy, commentId = null, entityId = null, visibility = 'EXTERNAL', isInternalOnly = false }) {
  const safeOriginalName = sanitizeOriginalName(file.originalname);
  const storedFilename = buildStoredFilename(safeOriginalName);
  const safeTenantId = sanitizeSegment(tenantId);
  const safeIssueId = sanitizeSegment(issueId);
  const folder = cloudinaryService.buildFolderPath({ tenantId: safeTenantId, issueId: safeIssueId });
  const checksumSha256 = crypto.createHash('sha256').update(file.buffer || Buffer.alloc(0)).digest('hex');
  const publicId = path.basename(storedFilename, path.extname(storedFilename));

  const uploadedItem = await cloudinaryService.uploadFile({
    buffer: file.buffer || Buffer.alloc(0),
    filename: storedFilename,
    mimeType: file.detectedMimeType || file.mimetype || 'application/octet-stream',
    folder,
    publicId,
    resourceType: 'auto'
  });

  const asset = await FileAsset.create({
    filename: storedFilename,
    originalName: safeOriginalName,
    mimeType: file.detectedMimeType || file.mimetype || 'application/octet-stream',
    size: file.size || file.buffer?.length || 0,
    tenantId,
    issueId,
    commentId,
    uploadedByUserId: uploadedBy,
    storageProvider: 'cloudinary',
    storagePath: uploadedItem.secure_url || uploadedItem.url || '',
    storageExternalId: uploadedItem.public_id || '',
    storageWebUrl: uploadedItem.url || '',
    storageSecureUrl: uploadedItem.secure_url || '',
    checksumSha256,
    visibility,
    isInternalOnly,
    malwareScanStatus: 'NOT_SCANNED',
    entityId
  });

  cacheFileMetadata(asset.toObject ? asset.toObject() : asset);
  return asset;
}

async function uploadFile({ file, tenantId, issueId, uploadedBy, commentId = null, entityId = null, visibility = 'EXTERNAL', isInternalOnly = false }) {
  const provider = getStorageProvider();
  if (provider === 'local') {
    return uploadLocalFile({ file, tenantId, issueId, uploadedBy, commentId, entityId, visibility, isInternalOnly });
  }
  if (provider === 'sharepoint') {
    return uploadSharePointFile({ file, tenantId, issueId, uploadedBy, commentId, entityId, visibility, isInternalOnly });
  }
  if (provider === 'cloudinary') {
    return uploadCloudinaryFile({ file, tenantId, issueId, uploadedBy, commentId, entityId, visibility, isInternalOnly });
  }

  const error = new Error(`Unsupported storage provider: ${provider}`);
  error.status = 500;
  throw error;
}

async function getFileMetadata({ fileId }) {
  const cacheKey = String(fileId || '');
  if (cacheKey && fileMetadataCache.has(cacheKey)) {
    return fileMetadataCache.get(cacheKey);
  }
  const metadata = await FileAsset.findById(fileId).lean();
  return cacheFileMetadata(metadata);
}

async function getFileStream({ fileId, metadata = null }) {
  const resolvedMetadata = metadata || await getFileMetadata({ fileId });
  if (!resolvedMetadata) return null;

  if (resolvedMetadata.storageProvider === 'local') {
    const absolutePath = resolveLocalAbsolutePath(resolvedMetadata.storagePath);
    return {
      metadata: resolvedMetadata,
      absolutePath,
      stream: fs.createReadStream(absolutePath)
    };
  }

  if (resolvedMetadata.storageProvider === 'sharepoint') {
    const stream = await sharepointService.getDownloadStream({ itemId: resolvedMetadata.storageExternalId });
    return { metadata: resolvedMetadata, stream };
  }

  if (resolvedMetadata.storageProvider === 'cloudinary') {
    const url = cloudinaryService.getDownloadUrl(resolvedMetadata);
    if (!url) {
      const error = new Error('Cloudinary file URL is missing.');
      error.status = 404;
      throw error;
    }
    const https = require('https');
    const stream = await new Promise((resolve, reject) => {
      https.get(url, (response) => {
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(response);
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const error = new Error(`Cloudinary download failed with HTTP ${response.statusCode}: ${Buffer.concat(chunks).toString('utf8').slice(0, 500)}`);
          error.status = response.statusCode;
          reject(error);
        });
      }).on('error', reject);
    });
    return { metadata: resolvedMetadata, stream };
  }

  const error = new Error(`Unsupported storage provider: ${resolvedMetadata.storageProvider}`);
  error.status = 500;
  throw error;
}

module.exports = {
  UPLOAD_ROOT,
  getStorageProvider,
  uploadFile,
  getFileStream,
  getFileMetadata,
  sanitizeOriginalName,
  sanitizeSegment,
  resolveLocalAbsolutePath
};
