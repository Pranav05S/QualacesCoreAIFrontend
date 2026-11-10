// End-to-end: runs a real audit with a real browser against this repository's own site.
// Opt-in because it needs Chromium:  E2E=1 CHROMIUM_PATH=/path/to/chrome npm run test:e2e
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.xml': 'application/xml', '.txt': 'text/plain' };

test('full audit of the site itself', { skip: process.env.E2E !== '1', timeout: 120000 }, async () => {
  process.env.ALLOW_LOOPBACK_TARGETS = '1';
  process.env.AUDIT_EXTERNAL_LINKS = '0';
  const { runAudit, closeBrowser } = await import('../src/audit.js');
  const srv = http.createServer((q, r) => {
    const f = path.join(root, q.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0]));
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
    r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const steps = [];
  try {
    const res = await runAudit(`http://localhost:${srv.address().port}/index.html`, { onProgress: (k) => steps.push(k) });
    assert.deepEqual(steps.at(-1), 'done');
    for (const c of ['performance', 'accessibility', 'seo', 'security', 'reliability', 'mobile', 'overall']) assert.ok(res.scores[c] >= 0 && res.scores[c] <= 100, c);
    assert.ok(['A', 'B', 'C', 'D', 'F'].includes(res.scores.grade));
    // a plain-http static server must be flagged, and the site's own content must audit cleanly
    assert.ok(res.findings.some((f) => f.id === 'no-https' && f.severity === 'critical'));
    assert.ok(res.findings.some((f) => f.id === 'no-csp'));
    assert.equal(res.findings.filter((f) => f.category === 'accessibility').length, 0, 'the site should have no accessibility findings');
    assert.equal(res.counts.high + res.counts.critical > 0, true);
    assert.ok(res.screenshots.desktop.startsWith('data:image/jpeg;base64,') && res.screenshots.mobile.startsWith('data:image/jpeg;base64,'));
    assert.equal(res.strategy.phases.length, 4);
    assert.ok(res.strategy.services[0].name && res.strategy.testCases.length >= 4);
    assert.ok(res.metrics.requests > 0 && res.metrics.transferBytes > 0);
  } finally { srv.close(); await closeBrowser(); delete process.env.ALLOW_LOOPBACK_TARGETS; delete process.env.AUDIT_EXTERNAL_LINKS; }
});
