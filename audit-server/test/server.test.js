import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';

async function start(opts = {}) {
  const calls = [];
  const auditFn = opts.auditFn || (async (url, { onProgress }) => { calls.push(url); onProgress('browser', 'Loading', 40); await new Promise((r) => setTimeout(r, opts.delay || 20)); onProgress('done', 'Done', 100); return { target: url, scores: { overall: 80 } }; });
  const server = createServer({ auditFn, env: { ALLOWED_ORIGINS: 'https://qualaces.com', RATE_LIMIT_PER_HOUR: String(opts.rate || 3), MAX_CONCURRENT: String(opts.conc || 2), MAX_QUEUE: String(opts.queue || 20), AUDIT_TIMEOUT_MS: String(opts.timeout || 5000), ...(opts.env || {}) } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) => fetch(`${base}/api/audit`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const poll = async (id) => { for (let i = 0; i < 100; i++) { const j = await (await fetch(`${base}/api/audit/${id}`)).json(); if (j.status === 'done' || j.status === 'error') return j; await new Promise((r) => setTimeout(r, 25)); } throw new Error('poll timeout'); };
  return { server, base, post, poll, calls };
}

test('health, 404 and CORS', async () => {
  const { server, base } = await start();
  assert.equal((await (await fetch(`${base}/api/health`)).json()).ok, true);
  assert.equal((await fetch(`${base}/nope`)).status, 404);
  const ok = await fetch(`${base}/api/health`, { headers: { origin: 'https://qualaces.com' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://qualaces.com');
  const bad = await fetch(`${base}/api/health`, { headers: { origin: 'https://evil.example' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  const pre = await fetch(`${base}/api/audit`, { method: 'OPTIONS', headers: { origin: 'https://qualaces.com' } });
  assert.equal(pre.status, 204);
  server.close();
});

test('validates input: consent, url, content-type, size, JSON', async () => {
  const { server, post, base } = await start();
  assert.equal((await post({ url: 'example.com' })).status, 400);
  assert.equal((await (await post({ url: 'example.com', consent: false })).json()).error.code, 'consent_required');
  for (const u of ['http://localhost', 'http://169.254.169.254', 'file:///etc/passwd', 'http://10.0.0.1', '']) {
    const r = await post({ url: u, consent: true });
    assert.equal(r.status, 400, u);
  }
  assert.equal((await post('{bad json', {})).status, 400);
  assert.equal((await fetch(`${base}/api/audit`, { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await post({ url: 'example.com', consent: true, pad: 'x'.repeat(10000) })).status, 413);
  assert.equal((await fetch(`${base}/api/audit/not-an-id`)).status, 404);
  assert.equal((await fetch(`${base}/api/audit/${'a'.repeat(24)}`)).status, 404);
  server.close();
});

test('job lifecycle: queued -> running -> done with progress and result', async () => {
  const { server, post, poll, calls } = await start();
  const r = await post({ url: 'Example.com/page', consent: true });
  assert.equal(r.status, 202);
  const { id } = await r.json();
  const j = await poll(id);
  assert.equal(j.status, 'done'); assert.equal(j.percent, 100);
  assert.equal(j.result.scores.overall, 80);
  assert.ok(j.steps.some((s) => s.key === 'browser'));
  assert.equal(calls[0], 'https://example.com/page');
  server.close();
});

test('identical recent requests are served from the same job', async () => {
  const { server, post, calls, poll } = await start();
  const a = await (await post({ url: 'example.com', consent: true })).json();
  const b = await (await post({ url: 'https://example.com/', consent: true })).json();
  assert.equal(a.id, b.id); assert.equal(b.cached, true);
  await poll(a.id);
  assert.equal(calls.length, 1);
  server.close();
});

test('per-IP rate limit returns 429 with Retry-After', async () => {
  const { server, post } = await start({ rate: 2 });
  assert.equal((await post({ url: 'a.example.com', consent: true })).status, 202);
  assert.equal((await post({ url: 'b.example.com', consent: true })).status, 202);
  const third = await post({ url: 'c.example.com', consent: true });
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers.get('retry-after')) > 0);
  assert.equal((await third.json()).error.code, 'rate_limited');
  server.close();
});

test('forwarded IPs are ignored unless TRUST_PROXY=1', async () => {
  const a = await start({ rate: 1 });
  assert.equal((await a.post({ url: 'a.example.com', consent: true }, { 'x-forwarded-for': '1.1.1.1' })).status, 202);
  assert.equal((await a.post({ url: 'b.example.com', consent: true }, { 'x-forwarded-for': '2.2.2.2' })).status, 429, 'spoofed header must not reset the limit');
  a.server.close();
  const b = await start({ rate: 1, env: { TRUST_PROXY: '1' } });
  assert.equal((await b.post({ url: 'a.example.com', consent: true }, { 'x-forwarded-for': '1.1.1.1' })).status, 202);
  assert.equal((await b.post({ url: 'b.example.com', consent: true }, { 'x-forwarded-for': '2.2.2.2' })).status, 202);
  b.server.close();
});

test('concurrency cap queues work and the queue is bounded', async () => {
  let active = 0; let peak = 0;
  const auditFn = async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 80)); active--; return { ok: 1 }; };
  const { server, post, poll } = await start({ auditFn, conc: 1, queue: 2, rate: 50 });
  const ids = [];
  for (const h of ['a', 'b', 'c']) ids.push((await (await post({ url: `${h}.example.com`, consent: true })).json()).id);
  const full = await post({ url: 'd.example.com', consent: true });
  assert.equal(full.status, 503);
  for (const id of ids) assert.equal((await poll(id)).status, 'done');
  assert.equal(peak, 1);
  server.close();
});

test('errors: known target errors pass their message, unknown errors are masked, timeouts stop the job', async () => {
  const { TargetError } = await import('../src/security.js');
  const auditFn = async (url) => {
    if (url.includes('blocked')) throw new TargetError('That address is not publicly reachable.');
    if (url.includes('slow')) await new Promise((r) => setTimeout(r, 400));
    throw new Error('internal stack /srv/secret/path.js:12');
  };
  const { server, post, poll } = await start({ auditFn, timeout: 120, rate: 50 });
  const a = await poll((await (await post({ url: 'blocked.example.com', consent: true })).json()).id);
  assert.equal(a.status, 'error'); assert.match(a.error.message, /publicly reachable/);
  const b = await poll((await (await post({ url: 'boom.example.com', consent: true })).json()).id);
  assert.equal(b.status, 'error'); assert.ok(!b.error.message.includes('/srv/secret'), 'internals must not leak');
  const c = await poll((await (await post({ url: 'slow.example.com', consent: true })).json()).id);
  assert.equal(c.error.code, 'timeout');
  server.close();
});
