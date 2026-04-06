const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FileAsset } = require('./file-asset.model');

const STORAGE_PROVIDER = process.env.STORAGE_PROVIDER || 'local';
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_ROOT || path.join(process.cwd(), 'uploads'));

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

async function uploadLocalFile({ file, tenantId, issueId, uploadedBy, commentId = null, entityId = null }) {
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
    entityId
  });

  return asset;
}

async function uploadFile({ file, tenantId, issueId, uploadedBy, commentId = null, entityId = null }) {
  if (STORAGE_PROVIDER === 'local') {
    return uploadLocalFile({ file, tenantId, issueId, uploadedBy, commentId, entityId });
  }

  const error = new Error(`Unsupported storage provider: ${STORAGE_PROVIDER}`);
  error.status = 500;
  throw error;
}

async function getFileMetadata({ fileId }) {
  return FileAsset.findById(fileId).lean();
}

async function getFileStream({ fileId }) {
  const metadata = await FileAsset.findById(fileId).lean();
  if (!metadata) return null;

  if (metadata.storageProvider === 'local') {
    const absolutePath = resolveLocalAbsolutePath(metadata.storagePath);
    await fs.promises.access(absolutePath, fs.constants.R_OK);
    return {
      metadata,
      stream: fs.createReadStream(absolutePath)
    };
  }

  const error = new Error(`Unsupported storage provider: ${metadata.storageProvider}`);
  error.status = 500;
  throw error;
}

module.exports = {
  UPLOAD_ROOT,
  uploadFile,
  getFileStream,
  getFileMetadata,
  sanitizeOriginalName,
  sanitizeSegment,
  resolveLocalAbsolutePath
};
