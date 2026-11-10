import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFindings, scoreCategories, gradeFor } from '../src/checks.js';
import { buildStrategy } from '../src/strategy.js';
import { narrate } from '../src/llm.js';
import http from 'node:http';

const clean = () => ({
  main: { status: 200, url: 'https://good.example/', chain: [{ url: 'https://good.example/', status: 200 }], setCookie: [],
    headers: { 'strict-transport-security': 'max-age=31536000', 'content-security-policy': "default-src 'self'; frame-ancestors 'self'", 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=()' } },
  httpRedirect: { url: 'https://good.example/' }, robotsTxt: { missing: false }, sitemap: { missing: false },
  desktop: { facts: { title: 'A well written page title', metaDescription: 'x'.repeat(100), h1Count: 1, canonical: 'https://good.example/', viewport: 'width=device-width', og: { title: 't', image: 'i' }, domNodes: 400, textLength: 2000 },
    perf: { ttfb: 200, fcp: 900, lcp: 1500, cls: 0.01, tbt: 50 }, resources: { count: 20, transfer: 400000, uncompressed: [], largeImages: [], uncached: [], thirdPartyHosts: [], consoleErrors: [], pageErrors: [], failed: [], httpErrors: [], mixed: [] },
    axe: { violations: [] } },
  mobile: { facts: { overflowX: false, smallTargets: 0, smallFonts: 0 } }, links: { checked: 10, broken: [] }, rawTextLength: 1800,
});
const ids = (f) => f.map((x) => x.id);

test('a clean site produces no findings and a perfect score', () => {
  const f = buildFindings(clean());
  assert.deepEqual(ids(f), []);
  const s = scoreCategories(f);
  assert.equal(s.overall, 100);
  assert.equal(gradeFor(s.overall), 'A');
});

test('missing security headers are each reported with sensible severity', () => {
  const d = clean(); d.main.headers = {};
  const f = buildFindings(d);
  for (const id of ['no-hsts', 'no-csp', 'no-nosniff', 'no-framing-protection', 'no-referrer-policy']) assert.ok(ids(f).includes(id), id);
  assert.equal(f.find((x) => x.id === 'no-hsts').severity, 'medium');
  assert.equal(f.find((x) => x.id === 'no-nosniff').severity, 'low');
});

test('frame-ancestors in CSP satisfies clickjacking protection', () => {
  const d = clean(); d.main.headers['x-frame-options'] = undefined;
  assert.ok(!ids(buildFindings(d)).includes('no-framing-protection'));
});

test('plain http site is critical; mixed content, cookies, version disclosure detected', () => {
  const d = clean(); d.main.url = 'http://good.example/'; d.main.headers['x-powered-by'] = 'PHP/7.4.1'; d.main.setCookie = ['sid=1; Path=/'];
  d.desktop.resources.mixed = ['http://cdn.example/x.js'];
  const f = buildFindings(d);
  assert.equal(f.find((x) => x.id === 'no-https').severity, 'critical');
  assert.ok(ids(f).includes('version-disclosure'));
  assert.ok(ids(f).includes('cookie-flags'));
});

test('performance thresholds', () => {
  const d = clean(); Object.assign(d.desktop.perf, { ttfb: 2000, lcp: 4500, cls: 0.3, fcp: 2000, tbt: 700 });
  const f = buildFindings(d);
  assert.equal(f.find((x) => x.id === 'slow-ttfb').severity, 'high');
  assert.equal(f.find((x) => x.id === 'slow-lcp').severity, 'high');
  assert.equal(f.find((x) => x.id === 'layout-shift').severity, 'high');
  assert.equal(f.find((x) => x.id === 'slow-fcp').severity, 'medium');
  assert.equal(f.find((x) => x.id === 'blocking-time').severity, 'high');
});

test('axe violations map to severities and keep samples', () => {
  const d = clean();
  d.desktop.axe.violations = [{ id: 'color-contrast', impact: 'serious', help: 'Elements must have sufficient color contrast', description: 'd', helpUrl: 'https://x', nodes: 3, samples: ['a: <p>'] }, { id: 'region', impact: 'moderate', help: 'Landmarks', description: 'd', helpUrl: 'https://y', nodes: 1, samples: [] }];
  const f = buildFindings(d);
  assert.equal(f.find((x) => x.id === 'a11y-color-contrast').severity, 'high');
  assert.equal(f.find((x) => x.id === 'a11y-region').severity, 'medium');
  assert.equal(f.find((x) => x.id === 'a11y-color-contrast').category, 'accessibility');
});

test('mobile overflow, missing viewport and client-rendered content', () => {
  const d = clean(); d.mobile.facts = { overflowX: true, scrollWidth: 700, innerWidth: 390, smallTargets: 6, smallTargetSamples: ['a.x'], smallFonts: 12 };
  d.desktop.facts.viewport = null; d.rawTextLength = 20;
  const f = buildFindings(d);
  for (const id of ['mobile-overflow', 'no-viewport', 'small-tap-targets', 'small-text', 'js-rendered']) assert.ok(ids(f).includes(id), id);
});

test('www certificate problem and broken links', () => {
  const d = clean(); d.www = { host: 'www.good.example', tlsProblem: 'ERR_TLS_CERT_ALTNAME_INVALID' };
  d.links = { checked: 12, broken: Array.from({ length: 5 }, (_, i) => ({ url: `https://x/${i}`, status: 404 })) };
  const f = buildFindings(d);
  assert.equal(f.find((x) => x.id === 'www-cert').severity, 'low');
  assert.equal(f.find((x) => x.id === 'broken-links').severity, 'high');
});

test('scores subtract by severity and floor at zero', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, category: 'security', severity: 'high' }));
  const s = scoreCategories(many);
  assert.equal(s.security, 0);
  assert.ok(s.overall < 90 && s.overall >= 0);
  assert.equal(gradeFor(59), 'F'); assert.equal(gradeFor(60), 'D'); assert.equal(gradeFor(85), 'B');
});

