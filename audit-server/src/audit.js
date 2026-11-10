// Collects measurements from a public URL using a real browser, then hands them to checks + strategy.
// Passive only: loads the page like a visitor, reads response headers, requests a small sample of links.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { parseTarget, makeRequestGuard, isPrivateIp, isLoopbackIp, loopbackEnabled, TargetError } from './security.js';
import { safeRequest } from './http.js';
import { buildFindings, scoreCategories, gradeFor } from './checks.js';
import { buildStrategy } from './strategy.js';
import { narrate } from './llm.js';

const require = createRequire(import.meta.url);
const AXE_SOURCE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
export const VERSION = '1.0.0';

let browserPromise = null;
export async function getBrowser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b && b.isConnected()) return b;
    browserPromise = null;
  }
  const opts = { headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu'] };
  if (process.env.CHROMIUM_PATH) opts.executablePath = process.env.CHROMIUM_PATH;
  if (process.env.AUDIT_PROXY) opts.proxy = { server: process.env.AUDIT_PROXY };
  browserPromise = chromium.launch(opts);
  return browserPromise;
}
export async function closeBrowser() {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  if (b) await b.close().catch(() => {});
}

const INIT_SCRIPT = `(() => {
  const q = (window.__qa = { lcp: 0, cls: 0, tbt: 0 });
  const obs = (type, fn) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch (e) {} };
  obs('largest-contentful-paint', (e) => { q.lcp = e.renderTime || e.loadTime || e.startTime; });
  obs('layout-shift', (e) => { if (!e.hadRecentInput) q.cls += e.value; });
  obs('longtask', (e) => { q.tbt += Math.max(0, e.duration - 50); });
})();`;

