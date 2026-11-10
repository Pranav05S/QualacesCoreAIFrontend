import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { parseTarget, isPrivateIp, resolvePublic, makeRequestGuard, TargetError } from '../src/security.js';
import { safeRequest } from '../src/http.js';

const blocked = (input) => assert.throws(() => parseTarget(input), TargetError, `should block: ${input}`);

test('accepts ordinary public addresses and adds https', () => {
  assert.equal(parseTarget('example.com').href, 'https://example.com/');
  assert.equal(parseTarget('  https://example.com/path?q=1 ').href, 'https://example.com/path?q=1');
  assert.equal(parseTarget('http://example.com').protocol, 'http:');
  assert.equal(parseTarget('example.com:443').port, '');
});

test('blocks loopback, private, link-local and metadata addresses', () => {
  for (const t of [
    'http://localhost', 'http://localhost.', 'http://foo.localhost', 'http://127.0.0.1', 'http://127.1', 'http://0.0.0.0',
    'http://10.0.0.5', 'http://172.16.0.1', 'http://172.31.255.255', 'http://192.168.1.1', 'http://169.254.169.254/latest/meta-data',
    'http://100.64.0.1', 'http://[::1]', 'http://[::]', 'http://[fe80::1]', 'http://[fd00::1]', 'http://[::ffff:127.0.0.1]',
    'http://[::ffff:7f00:1]', 'http://[::ffff:a9fe:a9fe]', 'http://[64:ff9b::7f00:1]', 'http://[2002:7f00:1::]',
  ]) blocked(t);
});

test('blocks numeric and obfuscated IP forms the URL parser normalises', () => {
  for (const t of ['http://2130706433', 'http://0x7f000001', 'http://0177.0.0.1', 'http://0x7f.0.0.1', 'http://017700000001', 'http://3232235777']) blocked(t);
});

test('blocks internal-looking names, bad schemes, credentials, odd ports', () => {
  for (const t of ['http://intranet', 'http://printer.local', 'http://db.internal', 'http://a.corp', 'ftp://example.com', 'file:///etc/passwd', 'javascript:alert(1)',
    'gopher://example.com', 'http://user:pass@example.com', 'http://example.com:22', 'http://example.com:6379', 'http://example.com:8080', '', '   ', 'http://', 'not a url', 'http://exa mple.com']) blocked(t);
  blocked(null); blocked(undefined); blocked(42); blocked('a'.repeat(3000));
});

test('isPrivateIp classifies public and non-public addresses', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888']) assert.equal(isPrivateIp(ip), false, ip);
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.20.0.1', '169.254.1.1', '224.0.0.1', '255.255.255.255', '::1', 'fc00::1', 'fe80::abcd', '::ffff:10.0.0.1', 'garbage']) assert.equal(isPrivateIp(ip), true, ip);
});

test('hostnames that resolve to any private address are refused (DNS rebinding style)', async () => {
  const mixed = async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.7', family: 4 }];
  await assert.rejects(resolvePublic('evil.example', mixed), TargetError);
  const publicOnly = async () => [{ address: '93.184.216.34', family: 4 }];
  assert.equal((await resolvePublic('ok.example', publicOnly))[0].address, '93.184.216.34');
  const dnsErr = (code) => async () => { throw Object.assign(new Error(code), { code }); };
  await assert.rejects(resolvePublic('nope.example', dnsErr('ENOTFOUND')), (e) => e.code === 'dns_failed');
  await assert.rejects(resolvePublic('flaky.example', dnsErr('EAI_AGAIN')), (e) => e.code === 'dns_temporary', 'temporary DNS trouble must not look like a missing site');
});

test('request guard blocks sub-requests to internal hosts and caches per host', async () => {
  let lookups = 0;
  const guard = makeRequestGuard(async (host) => { lookups++; return host === 'cdn.example' ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '192.168.1.5', family: 4 }]; });
  assert.equal(await guard('https://cdn.example/a.js'), true);
  assert.equal(await guard('https://cdn.example/b.js'), true);
  assert.equal(lookups, 1);
  assert.equal(await guard('http://rebind.example/x'), false);
  assert.equal(await guard('http://169.254.169.254/latest'), false);
  assert.equal(await guard('http://localhost:3000/'), false);
  assert.equal(await guard('data:text/plain,hi'), true);
  assert.equal(await guard('not a url'), false);
});

