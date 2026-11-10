// Turns collected measurements into findings.
// A finding: { id, category, severity, title, detail, evidence[], fix, services[], effort, testCase? }
// Categories: performance | accessibility | seo | security | reliability | mobile
// Severities: critical | high | medium | low | info

export const SERVICE_NAMES = {
  smoke: 'Smoke Testing', sanity: 'Sanity Testing', regression: 'Regression Testing', ticket: 'Ticket Testing',
  performance: 'Performance Testing', security: 'Security Testing', usability: 'Usability Testing', compatibility: 'Compatibility Testing',
  mobile: 'Mobile App Testing', hardware: 'Hardware Testing', iot: 'IoT Testing', chatbot: 'Chatbot Testing', arvr: 'AR / VR Testing',
  automation: 'Automation Testing', ai: 'Artificial Intelligence Testing', consulting: 'Strategic Consulting', management: 'Test Management & Reporting',
};

export const SEVERITY_WEIGHT = { critical: 40, high: 20, medium: 10, low: 4, info: 0 };

const kb = (n) => `${Math.round(n / 1024)} KB`;
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
const ms = (n) => `${Math.round(n)} ms`;
const trim = (s, n = 140) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

export function buildFindings(d) {
  const f = [];
  const add = (x) => f.push({ evidence: [], effort: 'M', ...x });

  const dk = d.desktop || {};
  const mo = d.mobile || {};
  const facts = dk.facts || {};
  const perf = dk.perf || {};
  const res = dk.resources || {};
  const main = d.main || {};
  const h = main.headers || {};
  const isHttps = /^https:/i.test(main.url || d.finalUrl || '');

  /* ---------------- reliability: can the page even be loaded? ---------------- */
  if (dk.loadError) {
    add({ id: 'load-failed', category: 'reliability', severity: 'critical', title: 'The page did not finish loading',
      detail: `The page could not be loaded in a real browser (${trim(dk.loadError, 160)}).`,
      fix: 'Check that the site is reachable, responds within a reasonable time, and does not block automated browsers by mistake.',
      services: ['smoke', 'performance'], effort: 'M',
      testCase: { title: 'Home page loads within 5 seconds on a clean browser session', steps: ['Open the home page in a new private window', 'Wait for the page to finish loading'], expected: 'The page is usable within 5 seconds and no error page is shown' } });
  }
  if (main.status >= 400) {
    add({ id: 'main-status', category: 'reliability', severity: 'critical', title: `The page responded with HTTP ${main.status}`,
      detail: 'The address you gave returned an error status instead of a page.', fix: 'Fix the route or server error, or audit a different address.', services: ['smoke', 'regression'], effort: 'S' });
  }
  if (res.pageErrors && res.pageErrors.length) {
    add({ id: 'js-exceptions', category: 'reliability', severity: 'high', title: `${res.pageErrors.length} uncaught JavaScript error${res.pageErrors.length > 1 ? 's' : ''}`,
      detail: 'Uncaught exceptions usually mean part of the page silently stops working for some visitors.',
      evidence: res.pageErrors.slice(0, 4).map((e) => trim(e)), fix: 'Reproduce each error in the browser console, fix the cause, and add a regression check for it.',
      services: ['regression', 'smoke', 'automation'], effort: 'M',
      testCase: { title: 'No uncaught JavaScript errors on the home page', steps: ['Open the home page with the browser console open', 'Interact with the main controls'], expected: 'The console shows no uncaught exceptions' } });
  }
  if (res.consoleErrors && res.consoleErrors.length) {
    add({ id: 'console-errors', category: 'reliability', severity: res.consoleErrors.length > 5 ? 'high' : 'medium', title: `${res.consoleErrors.length} console error${res.consoleErrors.length > 1 ? 's' : ''} while loading`,
      detail: 'Errors logged to the console during load often point at failed requests, missing assets or broken scripts.',
      evidence: res.consoleErrors.slice(0, 4).map((e) => trim(e)), fix: 'Clear every error from a clean page load and keep the console quiet as a release criterion.', services: ['regression', 'smoke'], effort: 'S' });
  }
  if (res.failed && res.failed.length) {
    add({ id: 'failed-requests', category: 'reliability', severity: res.failed.length > 3 ? 'high' : 'medium', title: `${res.failed.length} request${res.failed.length > 1 ? 's' : ''} failed outright`,
      detail: 'Some files the page asked for never arrived (network error, blocked, or aborted).', evidence: res.failed.slice(0, 4).map((x) => trim(`${x.url} (${x.reason})`)),
      fix: 'Fix or remove references to unreachable resources.', services: ['regression', 'smoke'], effort: 'S' });
  }
  if (res.httpErrors && res.httpErrors.length) {
    add({ id: 'http-errors', category: 'reliability', severity: 'medium', title: `${res.httpErrors.length} file${res.httpErrors.length > 1 ? 's' : ''} returned an HTTP error`,
      detail: 'Images, scripts or data requests returned 4xx or 5xx responses.', evidence: res.httpErrors.slice(0, 4).map((x) => trim(`${x.status} ${x.url}`)),
      fix: 'Repair the broken references or restore the missing files.', services: ['regression', 'smoke'], effort: 'S' });
  }
  if (d.links && d.links.broken && d.links.broken.length) {
    const n = d.links.broken.length;
    add({ id: 'broken-links', category: 'reliability', severity: n >= 5 ? 'high' : 'medium', title: `${n} broken link${n > 1 ? 's' : ''} found (of ${d.links.checked} checked)`,
      detail: 'Visitors who click these links reach an error or nothing at all.', evidence: d.links.broken.slice(0, 5).map((x) => trim(`${x.status || x.error} ${x.url}`)),
      fix: 'Update or remove the links, and check links automatically on every release.', services: ['regression', 'automation'], effort: 'S',
      testCase: { title: 'Every link on the home page resolves', steps: ['Collect all links on the home page', 'Request each one'], expected: 'No link returns a 4xx or 5xx status' } });
  }
  if (main.chain && main.chain.length > 3) {
    add({ id: 'redirect-chain', category: 'performance', severity: 'low', title: `The address goes through ${main.chain.length - 1} redirects`,
      detail: 'Every redirect adds a full round trip before the page can start loading.', evidence: main.chain.map((c) => `${c.status} ${trim(c.url, 100)}`), fix: 'Redirect straight to the final address in one step.', services: ['performance'], effort: 'S' });
  }

  /* ---------------- performance ---------------- */
  const sev3 = (v, mid, high) => (v > high ? 'high' : v > mid ? 'medium' : null);
  if (perf.ttfb != null) {
    const s = sev3(perf.ttfb, 800, 1800);
    if (s) add({ id: 'slow-ttfb', category: 'performance', severity: s, title: `Slow server response (${ms(perf.ttfb)} to first byte)`, detail: 'The server takes a long time to start sending the page, which delays everything after it. Under 800 ms is a common target.',
      fix: 'Look at server-side rendering time, database calls, caching and hosting location. A CDN or page cache usually helps most.', services: ['performance'], effort: 'L' });
  }
  if (perf.fcp) {
    const s = sev3(perf.fcp, 1800, 3000);
    if (s) add({ id: 'slow-fcp', category: 'performance', severity: s, title: `Content appears slowly (first paint ${ms(perf.fcp)})`, detail: 'Visitors stare at a blank page for too long. Under 1.8 s is considered good.',
      fix: 'Reduce render-blocking scripts and styles, and inline the critical CSS.', services: ['performance'], effort: 'M' });
  }
  if (perf.lcp) {
    const s = sev3(perf.lcp, 2500, 4000);
    if (s) add({ id: 'slow-lcp', category: 'performance', severity: s, title: `Main content is slow to appear (LCP ${(perf.lcp / 1000).toFixed(1)} s)`, detail: 'Largest Contentful Paint measures when the main content is visible. Under 2.5 s is considered good.',
      fix: 'Optimise the largest image or text block, preload it, and cut the work that runs before it.', services: ['performance'], effort: 'M',
      testCase: { title: 'Largest Contentful Paint stays under 2.5 s', steps: ['Load the home page on a throttled connection', 'Record LCP three times'], expected: 'Median LCP is 2.5 s or lower' } });
  }
  if (perf.cls != null && perf.cls > 0.1) {
    add({ id: 'layout-shift', category: 'performance', severity: perf.cls > 0.25 ? 'high' : 'medium', title: `Layout jumps while loading (CLS ${perf.cls.toFixed(2)})`, detail: 'Content moves around as the page loads, causing mis-clicks and a jittery feel. Under 0.1 is considered good.',
      fix: 'Reserve space for images, embeds and late-loading banners with explicit width and height.', services: ['performance', 'usability'], effort: 'M' });
  }
  if (perf.tbt != null && perf.tbt > 200) {
    add({ id: 'blocking-time', category: 'performance', severity: perf.tbt > 600 ? 'high' : 'medium', title: `The page is unresponsive for ${ms(perf.tbt)} while loading`, detail: 'Long JavaScript tasks block the browser from responding to taps and clicks.',
      fix: 'Split large scripts, defer non-critical code, and remove unused libraries.', services: ['performance'], effort: 'L' });
  }
  if (res.transfer) {
    const s = res.transfer > 5 * 1048576 ? 'high' : res.transfer > 2 * 1048576 ? 'medium' : null;
    if (s) add({ id: 'page-weight', category: 'performance', severity: s, title: `Heavy page (${mb(res.transfer)} transferred)`, detail: 'Large pages are slow on mobile data and cost visitors money. Under 2 MB is a common budget.',
      fix: 'Compress and resize images, drop unused scripts, and lazy-load below-the-fold media.', services: ['performance', 'mobile'], effort: 'M' });
  }
  if (res.count > 80) {
    add({ id: 'request-count', category: 'performance', severity: res.count > 150 ? 'medium' : 'low', title: `${res.count} requests to load one page`, detail: 'Each request adds overhead, especially on slow connections.', fix: 'Bundle assets, remove unused third-party tags, and use sprites or inline SVG for small icons.', services: ['performance'], effort: 'M' });
  }
  if (res.uncompressed && res.uncompressed.length) {
    add({ id: 'no-compression', category: 'performance', severity: 'medium', title: `${res.uncompressed.length} text file${res.uncompressed.length > 1 ? 's' : ''} sent uncompressed`, detail: 'HTML, CSS and JavaScript compress by 60 to 80 percent with gzip or Brotli.',
      evidence: res.uncompressed.slice(0, 4).map((x) => `${kb(x.size)} ${trim(x.url, 100)}`), fix: 'Enable gzip or Brotli on the server or CDN.', services: ['performance'], effort: 'S' });
  }
  if (res.largeImages && res.largeImages.length) {
    add({ id: 'large-images', category: 'performance', severity: res.largeImages.length > 3 ? 'medium' : 'low', title: `${res.largeImages.length} oversized image${res.largeImages.length > 1 ? 's' : ''}`, detail: 'Images over 300 KB slow down the first view.',
      evidence: res.largeImages.slice(0, 4).map((x) => `${kb(x.size)} ${trim(x.url, 100)}`), fix: 'Resize to the displayed size and serve WebP or AVIF.', services: ['performance'], effort: 'S' });
  }
  if (res.uncached && res.uncached.length > 3) {
    add({ id: 'no-caching', category: 'performance', severity: 'low', title: `${res.uncached.length} static files have no caching rules`, detail: 'Without cache headers, returning visitors download the same files again.', fix: 'Set long-lived Cache-Control headers on versioned static files.', services: ['performance'], effort: 'S' });
  }
  if (res.thirdPartyHosts && res.thirdPartyHosts.length > 10) {
    add({ id: 'third-parties', category: 'performance', severity: 'low', title: `Content loaded from ${res.thirdPartyHosts.length} other domains`, detail: 'Every third-party domain adds a connection, a privacy consideration and a point of failure.',
      evidence: res.thirdPartyHosts.slice(0, 6), fix: 'Remove tags you no longer use and self-host critical assets.', services: ['performance', 'security'], effort: 'M' });
  }
  if (facts.domNodes > 1500) {
    add({ id: 'dom-size', category: 'performance', severity: facts.domNodes > 3000 ? 'medium' : 'low', title: `Large page structure (${facts.domNodes} elements)`, detail: 'A very large DOM slows rendering and interaction.', fix: 'Simplify the markup and virtualise long lists.', services: ['performance'], effort: 'M' });
  }
  if (facts.blockingScripts > 0) {
    add({ id: 'blocking-scripts', category: 'performance', severity: 'low', title: `${facts.blockingScripts} script${facts.blockingScripts > 1 ? 's' : ''} in the head block rendering`, detail: 'Scripts without async or defer stop the page from drawing until they download and run.', fix: 'Add defer to scripts that do not need to run before first paint.', services: ['performance'], effort: 'S' });
  }

  /* ---------------- security ---------------- */
  if (d.main && !d.main.error) {
    if (!isHttps) {
      add({ id: 'no-https', category: 'security', severity: 'critical', title: 'The site is not served over HTTPS', detail: 'Everything sent between visitors and the site, including form entries and cookies, can be read or altered in transit.',
        fix: 'Install a TLS certificate and redirect all HTTP traffic to HTTPS.', services: ['security'], effort: 'S' });
    } else {
      if (d.httpRedirect && !d.httpRedirect.error && /^http:/i.test(d.httpRedirect.url || '')) {
        add({ id: 'no-https-redirect', category: 'security', severity: 'medium', title: 'The http:// address does not redirect to HTTPS', detail: 'Visitors who type or follow an http:// link stay on an unencrypted page.', fix: 'Redirect http:// to https:// with a 301, then enable HSTS.', services: ['security'], effort: 'S' });
      }
      if (!h['strict-transport-security']) {
        add({ id: 'no-hsts', category: 'security', severity: 'medium', title: 'No HSTS header', detail: 'Without Strict-Transport-Security, browsers may still try plain HTTP first and are open to downgrade attacks.', fix: 'Send Strict-Transport-Security: max-age=31536000; includeSubDomains.', services: ['security'], effort: 'S' });
      } else {
        const m = /max-age=(\d+)/i.exec(h['strict-transport-security']);
        if (!m || Number(m[1]) < 15552000) add({ id: 'weak-hsts', category: 'security', severity: 'low', title: 'HSTS lifetime is short', detail: 'A max-age below six months gives limited protection.', fix: 'Raise max-age to at least 15552000 (180 days), ideally one year.', services: ['security'], effort: 'S' });
      }
    }
    const csp = h['content-security-policy'];
    if (!csp) {
      add({ id: 'no-csp', category: 'security', severity: 'medium', title: 'No Content-Security-Policy', detail: 'A CSP limits what scripts and resources the page may load, which blunts cross-site scripting attacks.', fix: 'Start with a report-only policy, then enforce one that lists the sources you really use.', services: ['security'], effort: 'M' });
    } else if (/(script-src|default-src)[^;]*'unsafe-inline'/i.test(csp) || /(script-src|default-src)[^;]*\*/.test(csp)) {
      add({ id: 'weak-csp', category: 'security', severity: 'low', title: 'Content-Security-Policy is permissive', detail: "The policy allows 'unsafe-inline' or wildcard script sources, which weakens its protection.", fix: 'Use nonces or hashes instead of unsafe-inline, and list specific hosts.', services: ['security'], effort: 'M' });
    }
    if (String(h['x-content-type-options'] || '').toLowerCase() !== 'nosniff') {
      add({ id: 'no-nosniff', category: 'security', severity: 'low', title: 'Missing X-Content-Type-Options: nosniff', detail: 'Browsers may guess file types and execute content that should not run.', fix: 'Send X-Content-Type-Options: nosniff.', services: ['security'], effort: 'S' });
    }
    if (!h['x-frame-options'] && !/frame-ancestors/i.test(csp || '')) {
      add({ id: 'no-framing-protection', category: 'security', severity: 'medium', title: 'The page can be embedded in other sites', detail: 'Without X-Frame-Options or CSP frame-ancestors, attackers can frame your pages to trick visitors into clicking (clickjacking).', fix: "Send X-Frame-Options: DENY or CSP frame-ancestors 'self'.", services: ['security'], effort: 'S' });
    }
    if (!h['referrer-policy']) {
      add({ id: 'no-referrer-policy', category: 'security', severity: 'low', title: 'No Referrer-Policy', detail: 'Full page addresses, which can contain private data, may be sent to other sites you link to.', fix: 'Send Referrer-Policy: strict-origin-when-cross-origin.', services: ['security'], effort: 'S' });
    }
    if (!h['permissions-policy']) {
      add({ id: 'no-permissions-policy', category: 'security', severity: 'info', title: 'No Permissions-Policy', detail: 'You cannot restrict powerful browser features (camera, microphone, location) for the page and any embeds.', fix: 'Send a Permissions-Policy that disables features you do not use.', services: ['security'], effort: 'S' });
    }
    if (h['x-powered-by'] || /\d+\.\d+/.test(h.server || '')) {
      add({ id: 'version-disclosure', category: 'security', severity: 'low', title: 'Server software details are exposed', detail: 'Headers reveal technology and versions that make targeted attacks easier.', evidence: [h['x-powered-by'] && `X-Powered-By: ${h['x-powered-by']}`, /\d+\.\d+/.test(h.server || '') && `Server: ${h.server}`].filter(Boolean), fix: 'Remove X-Powered-By and trim the Server header.', services: ['security'], effort: 'S' });
    }
    const cookies = (d.main.setCookie || []).map(parseCookie);
    const weak = cookies.filter((c) => (isHttps && !c.secure) || !c.httpOnly || !c.sameSite);
    if (weak.length) {
      add({ id: 'cookie-flags', category: 'security', severity: weak.some((c) => isHttps && !c.secure) ? 'medium' : 'low', title: `${weak.length} cookie${weak.length > 1 ? 's' : ''} missing protective flags`, detail: 'Cookies without Secure, HttpOnly or SameSite are easier to steal or misuse.',
        evidence: weak.slice(0, 5).map((c) => `${c.name}: ${[!c.secure && 'no Secure', !c.httpOnly && 'no HttpOnly', !c.sameSite && 'no SameSite'].filter(Boolean).join(', ')}`), fix: 'Set Secure, HttpOnly and SameSite=Lax (or Strict) on session and identity cookies.', services: ['security'], effort: 'S' });
    }
  }
  if (d.main && d.main.error && /CERT|TLS|SSL|ALTNAME|SELF_SIGNED|EXPIRED/i.test(`${d.main.error.code} ${d.main.error.message}`)) {
    add({ id: 'tls-invalid', category: 'security', severity: 'critical', title: 'The TLS certificate is not valid', detail: `Browsers will warn visitors away. (${trim(d.main.error.message, 120)})`, fix: 'Renew or reissue the certificate so it covers this exact hostname.', services: ['security'], effort: 'S' });
  }
  if (d.www && d.www.tlsProblem) {
    add({ id: 'www-cert', category: 'security', severity: 'low', title: `The www version of the domain has a certificate problem`, detail: `https://${d.www.host} fails its certificate check (${d.www.tlsProblem}). Anyone who types the www address sees a browser warning.`,
      fix: 'Add the www name to the certificate, or redirect it to the main domain over a valid certificate.', services: ['security'], effort: 'S' });
  }
  if (res.mixed && res.mixed.length) {
    add({ id: 'mixed-content', category: 'security', severity: 'high', title: `${res.mixed.length} insecure (http) resource${res.mixed.length > 1 ? 's' : ''} on an HTTPS page`, detail: 'Mixed content is blocked or flagged by browsers and can be tampered with.', evidence: res.mixed.slice(0, 4).map((u) => trim(u)), fix: 'Load every resource over https://.', services: ['security', 'regression'], effort: 'S' });
  }

  /* ---------------- SEO ---------------- */
  const title = (facts.title || '').trim();
  if (!title) add({ id: 'no-title', category: 'seo', severity: 'high', title: 'The page has no title', detail: 'The title is the headline search engines and browser tabs show.', fix: 'Add a unique, descriptive <title> of 30 to 60 characters.', services: ['regression'], effort: 'S' });
  else if (title.length < 15 || title.length > 70) add({ id: 'title-length', category: 'seo', severity: 'low', title: `Title length is ${title.length} characters`, detail: 'Very short titles say little, and long ones are cut off in search results.', evidence: [title], fix: 'Aim for roughly 30 to 60 characters.', services: ['regression'], effort: 'S' });
  const desc = (facts.metaDescription || '').trim();
  if (!desc) add({ id: 'no-description', category: 'seo', severity: 'medium', title: 'No meta description', detail: 'Search engines build the snippet shown under your result from this text.', fix: 'Write a 70 to 160 character description for each page.', services: ['regression'], effort: 'S' });
  else if (desc.length < 50 || desc.length > 180) add({ id: 'description-length', category: 'seo', severity: 'low', title: `Meta description is ${desc.length} characters`, detail: 'Descriptions are cut off when long and look thin when short.', fix: 'Aim for roughly 70 to 160 characters.', services: ['regression'], effort: 'S' });
  if (facts.h1Count === 0) add({ id: 'no-h1', category: 'seo', severity: 'medium', title: 'No main heading (h1)', detail: 'A single clear h1 helps search engines and screen-reader users understand the page.', fix: 'Add one h1 that states what the page is about.', services: ['usability'], effort: 'S' });
  else if (facts.h1Count > 1) add({ id: 'multiple-h1', category: 'seo', severity: 'low', title: `${facts.h1Count} main headings (h1) on one page`, detail: 'Multiple h1 elements blur the page structure.', fix: 'Use one h1 and h2 to h6 for the rest.', services: ['usability'], effort: 'S' });
  if (!facts.canonical) add({ id: 'no-canonical', category: 'seo', severity: 'low', title: 'No canonical link', detail: 'Without a canonical address, search engines may treat duplicate URLs as separate pages.', fix: 'Add <link rel="canonical"> pointing to the preferred address.', services: ['regression'], effort: 'S' });
  if (facts.robots && /noindex/i.test(facts.robots)) add({ id: 'noindex', category: 'seo', severity: 'high', title: 'The page asks search engines not to index it', detail: 'A noindex robots directive keeps the page out of search results.', evidence: [`robots: ${facts.robots}`], fix: 'Remove noindex unless it is intentional.', services: ['regression'], effort: 'S' });
  if (!facts.og || !facts.og.title || !facts.og.image) add({ id: 'no-open-graph', category: 'seo', severity: 'low', title: 'Incomplete social sharing tags', detail: 'Links shared on social networks and chat apps will show a bare or wrong preview.', fix: 'Add og:title, og:description and og:image.', services: ['regression'], effort: 'S' });
  if (d.robotsTxt && d.robotsTxt.missing) add({ id: 'no-robots-txt', category: 'seo', severity: 'low', title: 'No robots.txt', detail: 'Crawlers look for /robots.txt to learn what they may fetch.', fix: 'Publish a robots.txt that points to your sitemap.', services: ['regression'], effort: 'S' });
  if (d.sitemap && d.sitemap.missing) add({ id: 'no-sitemap', category: 'seo', severity: 'low', title: 'No sitemap.xml', detail: 'A sitemap helps search engines discover every page.', fix: 'Generate a sitemap.xml and list it in robots.txt.', services: ['regression'], effort: 'S' });
  if (d.rawTextLength != null && d.rawTextLength < 200 && facts.textLength > 800) {
    add({ id: 'js-rendered', category: 'seo', severity: 'medium', title: 'Page content only appears after JavaScript runs', detail: `The raw HTML holds about ${d.rawTextLength} characters of text, but the loaded page shows ${facts.textLength}. Search engines, link previews and slow devices may see an empty page.`,
      fix: 'Pre-render or server-render the key content so it is present in the first HTML response.', services: ['performance', 'regression'], effort: 'L' });
  }

  /* ---------------- accessibility (axe-core) ---------------- */
  const impactSev = { critical: 'high', serious: 'high', moderate: 'medium', minor: 'low' };
  for (const v of (dk.axe && dk.axe.violations) || []) {
    add({ id: `a11y-${v.id}`, category: 'accessibility', severity: impactSev[v.impact] || 'low', title: `${v.help} (${v.nodes} element${v.nodes > 1 ? 's' : ''})`,
      detail: v.description, evidence: v.samples, fix: `See the rule guidance: ${v.helpUrl}`, services: ['usability', 'compatibility'], effort: v.nodes > 20 ? 'L' : 'M',
      testCase: { title: `Accessibility: ${v.help}`, steps: ['Run an automated accessibility scan on the page', 'Check the flagged elements with a screen reader or keyboard'], expected: 'The rule reports no violations' } });
  }
  if (facts.unlabeledInputs > 0 && !((dk.axe && dk.axe.violations) || []).some((v) => v.id === 'label')) {
    add({ id: 'unlabeled-inputs', category: 'accessibility', severity: 'medium', title: `${facts.unlabeledInputs} form field${facts.unlabeledInputs > 1 ? 's' : ''} without a label`, detail: 'Screen-reader users cannot tell what to enter.', fix: 'Associate every input with a visible <label>.', services: ['usability'], effort: 'S' });
  }

  /* ---------------- mobile ---------------- */
  const mf = mo.facts || {};
  if (!facts.viewport) add({ id: 'no-viewport', category: 'mobile', severity: 'high', title: 'No mobile viewport setting', detail: 'Without <meta name="viewport">, phones show a zoomed-out desktop layout.', fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.', services: ['mobile', 'compatibility'], effort: 'S' });
  if (mf.overflowX) add({ id: 'mobile-overflow', category: 'mobile', severity: 'high', title: 'The page scrolls sideways on a phone', detail: `At phone width (${mf.innerWidth}px) the content is ${mf.scrollWidth}px wide, so visitors must scroll horizontally.`, fix: 'Find the element that is wider than the screen (often a table, image or fixed-width block) and make it fluid.', services: ['mobile', 'compatibility', 'usability'], effort: 'M',
    testCase: { title: 'No horizontal scrolling at 360, 390 and 768 px wide', steps: ['Open the home page at each width', 'Scroll the page horizontally'], expected: 'The page does not scroll sideways at any of these widths' } });
  if (mf.smallTargets > 0) add({ id: 'small-tap-targets', category: 'mobile', severity: mf.smallTargets >= 5 ? 'medium' : 'low', title: `${mf.smallTargets} tap target${mf.smallTargets > 1 ? 's' : ''} smaller than 24 px`, detail: 'Small buttons and controls are hard to hit with a thumb (WCAG 2.2 sets 24 by 24 px as the minimum).', evidence: (mf.smallTargetSamples || []).slice(0, 4), fix: 'Make controls at least 24 px, ideally 44 px, with enough space between them.', services: ['mobile', 'usability'], effort: 'S' });
  if (mf.smallFonts >= 10) add({ id: 'small-text', category: 'mobile', severity: 'low', title: `${mf.smallFonts} text blocks smaller than 12 px`, detail: 'Tiny text is hard to read on a phone.', fix: 'Use at least 14 to 16 px for body text.', services: ['mobile', 'usability'], effort: 'S' });

  return f;
}

function parseCookie(line) {
  const parts = String(line).split(';').map((s) => s.trim());
  const [name] = parts[0].split('=');
  const attrs = parts.slice(1).map((s) => s.toLowerCase());
  return { name, secure: attrs.includes('secure'), httpOnly: attrs.includes('httponly'), sameSite: attrs.some((a) => a.startsWith('samesite=')) };
}

export function scoreCategories(findings) {
  const cats = ['performance', 'accessibility', 'seo', 'security', 'reliability', 'mobile'];
  const scores = {};
  for (const c of cats) {
    const penalty = findings.filter((x) => x.category === c).reduce((s, x) => s + SEVERITY_WEIGHT[x.severity], 0);
    scores[c] = Math.max(0, Math.round(100 - penalty));
  }
  const w = { performance: 20, accessibility: 20, security: 20, reliability: 15, mobile: 15, seo: 10 };
  scores.overall = Math.round(cats.reduce((s, c) => s + scores[c] * w[c], 0) / 100);
  return scores;
}

export function gradeFor(score) {
  return score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
}
