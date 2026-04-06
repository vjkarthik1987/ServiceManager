const path = require('path');
const { getFileMetadata, getFileStream } = require('../storage/storage.service');
const { Issue } = require('../issues/issue.model');
const { userHasEntityAccess } = require('../../utils/access');
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

  const issue = await Issue.findOne({ _id: metadata.issueId, tenantId: req.tenant._id }).select('_id entityId tenantId');
  if (!issue) return { status: 404, body: { error: 'File not found.' } };

  const hasAccess = await userHasEntityAccess(req.currentUser, issue.entityId);
  if (!hasAccess) {
    return { status: 403, body: { error: 'You do not have access to this file.' } };
  }

  const fileResult = await getFileStream({ fileId });
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
    res.setHeader('Content-Length', metadata.size || 0);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

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
    res.setHeader('Content-Length', metadata.size || 0);
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');

    fileResult.stream.on('error', next);
    return fileResult.stream.pipe(res);
  } catch (error) {
    return next(error);
  }
}

module.exports = { downloadFile, previewFile };
