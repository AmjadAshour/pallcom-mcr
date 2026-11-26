let refreshRequest;
const refresh = () => request('/auth/refresh', { method: 'POST' });

async function request(path, options) {
  const { method = 'GET', body, signal } = options;
  const file = body instanceof Blob;
  const response = await fetch('/api/v1' + path, {
    method, signal, credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': file ? body.type : 'application/json' },
    body: file ? body : body === undefined ? undefined : JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success !== true) {
    const retryAfter = response.headers.get('Retry-After') ?? response.headers.get('RateLimit-Reset');
    const seconds = Number(retryAfter);
    const retryAfterMs = retryAfter && Number.isFinite(seconds)
      ? Math.max(1000, seconds * 1000)
      : 60000;
    throw Object.assign(new Error(result.error || `Server request failed (${response.status})`), {
      status: response.status, details: result.details, retryAfterMs
    });
  }
  return result;
}

export async function api(path, options = {}) {
  try {
    return await request(path, options);
  } catch (error) {
    if (error.status !== 401 || path === '/auth/login' || path === '/auth/refresh') throw error;
    refreshRequest ??= (navigator.locks
      ? navigator.locks.request('mcr-session-refresh', refresh)
      : refresh()).finally(() => { refreshRequest = null; });
    await refreshRequest;
    return request(path, options);
  }
}

export const stationPath = (id, suffix = '') => '/stations/' + encodeURIComponent(id) + suffix;
