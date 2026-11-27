import assert from 'node:assert/strict';
import { once } from 'node:events';
import { connect, createServer } from 'node:net';
import test from 'node:test';
import { createProgramEgressProxy } from '../scripts/program-egress-proxy.js';

test('Program egress connects only to the configured authority and the validated IPv4 address', async () => {
  const receiver = createServer(socket => socket.pipe(socket));
  receiver.listen(0, '127.0.0.1');
  await once(receiver, 'listening');
  let addresses = ['93.184.216.34'];
  const dials = [];
  const proxy = createProgramEgressProxy('https://source.example.test/feed', {
    resolveAddresses: async () => addresses,
    dial: options => {
      dials.push(options);
      return connect(receiver.address().port, '127.0.0.1');
    }
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');

  async function tryConnect(authority) {
    const client = connect(proxy.address().port, '127.0.0.1');
    try {
      await once(client, 'connect');
      client.write('CONNECT ' + authority + ' HTTP/1.1\r\nHost: ' + authority + '\r\n\r\n');
      const [response] = await once(client, 'data');
      const result = response.toString();
      if (result.startsWith('HTTP/1.1 200')) {
        client.write('fixture');
        assert.equal((await once(client, 'data'))[0].toString(), 'fixture');
      }
      return result;
    } finally {
      client.destroy();
    }
  }

  try {
    assert.match(await tryConnect('unapproved.example.test:443'), /^HTTP\/1.1 403/);
    assert.match(await tryConnect('source.example.test:443'), /^HTTP\/1.1 200/);
    assert.deepEqual(dials, [{ host: '93.184.216.34', port: 443, family: 4 }]);
    for (const blocked of ['127.0.0.1', '169.254.169.254', '10.0.0.1', '100.64.0.1', '::ffff:127.0.0.1']) {
      addresses = ['93.184.216.34', blocked];
      assert.match(await tryConnect('source.example.test:443'), /^HTTP\/1.1 403/);
    }
    assert.equal(dials.length, 1);
  } finally {
    proxy.close();
    receiver.close();
  }
});
