let refreshRequest;

async function request(path, options) {
  const { method = 'GET', body, signal } = options;
  const response = await fetch('/api/v1' + path, {
    method, signal, credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success !== true) {
    throw Object.assign(new Error(result.error || `Server request failed (${response.status})`), {
      status: response.status, details: result.details
    });
  }
  return result;
}

export async function api(path, options = {}) {
  try {
    return await request(path, options);
  } catch (error) {
    if (error.status !== 401 || path === '/auth/login' || path === '/auth/refresh') throw error;
    refreshRequest ??= request('/auth/refresh', { method: 'POST' }).finally(() => { refreshRequest = null; });
    await refreshRequest;
    return request(path, options);
  }
}

export const stationPath = (id, suffix = '') => '/stations/' + encodeURIComponent(id) + suffix;