test('safeRequest refuses a first hop to a private address and never connects', async () => {
  let touched = false;
  const srv = http.createServer((_q, r) => { touched = true; r.end('secret'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  await assert.rejects(safeRequest(`http://127.0.0.1:${port}/`), TargetError);
  srv.close();
  assert.equal(touched, false);
});

test('safeRequest re-validates every redirect hop and stops one that points at an internal address', async () => {
  // Hop 1 runs in loopback test mode so we can reach a local server. That server then
  // switches the guard back ON before it answers with a redirect to the cloud metadata address, so hop 2 is
  // validated with the real production rules.
  process.env.ALLOW_LOOPBACK_TARGETS = '1';
  const front = http.createServer((_q, r) => {
    delete process.env.ALLOW_LOOPBACK_TARGETS;
    r.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); r.end();
  });
  await new Promise((r) => front.listen(0, '127.0.0.1', r));
  const res = await safeRequest(`http://127.0.0.1:${front.address().port}/`);
  assert.equal(res.error.code, 'blocked_target');
  assert.equal(res.chain.length, 1, 'only the first hop was fetched');
  front.close();
  const via = http.createServer((_q, r) => { r.writeHead(302, { location: 'http://localhost/admin' }); r.end(); });
  process.env.ALLOW_LOOPBACK_TARGETS = '1';
  await new Promise((r) => via.listen(0, '127.0.0.1', r));
  const port = via.address().port;
  via.removeAllListeners('request');
  via.on('request', (_q, r) => { delete process.env.ALLOW_LOOPBACK_TARGETS; r.writeHead(301, { location: 'http://[::1]:80/' }); r.end(); });
  const res2 = await safeRequest(`http://127.0.0.1:${port}/`);
  assert.equal(res2.error.code, 'blocked_target');
  via.close();
});

test('safeRequest follows redirects between allowed hosts and reports the chain (test mode)', async () => {
  process.env.ALLOW_LOOPBACK_TARGETS = '1';
  const srv = http.createServer((q, r) => {
    if (q.url === '/a') { r.writeHead(301, { location: '/b' }); return r.end(); }
    if (q.url === '/b') { r.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': ['a=1; Secure', 'b=2'] }); return r.end('hello'); }
    if (q.url === '/loop') { r.writeHead(302, { location: '/loop' }); return r.end(); }
    r.writeHead(404); r.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const ok = await safeRequest(`${base}/a`, { maxBytes: 100 });
  assert.equal(ok.status, 200); assert.equal(ok.body, 'hello'); assert.equal(ok.chain.length, 2); assert.equal(ok.setCookie.length, 2);
  const loop = await safeRequest(`${base}/loop`);
  assert.equal(loop.error.code, 'too_many_redirects');
  const nf = await safeRequest(`${base}/zzz`);
  assert.equal(nf.status, 404);
  srv.close();
  delete process.env.ALLOW_LOOPBACK_TARGETS;
});

test('safeRequest connects by hostname through the pinned lookup (regression: Node passes all:true)', async () => {
  process.env.ALLOW_LOOPBACK_TARGETS = '1';
  const srv = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/plain' }); r.end('by-name'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const res = await safeRequest(`http://localhost:${srv.address().port}/`, { maxBytes: 100 });
  assert.equal(res.error, undefined);
  assert.equal(res.body, 'by-name');
  srv.close();
  delete process.env.ALLOW_LOOPBACK_TARGETS;
});

test('loopback test mode never allows private, link-local or metadata addresses', async () => {
  process.env.ALLOW_LOOPBACK_TARGETS = '1';
  try {
    for (const t of ['http://localhost:8080', 'http://127.0.0.1:3000', 'http://[::1]:9000']) assert.doesNotThrow(() => parseTarget(t), t);
    for (const t of ['http://169.254.169.254/latest/meta-data', 'http://10.0.0.1', 'http://192.168.1.1', 'http://172.16.0.1', 'http://100.64.0.1', 'http://[fd00::1]', 'http://[fe80::1]', 'http://printer.local', 'http://example.com:8080']) {
      assert.throws(() => parseTarget(t), TargetError, t);
    }
    await assert.rejects(resolvePublic('169.254.169.254'), TargetError);
    await assert.rejects(resolvePublic('evil.example', async () => [{ address: '127.0.0.1', family: 4 }]), TargetError, 'a public name pointing at loopback is still refused');
    await assert.rejects(resolvePublic('evil.example', async () => [{ address: '169.254.169.254', family: 4 }]), TargetError);
  } finally { delete process.env.ALLOW_LOOPBACK_TARGETS; }
  // and with the flag off, loopback is blocked again
  assert.throws(() => parseTarget('http://127.0.0.1:3000'), TargetError);
});
