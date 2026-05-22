const path = require('path');
const { getFileMetadata, getFileStream } = require('../storage/storage.service');
const { getAccessibleEntityIdSetForUser } = require('../../utils/access');
const { getPreviewKindForMimeOrName } = require('../../config/uploads');

function encodeContentDispositionFilename(filename) {
  return String(filename || 'download')
    .replace(/\r|\n/g, ' ')
    .replace(/"/g, '');
}

async function authorizeAndGetFile(req) {
  const fileId = req.params.fileId;
  const metadata = await getFileMetadata({ fileId });
  if (!metadata) return { status: 404, body: { error: 'File not found.' } };

  if (String(metadata.tenantId) !== String(req.tenant._id)) {
    return { status: 404, body: { error: 'File not found.' } };
  }

  const allowedEntityIds = await getAccessibleEntityIdSetForUser(req.currentUser);
  if (!allowedEntityIds.has(String(metadata.entityId))) {
    return { status: 403, body: { error: 'You do not have access to this file.' } };
  }

  if ((metadata.isInternalOnly || metadata.visibility === 'INTERNAL') && req.currentUser && req.currentUser.role === 'client') {
    return { status: 403, body: { error: 'This file is not available in the customer view.' } };
  }

  const fileResult = await getFileStream({ fileId, metadata });
  if (!fileResult) return { status: 404, body: { error: 'File not found.' } };

  return { metadata, fileResult };
}

async function downloadFile(req, res, next) {
  try {
    const result = await authorizeAndGetFile(req);
    if (result.status) return res.status(result.status).json(result.body);

    const { metadata, fileResult } = result;
    const safeName = encodeContentDispositionFilename(metadata.originalName || path.basename(metadata.filename));
    res.setHeader('Content-Type', metadata.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (fileResult.absolutePath) {
      return res.sendFile(fileResult.absolutePath, (error) => {
        if (error) next(error);
      });
    }

    fileResult.stream.on('error', next);
    return fileResult.stream.pipe(res);
  } catch (error) {
    return next(error);
  }
}

async function previewFile(req, res, next) {
  try {
    const result = await authorizeAndGetFile(req);
    if (result.status) return res.status(result.status).json(result.body);

    const { metadata, fileResult } = result;
    const previewKind = getPreviewKindForMimeOrName(metadata);
    if (!previewKind) {
      return res.status(400).json({ error: 'Preview is not supported for this file type.' });
    }

    const safeName = encodeContentDispositionFilename(metadata.originalName || path.basename(metadata.filename));
    res.setHeader('Content-Type', metadata.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');

    if (fileResult.absolutePath) {
      return res.sendFile(fileResult.absolutePath, (error) => {
        if (error) next(error);
      });
    }

    fileResult.stream.on('error', next);
    return fileResult.stream.pipe(res);
  } catch (error) {
    return next(error);
  }
}

module.exports = { downloadFile, previewFile };
