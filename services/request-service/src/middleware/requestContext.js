import crypto from 'node:crypto';

export function requestContext(req, res, next) {
  const requestId = req.header('x-request-id') || crypto.randomUUID();
  req.context = {
    requestId,
    startedAt: Date.now()
  };
  res.setHeader('x-request-id', requestId);
  next();
}