// Runs inside the page. Must be self-contained.
function domFacts() {
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const meta = (n) => { const m = document.querySelector(`meta[name="${n}"]`); return m ? m.getAttribute('content') : null; };
  const prop = (p) => { const m = document.querySelector(`meta[property="${p}"]`); return m ? m.getAttribute('content') : null; };
  const css = (el) => getComputedStyle(el);
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = css(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''}`;

  const targets = $$('button, input:not([type=hidden]), select, textarea, [role=button], a[href]').filter((el) => {
    if (!visible(el)) return false;
    if (el.tagName === 'A' && css(el).display === 'inline') return false; // inline text links are exempt
    return true;
  });
  const small = targets.filter((el) => { const r = el.getBoundingClientRect(); return r.width < 24 || r.height < 24; });
  const fonts = $$('p, li, span, a, td, label, button, div').filter((el) => {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return false;
    return visible(el) && parseFloat(css(el).fontSize) < 12;
  });
  const inputs = $$('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea').filter(visible);
  const unlabeled = inputs.filter((i) => !(i.labels && i.labels.length) && !i.getAttribute('aria-label') && !i.getAttribute('aria-labelledby') && !i.getAttribute('title'));
  const text = document.body ? document.body.innerText || '' : '';
  return {
    title: document.title, lang: document.documentElement.lang || null,
    metaDescription: meta('description'), viewport: meta('viewport'), robots: meta('robots'),
    canonical: (document.querySelector('link[rel="canonical"]') || {}).href || null,
    og: { title: prop('og:title'), description: prop('og:description'), image: prop('og:image') },
    h1Count: $$('h1').length,
    headings: $$('h1,h2').slice(0, 20).map((h) => h.textContent.trim().slice(0, 80)),
    images: $$('img').length,
    forms: $$('form').length, hasPassword: !!document.querySelector('input[type=password]'),
    hasSearch: !!document.querySelector('input[type=search], [role=search]'),
    navLinks: $$('nav a[href]').length,
    scripts: $$('script[src]').length,
    blockingScripts: $$('head script[src]:not([async]):not([defer]):not([type=module])').length,
    domNodes: document.getElementsByTagName('*').length,
    textLength: text.trim().length,
    jsonLd: $$('script[type="application/ld+json"]').length,
    unlabeledInputs: unlabeled.length,
    smallTargets: small.length, smallTargetSamples: small.slice(0, 5).map(label),
    smallFonts: fonts.length,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
    links: $$('a[href]').map((a) => a.href).filter((h) => /^https?:/i.test(h)),
  };
}

async function measurePage(browser, targetUrl, guard, { mobile, withAxe }) {
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 };
  const ctx = await browser.newContext({
    viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, bypassCSP: true, serviceWorkers: 'block', acceptDownloads: false,
    ignoreHTTPSErrors: process.env.AUDIT_IGNORE_CERT_ERRORS === '1', // sandbox testing only; certificate errors are reported otherwise
    userAgent: mobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 QualacesAuditBot/1.0'
      : undefined,
  });
  const out = { resources: {}, loadError: null };
  let tainted = false;
  const blocked = [];
  const origin = new URL(targetUrl).origin;
  const resources = [];
  const consoleErrors = [];
  const pageErrors = [];
  const failed = [];
  const httpErrors = [];
  const mixed = [];
  const checkAddr = !process.env.AUDIT_PROXY;

  try {
    await ctx.route('**/*', async (route) => {
      const url = route.request().url();
      if (await guard(url)) return route.continue().catch(() => {});
      blocked.push(url);
      return route.abort('blockedbyclient').catch(() => {});
    });
    const page = await ctx.newPage();
    await page.addInitScript(INIT_SCRIPT);
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('requestfailed', (r) => {
      const reason = (r.failure() && r.failure().errorText) || 'failed';
      if (reason.includes('BLOCKED_BY_CLIENT') || reason.includes('ERR_ABORTED')) return;
      failed.push({ url: r.url(), reason });
    });
    page.on('response', async (r) => {
      const u = r.url();
      const status = r.status();
      if (checkAddr) {
        const sa = await r.serverAddr().catch(() => null);
        if (sa && isPrivateIp(sa.ipAddress) && !(loopbackEnabled() && isLoopbackIp(sa.ipAddress))) tainted = true;
      }
      if (status >= 400 && r.request().resourceType() !== 'document') httpErrors.push({ url: u, status });
      if (/^https:/i.test(targetUrl) && /^http:/i.test(u)) mixed.push(u);
      const h = r.headers();
      resources.push({ url: u, status, type: r.request().resourceType(), encoding: h['content-encoding'] || null, cache: h['cache-control'] || h.expires || null, ctype: h['content-type'] || '', req: r.request() });
    });

    let mainResp = null;
    try {
      mainResp = await page.goto(targetUrl, { waitUntil: 'load', timeout: 25000 });
      await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
      // brief scroll so lazy content and layout shifts are exercised
      await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight && y < 6000; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); }).catch(() => {});
      await page.waitForTimeout(400);
    } catch (e) {
      out.loadError = String(e.message || e).split('\n')[0];
    }
    if (tainted) throw new TargetError('The site connected to a non-public address, so the audit was stopped.');

    out.finalUrl = page.url();
    if (out.finalUrl && out.finalUrl !== 'about:blank') {
      out.facts = await page.evaluate(domFacts).catch(() => ({}));
      out.perf = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0] || {};
        const fcp = (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0;
        const q = window.__qa || {};
        return { ttfb: nav.responseStart || 0, dcl: nav.domContentLoadedEventEnd || 0, load: nav.loadEventEnd || 0, fcp, lcp: q.lcp || 0, cls: q.cls || 0, tbt: q.tbt || 0 };
      }).catch(() => ({}));
      if (withAxe) {
        try {
          await page.evaluate(AXE_SOURCE);
          const r = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }, resultTypes: ['violations'] }));
          out.axe = {
            violations: r.violations.map((v) => ({
              id: v.id, impact: v.impact, help: v.help, description: v.description, helpUrl: v.helpUrl, nodes: v.nodes.length,
              samples: v.nodes.slice(0, 3).map((n) => `${(n.target || []).join(' ')}: ${String(n.html || '').slice(0, 110)}`),
            })),
          };
        } catch { out.axe = { violations: [] }; }
      }
      const shot = await page.screenshot({ type: 'jpeg', quality: 55 }).catch(() => null);
      if (shot) out.screenshot = 'data:image/jpeg;base64,' + shot.toString('base64');
    }

    // Resource accounting
    let transfer = 0;
    const uncompressed = [];
    const largeImages = [];
    const uncached = [];
    const hosts = new Set();
    for (const r of resources) {
      let size = 0;
      try { const s = await r.req.sizes(); size = (s.responseBodySize || 0) + (s.responseHeadersSize || 0); } catch { /* ignore */ }
      transfer += size;
      try { const host = new URL(r.url).hostname; if (new URL(r.url).origin !== origin) hosts.add(host); } catch { /* ignore */ }
      if (/^data:/.test(r.url)) continue;
      const isText = /(text\/html|text\/css|javascript|json|svg|xml)/i.test(r.ctype);
      let body = 0;
      try { body = (await r.req.sizes()).responseBodySize || 0; } catch { /* ignore */ }
      if (isText && !r.encoding && body > 5000) uncompressed.push({ url: r.url, size: body });
      if (r.type === 'image' && body > 300 * 1024) largeImages.push({ url: r.url, size: body });
      if (['script', 'stylesheet', 'image', 'font'].includes(r.type) && !r.cache && new URL(r.url).origin === origin) uncached.push(r.url);
    }
    out.resources = {
      count: resources.length, transfer, uncompressed, largeImages, uncached, thirdPartyHosts: [...hosts],
      consoleErrors, pageErrors, failed, httpErrors, mixed, blocked,
    };
    out.mainStatus = mainResp ? mainResp.status() : null;
  } finally {
    await ctx.close().catch(() => {});
  }
  return out;
}

async function checkLinks(links, base, onItem) {
  const origin = new URL(base).origin;
  const uniq = [...new Set(links.map((l) => l.split('#')[0]))].filter((l) => l && l !== base);
  const sameOrigin = uniq.filter((l) => l.startsWith(origin));
  const external = process.env.AUDIT_EXTERNAL_LINKS === '0' ? [] : uniq.filter((l) => !l.startsWith(origin));
  const list = [...sameOrigin.slice(0, 20), ...external.slice(0, 10)];
  const broken = [];
  let unverified = 0;
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const url = list[next++];
      let r;
      try {
        r = await safeRequest(url, { method: 'HEAD', timeoutMs: 7000, maxBytes: 0 });
        if (!r.error && (r.status === 405 || r.status === 403 || r.status === 501)) r = await safeRequest(url, { method: 'GET', timeoutMs: 7000, maxBytes: 0 });
      } catch (e) { r = { error: { code: e.code || 'blocked' } }; }
      if (r.error && (r.error.code === 'blocked_target' || r.error.code === 'invalid_scheme')) continue;
      // Only definite failures count as broken. Timeouts, resets and temporary DNS problems are "unverified",
      // and 999 (LinkedIn's anti-bot code), 429 and 401 are not evidence of a broken link.
      const definite = ['dns_failed', 'ECONNREFUSED', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'too_many_redirects'];
      if (r.error) { if (definite.includes(r.error.code)) broken.push({ url, status: null, error: r.error.code }); else unverified++; }
      else if (r.status >= 400 && ![999, 429, 401].includes(r.status)) broken.push({ url, status: r.status, error: null });
    }
  }
  await Promise.all(Array.from({ length: 5 }, worker));
  return { checked: list.length - unverified, unverified, broken };
}

function visibleText(html) {
  return String(html).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().length;
}

export const LIMITATIONS = [
  'One page is measured in depth (plus a small sample of its links). Other pages can behave differently.',
  'Only Chromium is used, so cross-browser and real-device behaviour is not measured.',
  'Checks are passive: the audit loads the page like a visitor and reads public headers. It is not a penetration test.',
  'Performance numbers come from one run from one location and will vary with your hosting, network and time of day.',
  'Automated accessibility scanning finds roughly a third of real-world issues. Manual testing is still needed.',
];

/**
 * Run a full audit. onProgress(step, label, percent) is called as work proceeds.
 */
export async function runAudit(input, { onProgress = () => {} } = {}) {
  const started = Date.now();
  const url = parseTarget(input);
  const guard = makeRequestGuard();
  const step = (key, label, pct) => onProgress(key, label, pct);

  step('connect', 'Connecting and reading response headers', 5);
  const main = await safeRequest(url, { method: 'GET', timeoutMs: 15000, maxBytes: 600 * 1024 });
  if (main.error && main.error.code === 'dns_failed') throw new TargetError(main.error.message, 'dns_failed');

  const data = { main: main.error ? { error: main.error, url: main.url, chain: main.chain } : main, finalUrl: main.url };
  if (!main.error) data.rawTextLength = visibleText(main.body || '');
  if (data.main && data.main.body) delete data.main.body;

  step('transport', 'Checking HTTPS redirect, robots.txt and sitemap', 14);
  const host = url.hostname;
  const tasks = [];
  if (url.protocol === 'https:' || !main.error) {
    tasks.push(safeRequest(`http://${host}/`, { method: 'HEAD', timeoutMs: 8000 }).then((r) => { data.httpRedirect = r; }).catch(() => {}));
  }
  const base = new URL(main.error ? url.href : main.url);
  tasks.push(safeRequest(new URL('/robots.txt', base), { method: 'GET', timeoutMs: 8000, maxBytes: 2048 }).then((r) => { data.robotsTxt = { missing: !!r.error || r.status >= 400 || /<html/i.test(r.body || '') }; }).catch(() => { data.robotsTxt = { missing: true }; }));
  tasks.push(safeRequest(new URL('/sitemap.xml', base), { method: 'GET', timeoutMs: 8000, maxBytes: 2048 }).then((r) => { data.sitemap = { missing: !!r.error || r.status >= 400 || !/<(urlset|sitemapindex)/i.test(r.body || '') }; }).catch(() => { data.sitemap = { missing: true }; }));
  if (!/^www\./.test(host) && !/^\d+\.\d+\.\d+\.\d+$/.test(host) && !host.includes(':') && host.split('.').length === 2) {
    tasks.push(safeRequest(`https://www.${host}/`, { method: 'HEAD', timeoutMs: 8000 }).then((r) => {
      if (r.error && /CERT|ALTNAME|TLS|SSL|SELF_SIGNED/i.test(`${r.error.code} ${r.error.message}`)) data.www = { host: `www.${host}`, tlsProblem: String(r.error.code || r.error.message).slice(0, 60) };
    }).catch(() => {}));
  }
  await Promise.all(tasks);

  step('browser', 'Loading the page in a real desktop browser', 24);
  const browser = await getBrowser();
  const target = main.error ? url.href : main.url;
  const desktop = await measurePage(browser, target, guard, { mobile: false, withAxe: false });
  step('axe', 'Scanning for accessibility issues', 48);
  // Run axe on its own pass to keep its DOM changes out of the performance measurements.
  const a11y = await measurePage(browser, target, guard, { mobile: false, withAxe: true }).catch(() => ({}));
  desktop.axe = a11y.axe || { violations: [] };

  step('mobile', 'Checking the phone layout', 68);
  const mobile = await measurePage(browser, target, guard, { mobile: true, withAxe: false });

  step('links', 'Checking links', 80);
  const links = await checkLinks((desktop.facts && desktop.facts.links) || [], target);

  data.desktop = { facts: desktop.facts, perf: desktop.perf, resources: desktop.resources, axe: desktop.axe, loadError: desktop.loadError };
  data.mobile = { facts: mobile.facts };
  data.links = links;
  data.main.status = data.main.status || desktop.mainStatus;

  step('analyse', 'Building findings and your test strategy', 92);
  const findings = buildFindings(data);
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const scores = scoreCategories(findings);
  const facts = desktop.facts || {};
  const profile = {
    forms: facts.forms || 0, hasLogin: !!facts.hasPassword, hasSearch: !!facts.hasSearch, navLinks: facts.navLinks || 0,
    clientRendered: data.rawTextLength != null && data.rawTextLength < 200 && (facts.textLength || 0) > 800,
    thirdParties: ((desktop.resources || {}).thirdPartyHosts || []).length, https: /^https:/i.test(target),
  };
  const strategy = buildStrategy({ findings, scores, profile, target });
  strategy.narrative = await narrate({ target, scores, findings, strategy }).catch(() => strategy.narrative);

  const m = desktop.perf || {};
  const result = {
    version: VERSION,
    target: url.href, finalUrl: target, title: facts.title || null, auditedAt: new Date(started).toISOString(), durationMs: Date.now() - started,
    scores: { ...scores, grade: gradeFor(scores.overall) },
    metrics: {
      ttfb: m.ttfb, fcp: m.fcp, lcp: m.lcp, cls: m.cls, tbt: m.tbt, load: m.load,
      transferBytes: (desktop.resources || {}).transfer, requests: (desktop.resources || {}).count, domNodes: facts.domNodes,
      linksChecked: links.checked, linksUnverified: links.unverified, brokenLinks: links.broken.length,
    },
    counts: Object.fromEntries(['critical', 'high', 'medium', 'low', 'info'].map((s) => [s, findings.filter((f) => f.severity === s).length])),
    findings, strategy,
    screenshots: { desktop: desktop.screenshot || null, mobile: mobile.screenshot || null },
    limitations: LIMITATIONS,
  };
  step('done', 'Done', 100);
  return result;
}
