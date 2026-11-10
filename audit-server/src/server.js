// HTTP API for the audit service. No framework: node:http only.
//
//   POST /api/audit        { url, consent: true }  -> 202 { id }
//   GET  /api/audit/:id                            -> { status, percent, steps[], result?, error? }
//   GET  /api/health
//
// Environment: PORT, ALLOWED_ORIGINS (comma list, or *), TRUST_PROXY=1 (use X-Forwarded-For),
// RATE_LIMIT_PER_HOUR (default 6), MAX_CONCURRENT (default 2), MAX_QUEUE (default 20),
// AUDIT_TIMEOUT_MS (default 100000), ANTHROPIC_API_KEY (optional), CHROMIUM_PATH, AUDIT_PROXY.

import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseTarget, TargetError } from './security.js';

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

export function createServer({ auditFn, env = process.env, now = () => Date.now() } = {}) {
  const MAX_CONCURRENT = num(env.MAX_CONCURRENT, 2);
  const MAX_QUEUE = num(env.MAX_QUEUE, 20);
  const RATE = num(env.RATE_LIMIT_PER_HOUR, 6);
  const TIMEOUT = num(env.AUDIT_TIMEOUT_MS, 100000);
  const TTL = 60 * 60 * 1000;
  const CACHE_TTL = 10 * 60 * 1000;
  const origins = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

  const jobs = new Map();
  const queue = [];
  const hits = new Map(); // ip -> [timestamps]
  const recent = new Map(); // normalised url -> { id, at }
  let running = 0;

  function sweep() {
    const t = now();
    for (const [id, j] of jobs) if (t - j.createdAt > TTL) jobs.delete(id);
    for (const [k, v] of recent) if (t - v.at > CACHE_TTL) recent.delete(k);
    for (const [ip, arr] of hits) { const keep = arr.filter((x) => t - x < 3600000); keep.length ? hits.set(ip, keep) : hits.delete(ip); }
  }
  const sweeper = setInterval(sweep, 60000);
  sweeper.unref();

  function pump() {
    while (running < MAX_CONCURRENT && queue.length) {
      const job = queue.shift();
      running++;
      job.status = 'running';
      job.steps.push({ key: 'start', label: 'Starting', at: now() });
      let timer;
      const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('The audit took too long and was stopped.'), { code: 'timeout' })), TIMEOUT); });
      const work = auditFn(job.url, { onProgress: (key, label, percent) => { job.percent = percent; job.steps.push({ key, label, at: now() }); } });
      Promise.race([work, timeout])
        .then((result) => { job.status = 'done'; job.percent = 100; job.result = result; })
        .catch((e) => {
          job.status = 'error';
          const known = e instanceof TargetError || e.code === 'timeout';
          job.error = { code: e.code || 'audit_failed', message: known ? e.message : 'The audit could not be completed. The site may be blocking automated browsers or timing out.' };
          if (!known) console.error('audit failed', e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e);
          recent.delete(job.key);
        })
        .finally(() => { clearTimeout(timer); work.catch(() => {}); running--; pump(); });
    }
  }

  function clientIp(req) {
    if (env.TRUST_PROXY === '1') {
      const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (xf) return xf;
    }
    return req.socket.remoteAddress || 'unknown';
  }

  function cors(req, res) {
    const origin = req.headers.origin;
    if (origins.includes('*')) res.setHeader('access-control-allow-origin', '*');
    else if (origin && origins.includes(origin)) { res.setHeader('access-control-allow-origin', origin); res.setHeader('vary', 'Origin'); }
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-max-age', '600');
  }

  function send(req, res, status, body) {
    cors(req, res);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(body));
  }

  // Reads up to `limit` bytes. Past the limit it keeps discarding input (so the client can read our
  // 413 reply) and the caller closes the connection once the reply is sent.
  function readBody(req, limit = 4096) {
    return new Promise((resolve, reject) => {
      let size = 0; let over = false; const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) { if (!over) { over = true; reject(Object.assign(new Error('Request too large'), { status: 413 })); } }
        else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'OPTIONS') { cors(req, res); res.writeHead(204); return res.end(); }
      if (url.pathname === '/api/health' && req.method === 'GET') return send(req, res, 200, { ok: true, running, queued: queue.length });

      if (url.pathname === '/api/audit' && req.method === 'POST') {
        if (!/application\/json/i.test(req.headers['content-type'] || '')) return send(req, res, 415, { error: { code: 'bad_request', message: 'Send JSON.' } });
        let body;
        try { body = JSON.parse(await readBody(req)); } catch (e) {
          if (e.status === 413) { res.setHeader('connection', 'close'); res.on('finish', () => req.destroy()); }
          return send(req, res, e.status || 400, { error: { code: 'bad_request', message: e.status === 413 ? 'Request too large.' : 'Invalid request.' } });
        }
        if (!body || body.consent !== true) return send(req, res, 400, { error: { code: 'consent_required', message: 'Please confirm you own this site or have permission to test it.' } });
        let target;
        try { target = parseTarget(body.url); } catch (e) {
          return send(req, res, 400, { error: { code: e.code || 'invalid_url', message: e.message } });
        }
        const key = target.origin + target.pathname + target.search;
        const cached = recent.get(key);
        if (cached && jobs.has(cached.id) && jobs.get(cached.id).status !== 'error') return send(req, res, 202, { id: cached.id, cached: true });

        const ip = clientIp(req);
        const t = now();
        const arr = (hits.get(ip) || []).filter((x) => t - x < 3600000);
        if (arr.length >= RATE) {
          const retry = Math.ceil((3600000 - (t - arr[0])) / 60000);
          res.setHeader('retry-after', String(retry * 60));
          return send(req, res, 429, { error: { code: 'rate_limited', message: `You have reached the hourly limit of ${RATE} audits. Try again in about ${retry} minute${retry === 1 ? '' : 's'}.` } });
        }
        if (queue.length >= MAX_QUEUE) return send(req, res, 503, { error: { code: 'busy', message: 'The audit service is busy. Please try again in a few minutes.' } });
        arr.push(t); hits.set(ip, arr);

        const id = crypto.randomBytes(12).toString('hex');
        const job = { id, key, url: target.href, status: 'queued', percent: 0, steps: [], createdAt: t };
        jobs.set(id, job); recent.set(key, { id, at: t }); queue.push(job);
        pump();
        return send(req, res, 202, { id });
      }

      const m = /^\/api\/audit\/([a-f0-9]{24})$/.exec(url.pathname);
      if (m && req.method === 'GET') {
        const job = jobs.get(m[1]);
        if (!job) return send(req, res, 404, { error: { code: 'not_found', message: 'That audit has expired or does not exist.' } });
        const position = job.status === 'queued' ? queue.indexOf(job) + 1 : 0;
        return send(req, res, 200, {
          id: job.id, status: job.status, percent: job.percent, position,
          steps: job.steps.map((s) => ({ key: s.key, label: s.label })),
          ...(job.status === 'done' ? { result: job.result } : {}), ...(job.status === 'error' ? { error: job.error } : {}),
        });
      }
      return send(req, res, 404, { error: { code: 'not_found', message: 'Not found.' } });
    } catch (e) {
      console.error('request error', e);
      if (!res.headersSent) send(req, res, 500, { error: { code: 'server_error', message: 'Something went wrong.' } });
    }
  });
  server.on('close', () => clearInterval(sweeper));
  server.state = { jobs, queue, hits };
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { runAudit, closeBrowser } = await import('./audit.js');
  const port = num(process.env.PORT, 8787);
  const server = createServer({ auditFn: runAudit });
  server.listen(port, () => console.log(`Qualaces audit service listening on :${port}`));
  const stop = async () => { server.close(); await closeBrowser(); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
