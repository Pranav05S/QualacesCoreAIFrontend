// Target validation and SSRF protection.
//
// The audit service fetches URLs chosen by strangers, so every outbound request (the main page,
// every browser sub-request, every redirect hop, every link check) goes through this module.
// Rules: http/https only, standard ports only, no credentials in the URL, and the hostname must
// resolve ONLY to public addresses. Private, loopback, link-local, CGNAT, multicast, reserved and
// cloud-metadata ranges are refused.
//
// Residual risk: a DNS-rebinding attacker could change DNS between our check and the browser's own
// lookup. safeRequest() pins the validated address for its own connections. Browser sub-requests
// are re-validated per request, which narrows but does not close that window, so in production also
// restrict egress at the network level (see README).

import dns from 'node:dns/promises';
import net from 'node:net';

// Test-only escape hatch: with ALLOW_LOOPBACK_TARGETS=1 the hostnames localhost / *.localhost and the
// loopback addresses 127.0.0.0/8 and ::1 may be audited, on any port. It can never allow private,
// link-local, CGNAT, multicast or cloud-metadata addresses, whatever else is set.
export const loopbackEnabled = () => process.env.ALLOW_LOOPBACK_TARGETS === '1';
export function isLoopbackIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) return ip.startsWith('127.');
  if (v === 6) { const g = expandV6(ip); return (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) || (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff && (g[6] >> 8) === 127); }
  return false;
}
const loopbackHost = (host) => loopbackEnabled() && (host === 'localhost' || host.endsWith('.localhost') || (net.isIP(host) !== 0 && isLoopbackIp(host)));

export class TargetError extends Error {
  constructor(message, code = 'blocked_target') {
    super(message);
    this.code = code;
  }
}

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa', '.lan', '.intranet', '.corp'];

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, p) => (acc << 8n) + BigInt(Number(p)), 0n);
}

const V4_BLOCKS = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => ({ base: ipv4ToInt(base), mask: ((1n << 32n) - 1n) ^ ((1n << BigInt(32 - bits)) - 1n) }));

function isPrivateV4(ip) {
  const n = ipv4ToInt(ip);
  return V4_BLOCKS.some(({ base, mask }) => (n & mask) === base);
}

// Expand an IPv6 address to 8 hextets (handles :: and a trailing dotted IPv4).
function expandV6(ip) {
  let addr = ip.split('%')[0].toLowerCase();
  const tail = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const o = tail[1].split('.').map(Number);
    addr = addr.slice(0, -tail[1].length) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }
  const [head, rest] = addr.split('::');
  const h = head ? head.split(':') : [];
  const r = rest !== undefined ? (rest ? rest.split(':') : []) : null;
  const parts = r === null ? h : [...h, ...Array(8 - h.length - r.length).fill('0'), ...r];
  return parts.map((p) => parseInt(p || '0', 16));
}

function isPrivateV6(ip) {
  const g = expandV6(ip);
  if (g.length !== 8 || g.some((x) => Number.isNaN(x))) return true; // unparseable: refuse
  const embedV4 = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPrivateV4(embedV4(g[6], g[7])); // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return isPrivateV4(embedV4(g[6], g[7])); // ::a.b.c.d (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateV4(embedV4(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isPrivateV4(embedV4(g[1], g[2])); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true; // discard-only
  return false;
}

export function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) return isPrivateV6(ip);
  return true;
}

/** Parse and statically validate a user-supplied target. Returns a URL. Does no network I/O. */
export function parseTarget(input) {
  if (typeof input !== 'string') throw new TargetError('Enter a web address.', 'invalid_url');
  let raw = input.trim();
  if (!raw || raw.length > 2048) throw new TargetError('Enter a web address.', 'invalid_url');
  if (/[\u0000-\u001f\u007f\s]/.test(raw)) throw new TargetError('That address contains invalid characters.', 'invalid_url');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^/]*:\d+(\/|$)/.test(raw)) throw new TargetError('Only http and https addresses can be audited.', 'invalid_scheme');
    raw = 'https://' + raw;
  }
  let url;
  try { url = new URL(raw); } catch { throw new TargetError('That does not look like a valid web address.', 'invalid_url'); }
  return validateUrl(url);
}

/** Validate an already-parsed URL (used for redirects and browser sub-requests too). */
export function validateUrl(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TargetError('Only http and https addresses can be audited.', 'invalid_scheme');
  if (url.username || url.password) throw new TargetError('Addresses with embedded credentials are not allowed.', 'blocked_target');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!host) throw new TargetError('That does not look like a valid web address.', 'invalid_url');
  if (loopbackHost(host)) return url; // test mode: loopback only
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  if (port !== '80' && port !== '443') throw new TargetError('Only the standard web ports (80 and 443) can be audited.', 'blocked_target');
  if (host === 'localhost' || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) throw new TargetError('That address is not publicly reachable.', 'blocked_target');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new TargetError('That address is not publicly reachable.', 'blocked_target');
  } else if (!host.includes('.')) {
    throw new TargetError('Enter a full domain name, such as example.com.', 'invalid_url');
  }
  return url;
}

/** Resolve a hostname and require every returned address to be public. Returns the addresses. */
export async function resolvePublic(hostname, lookup = dns.lookup) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host) && !loopbackHost(host)) throw new TargetError('That address is not publicly reachable.');
    return [{ address: host, family: net.isIP(host) }];
  }
  let addrs;
  try { addrs = await lookup(host, { all: true, verbatim: true }); }
  catch (e) {
    // ENOTFOUND/ENODATA mean the name really does not exist. Anything else (timeouts, SERVFAIL) is temporary.
    if (e && (e.code === 'ENOTFOUND' || e.code === 'ENODATA')) throw new TargetError('We could not find that site. Check the spelling of the address.', 'dns_failed');
    throw new TargetError('We could not look up that site right now. Please try again.', 'dns_temporary');
  }
  if (!addrs.length) throw new TargetError('We could not find that site.', 'dns_failed');
  const lb = loopbackHost(host.toLowerCase());
  if (addrs.some((a) => isPrivateIp(a.address) && !(lb && isLoopbackIp(a.address)))) throw new TargetError('That address is not publicly reachable.');
  return addrs;
}

/** Full check used for browser sub-requests: static rules plus DNS. Results are cached per host. */
export function makeRequestGuard(lookup = dns.lookup) {
  const cache = new Map();
  return async function guard(urlString) {
    let url;
    try { url = new URL(urlString); } catch { return false; }
    if (url.protocol === 'data:' || url.protocol === 'blob:' || url.protocol === 'about:') return true;
    try {
      validateUrl(url);
      const host = url.hostname;
      if (!cache.has(host)) cache.set(host, resolvePublic(host, lookup).then(() => true, () => false));
      return await cache.get(host);
    } catch { return false; }
  };
}
