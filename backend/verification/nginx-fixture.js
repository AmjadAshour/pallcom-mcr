import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const configSource = new URL('../infrastructure/docker/', import.meta.url);
const slash = path => path.replaceAll('\\', '/');
const quote = path => '"' + slash(path) + '"';

export async function startFixtureNginx({ directory, webRoot, port, redirectPort, upstreamPort, cert, key }) {
  const binary = process.env.MCR_TEST_NGINX;
  assert(binary && isAbsolute(binary), 'Set MCR_TEST_NGINX to the absolute path of a trusted Nginx binary');
  await mkdir(join(directory, 'logs'));
  await mkdir(join(directory, 'temp'));
  const config = (await readFile(new URL('nginx.conf', configSource), 'utf8'))
    .replace('listen 80;', 'listen 127.0.0.1:' + redirectPort + ';')
    .replace('listen 443 ssl;', 'listen 127.0.0.1:' + port + ' ssl;')
    .replace('/etc/nginx/tls/fullchain.pem', quote(cert))
    .replace('/etc/nginx/tls/privkey.pem', quote(key))
    .replaceAll('/usr/share/nginx/html', quote(webRoot))
    .replaceAll('http://server:4000', 'http://127.0.0.1:' + upstreamPort)
    .replace('/etc/nginx/mcr-locations/*.conf', quote(join(directory, 'iptv.conf')))
    .replaceAll('/dev/null', process.platform === 'win32' ? 'nul' : '/dev/null');
  await writeFile(join(directory, 'iptv.conf'), await readFile(new URL('iptv.nginx.conf', configSource)));
  await writeFile(join(directory, 'nginx.conf'), `
worker_processes 1;
error_log logs/error.log;
pid nginx.pid;
events { worker_connections 48; }
http {
  access_log logs/access.log;
  types { text/html html; text/css css; application/javascript js; image/svg+xml svg; }
  proxy_connect_timeout 1s;
  client_body_temp_path temp/client;
  proxy_temp_path temp/proxy;
  fastcgi_temp_path temp/fastcgi;
  uwsgi_temp_path temp/uwsgi;
  scgi_temp_path temp/scgi;
  ${config}
}
`);
  const args = ['-p', slash(directory) + '/', '-c', 'nginx.conf'];
  execFileSync(binary, [...args, '-t'], { cwd: directory, windowsHide: true, stdio: 'pipe' });
  return spawn(binary, [...args, '-g', 'daemon off; master_process off;'],
    { cwd: directory, windowsHide: true, stdio: ['ignore', 'ignore', 'inherit'] });
}
