import { BlockList, isIP } from 'node:net';

const special = new BlockList();
// Deny IPv4 special-purpose, private, link-local/metadata and multicast ranges for external HTTPS ingest.
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.31.196.0', 24], ['192.52.193.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['192.175.48.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4]
]) special.addSubnet(address, prefix);

export const isPublicIPv4 = address => isIP(address) === 4 && !special.check(address, 'ipv4');

export function isPublicSourceHostname(hostname) {
  if (typeof hostname !== 'string' || !hostname || hostname.length > 253) return false;
  const normalized = hostname.toLowerCase();
  if (normalized.startsWith('[') || normalized.endsWith('.') ||
      normalized === 'localhost' ||
      normalized.endsWith('.localhost') ||
      normalized.endsWith('.local') ||
      normalized.endsWith('.internal')) {
    return false;
  }
  const family = isIP(normalized);
  if (family !== 0) return isPublicIPv4(normalized);
  return !/^\d+(?:\.\d+)*$/.test(normalized);
}

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
  if (inputUrl.protocol !== 'https:' || !isPublicSourceHostname(inputUrl.hostname)) {
    throw invalid('Program input URL must use HTTPS with a public destination outside loopback development.');
  }
  if (!rawProxy && !networkBound) return { inputUrl };

  const proxy = URL.parse(rawProxy ?? '');
  if (!proxy || proxy.port === '0' || !/^http:\/\/127\.0\.0\.1:\d{1,5}\/?$/.test(rawProxy)) {
    throw invalid('Configure MCR_PROGRAM_INPUT_EGRESS_PROXY with a local HTTP proxy and explicit port.');
  }
  return { inputUrl, proxy };
}
