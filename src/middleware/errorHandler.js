function notFoundHandler(req, res) {
  res.status(404).render('partials/error-page', {
    title: 'Not found',
    heading: 'Page not found',
    message: 'The page you requested does not exist.',
    basePath: req.basePath || (req.tenant ? `/${req.tenant.slug}` : '')
  });
}

function errorHandler(error, req, res, next) {
  console.error(error);

  if (error.code === 'EBADCSRFTOKEN') {
    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
    }

    req.session.error = 'Your session form token expired or was invalid. Please try again.';
    return res.redirect(req.get('Referrer') || '/');
  }

  const status = error.status || 500;
  const message = error.message || 'Something went wrong.';

  if (req.path.startsWith('/api/')) {
    return res.status(status).json({ error: message });
  }

  res.status(status).render('partials/error-page', {
    title: 'Error',
    heading: status === 403 ? 'Access denied' : 'Something went wrong',
    message: status === 403 ? (message || 'You do not have access to this page.') : message,
    basePath: req.basePath || (req.tenant ? `/${req.tenant.slug}` : '')
  });
}

module.exports = { notFoundHandler, errorHandler };
