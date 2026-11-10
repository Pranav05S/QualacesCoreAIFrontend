// Guarded HTTP client used for headers, redirects, robots/sitemap and link checks.
// Every hop is validated by security.js and the connection is pinned to the validated address.

import http from 'node:http';
import https from 'node:https';
import { validateUrl, resolvePublic, TargetError } from './security.js';

export const USER_AGENT = 'QualacesAuditBot/1.0 (+https://qualaces.com/audit.html; passive single-page audit requested by the site owner)';
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function once(url, addrs, { method, timeoutMs, maxBytes, headers }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    // With NODE_USE_ENV_PROXY (sandbox only) the global agent tunnels via the proxy, so pinning is moot.
    // Only addresses that passed validation can ever be connected to. Node may ask for one address or for all of them.
    const pinned = process.env.NODE_USE_ENV_PROXY === '1' ? {} : {
      lookup: (_host, opts, cb) => (opts && opts.all ? cb(null, addrs.map((a) => ({ address: a.address, family: a.family }))) : cb(null, addrs[0].address, addrs[0].family)),
    };
    const req = lib.request({
      protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: url.pathname + url.search,
      method, timeout: timeoutMs, servername: url.hostname,
      headers: { 'user-agent': USER_AGENT, accept: '*/*', 'accept-encoding': 'identity', ...headers },
      ...pinned,
    }, (res) => {
      const chunks = [];
      let size = 0;
      const tls = res.socket && res.socket.getProtocol ? { protocol: res.socket.getProtocol() } : null;
      const finish = () => resolve({ status: res.statusCode, headers: res.headers, rawHeaders: res.rawHeaders, body: Buffer.concat(chunks).toString('utf8'), tls });
      if (method === 'HEAD' || maxBytes === 0) { res.resume(); res.on('end', finish); res.on('error', reject); return; }
      res.on('data', (c) => {
        size += c.length;
        if (size <= maxBytes) chunks.push(c);
        else { res.destroy(); finish(); }
      });
      res.on('end', finish);
      res.on('error', (e) => (size > maxBytes ? finish() : reject(e)));
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}

/**
 * Follow redirects manually, re-validating each hop.
 * Never throws for network problems: returns { error: { code, message } } instead.
 * Throws TargetError only if the very first URL is not allowed.
 */
export async function safeRequest(input, { method = 'GET', timeoutMs = 8000, maxBytes = 0, maxRedirects = 5, headers = {} } = {}) {
  let url = input instanceof URL ? input : new URL(input);
  validateUrl(url);
  const chain = [];
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let addrs;
    try {
      validateUrl(url);
      addrs = await resolvePublic(url.hostname);
    } catch (e) {
      if (hop === 0 && e instanceof TargetError && e.code !== 'dns_failed') throw e;
      return { url: url.href, chain, error: { code: e.code || 'blocked_target', message: e.message } };
    }
    let res;
    try {
      res = await once(url, addrs, { method, timeoutMs, maxBytes, headers });
    } catch (e) {
      return { url: url.href, chain, error: { code: e.code || 'request_failed', message: e.message } };
    }
    chain.push({ url: url.href, status: res.status });
    if (REDIRECTS.has(res.status) && res.headers.location) {
      try { url = new URL(res.headers.location, url); } catch { return { url: url.href, chain, ...res, error: { code: 'bad_redirect', message: 'Invalid redirect target' } }; }
      continue;
    }
    const setCookie = [];
    for (let i = 0; i < res.rawHeaders.length; i += 2) if (res.rawHeaders[i].toLowerCase() === 'set-cookie') setCookie.push(res.rawHeaders[i + 1]);
    return { url: url.href, chain, status: res.status, headers: res.headers, setCookie, body: res.body, tls: res.tls };
  }
  return { url: url.href, chain, error: { code: 'too_many_redirects', message: 'Too many redirects' } };
}
