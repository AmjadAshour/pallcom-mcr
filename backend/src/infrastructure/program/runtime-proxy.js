import http from 'node:http';

export const programPath = /^\/api\/v1\/stations\/[^/]+\/program(?:\/|$)/i;

export function programRuntimePort(value) {
  if (!value) return null;
  if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) {
    throw new Error('MCR_PROGRAM_RUNTIME_PORT must be an integer from 1024 to 65535');
  }
  return Number(value);
}

export function forwardProgram(port) {
  return (req, res, next) => {
    if (!programPath.test(req.path)) return next();
    const headers = {};
    const forwarded = ['authorization', 'cookie', 'content-type', 'content-length', 'range', 'if-range'];
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) forwarded.push('origin', 'sec-fetch-site', 'host');
    for (const name of forwarded) {
      if (req.headers[name] !== undefined) headers[name] = req.headers[name];
    }
    const upstream = http.request({
      hostname: '127.0.0.1', port, path: req.originalUrl, method: req.method, headers,
      timeout: 220000
    }, response => {
      res.statusCode = response.statusCode;
      for (const name of ['content-type', 'content-length', 'content-disposition', 'cache-control', 'referrer-policy',
        'content-range', 'accept-ranges', 'x-accel-buffering']) {
        if (response.headers[name] !== undefined) res.setHeader(name, response.headers[name]);
      }
      response.on('error', () => res.destroy());
      response.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', () => {
      if (res.headersSent) return res.destroy();
      if (!res.destroyed) res.status(503).json({success:false,error:'Program runtime is unavailable'});
    });
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  };
}