test('strategy ranks services from findings and builds four phases and test cases', () => {
  const d = clean(); d.main.headers = {}; d.desktop.perf.lcp = 5000;
  d.desktop.axe.violations = [{ id: 'label', impact: 'critical', help: 'Form elements must have labels', description: 'd', helpUrl: 'u', nodes: 2, samples: [] }];
  const findings = buildFindings(d); const scores = scoreCategories(findings);
  const st = buildStrategy({ findings, scores, profile: { forms: 1, hasLogin: true, hasSearch: false, navLinks: 4, thirdParties: 0 }, target: 'https://good.example/' });
  assert.ok(st.services.length >= 3);
  assert.equal(st.services[0].priority, 'Start here');
  const names = st.services.map((s) => s.id);
  assert.ok(names.includes('security') && names.includes('performance') && names.includes('usability'));
  assert.equal(st.phases.length, 4);
  assert.deepEqual(st.phases.map((p) => p.key), ['gate', 'fix', 'deep', 'sustain']);
  assert.ok(st.phases[0].items.includes('A user can sign in and out'));
  assert.ok(st.testCases.length >= 4 && st.testCases.length <= 18);
  assert.ok(st.testCases.every((c) => c.id && c.title && c.steps.length && c.expected));
  assert.equal(st.narrative.source, 'rules');
  assert.match(st.narrative.executiveSummary, /out of 100/);
  // deterministic
  const again = buildStrategy({ findings, scores, profile: { forms: 1, hasLogin: true, hasSearch: false, navLinks: 4, thirdParties: 0 }, target: 'https://good.example/' });
  assert.deepEqual(again, st);
});

test('AI narrative: rules fallback without key, validated JSON with a (mock) key, fallback on bad output', async () => {
  const findings = buildFindings(clean()); const scores = scoreCategories(findings);
  const strategy = buildStrategy({ findings, scores, profile: { forms: 0 }, target: 'https://good.example/' });
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal((await narrate({ target: 'https://good.example/', scores, findings, strategy })).source, 'rules');

  let seen;
  const mock = http.createServer((q, r) => { let b = ''; q.on('data', (c) => (b += c)); q.on('end', () => { seen = { headers: q.headers, body: JSON.parse(b) };
    const reply = process.env.MOCK_REPLY || JSON.stringify({ executiveSummary: 'Looks healthy overall.', actions: ['Keep going', 'Add monitoring'] });
    r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ content: [{ type: 'text', text: reply }] })); }); });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  process.env.ANTHROPIC_API_KEY = 'test-key'; process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
  const ai = await narrate({ target: 'https://good.example/', scores, findings, strategy });
  assert.equal(ai.source, 'ai'); assert.equal(ai.actions.length, 2);
  assert.equal(seen.headers['x-api-key'], 'test-key');
  assert.ok(!JSON.stringify(seen.body).includes('data:image'), 'screenshots are never sent');
  process.env.MOCK_REPLY = 'not json at all';
  assert.equal((await narrate({ target: 'https://good.example/', scores, findings, strategy })).source, 'rules');
  process.env.MOCK_REPLY = JSON.stringify({ executiveSummary: 'x'.repeat(900), actions: ['a'] });
  assert.equal((await narrate({ target: 'https://good.example/', scores, findings, strategy })).source, 'rules');
  delete process.env.MOCK_REPLY; delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_BASE_URL;
  mock.close();
});
