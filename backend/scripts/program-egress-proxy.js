import { Resolver } from 'node:dns/promises';
import { createServer } from 'node:http';
import { connect, isIP } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isPublicIPv4, isPublicSourceHostname } from '../src/infrastructure/program/input-config.js';

const dns = new Resolver({ timeout: 2000, tries: 2 });
const lookup = host => isIP(host) === 4 ? [host] : dns.resolve4(host);

export function createProgramEgressProxy(rawSource, { resolveAddresses = lookup, dial = connect } = {}) {
  const source = URL.parse(rawSource ?? '');
  if (!source || source.protocol !== 'https:' || source.username || source.password ||
      source.hash || !isPublicSourceHostname(source.hostname)) {
    throw Error('The proxy requires one administrator-configured public HTTPS source.');
  }
  const port = Number(source.port || 443);
  const authority = source.hostname.toLowerCase() + ':' + port;
  const server = createServer({ maxHeaderSize: 4096, headersTimeout: 5000, requestTimeout: 5000 }, (_req, res) => {
    res.writeHead(405, { Connection: 'close' }).end();
  });
  server.maxConnections = 8;
  server.on('connection', socket => {
    socket.setTimeout(30000, () => socket.destroy());
  });

  server.on('connect', async (req, client, buffered) => {
    // Pause while resolving and checking the precise address used by the connection.
    client.pause();
    client.on('error', () => client.destroy());
    const deny = () => client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    if (req.url.toLowerCase() !== authority || req.headers['transfer-encoding'] ||
        (req.headers['content-length'] && req.headers['content-length'] !== '0')) {
      return deny();
    }

    let addresses;
    try { addresses = await resolveAddresses(source.hostname); }
    catch { return deny(); }
    if (client.destroyed) return;
    if (!addresses.length || !addresses.every(isPublicIPv4)) return deny();

    const upstream = dial({ host: addresses[0], port, family: 4 });
    upstream.setTimeout(30000, () => upstream.destroy());
    client.once('close', () => upstream.destroy());
    upstream.once('error', () => client.destroy());
    upstream.once('close', () => client.destroy());
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (buffered.length) upstream.write(buffered);
      client.pipe(upstream);
      upstream.pipe(client);
      client.resume();
    });
  });
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const listen = URL.parse(process.env.MCR_PROGRAM_INPUT_EGRESS_PROXY ?? '');
  if (!listen || !/^http:\/\/127\.0\.0\.1:\d{1,5}\/?$/.test(process.env.MCR_PROGRAM_INPUT_EGRESS_PROXY) ||
      listen.port === '0') throw Error('Configure a loopback HTTP proxy address and explicit port.');
  createProgramEgressProxy(process.env.MCR_PROGRAM_INPUT_URL).listen(Number(listen.port || 80), '127.0.0.1');
}
