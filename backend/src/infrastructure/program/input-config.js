export function programInputConfig(rawUrl, rawProxy, networkBound) {
  if (!rawUrl) return {};
  const invalid = message => Object.assign(new Error(message), { statusCode: 503 });
  const inputUrl = URL.parse(rawUrl);
  if (!inputUrl || inputUrl.username || inputUrl.password || inputUrl.hash) {
    throw invalid('Program input URL must use HTTPS or local test HTTP and have no credentials or fragment.');
  }
  if (inputUrl.protocol === 'http:' && inputUrl.hostname === '127.0.0.1' && !networkBound) {
    return { inputUrl };
  }
  if (inputUrl.protocol !== 'https:') {
    throw invalid('Program input URL must use HTTPS outside loopback development.');
  }
  if (!rawProxy && !networkBound) return { inputUrl };

  const proxy = URL.parse(rawProxy ?? '');
  if (!proxy || proxy.port === '0' || !/^http:\/\/127\.0\.0\.1:\d{1,5}\/?$/.test(rawProxy)) {
    throw invalid('Configure MCR_PROGRAM_INPUT_EGRESS_PROXY with a local HTTP proxy and explicit port.');
  }
  return { inputUrl, proxy };
}
