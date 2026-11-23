import { env } from '../../config/env.js';

export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const isProd = env.NODE_ENV === 'production';

  res.status(statusCode).json({
    success: false,
    error: isProd && statusCode === 500 ? 'Internal Server Error' : err.message,
    ...(isProd ? {} : { stack: err.stack })
  });
}
