export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.statusCode ?? err.status;
  const statusCode = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
  const error = err.type === 'entity.parse.failed' ? 'Invalid request body'
    : statusCode === 413 ? 'Request body is too large'
    : statusCode === 415 ? 'Unsupported request body format'
    : statusCode >= 500 && statusCode !== 503 ? 'Internal Server Error'
    : statusCode === 503 ? 'Service unavailable'
    : err.message || 'Request rejected';

  res.status(statusCode).json({ success: false, error });
}
