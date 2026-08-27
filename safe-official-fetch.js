import { lookup as dnsLookup } from 'node:dns/promises';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

const blockedV4 = new BlockList();
const blockedV6 = new BlockList();
for (const [network, prefix, type] of [
  ['0.0.0.0', 8, 'ipv4'], ['10.0.0.0', 8, 'ipv4'], ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'], ['169.254.0.0', 16, 'ipv4'], ['172.16.0.0', 12, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'], ['192.0.2.0', 24, 'ipv4'], ['192.168.0.0', 16, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'], ['198.51.100.0', 24, 'ipv4'], ['203.0.113.0', 24, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'], ['240.0.0.0', 4, 'ipv4'],
  ['::', 128, 'ipv6'], ['::1', 128, 'ipv6'], ['::ffff:0:0', 96, 'ipv6'],
  ['fc00::', 7, 'ipv6'], ['fe80::', 10, 'ipv6'], ['2001:db8::', 32, 'ipv6'], ['ff00::', 8, 'ipv6'],
]) (type === 'ipv4' ? blockedV4 : blockedV6).addSubnet(network, prefix, type);

function bareHostname(value) {
  const host = String(value || '').toLowerCase();
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function allowedHostname(hostname, allowedHosts) {
  const host = bareHostname(hostname);
  return (allowedHosts || []).some(pattern => {
    const normalized = String(pattern || '').toLowerCase();
    return normalized.startsWith('*.')
      ? host.endsWith(normalized.slice(1)) && host !== normalized.slice(2)
      : host === normalized;
  });
}

export function isPublicNetworkAddress(address) {
  const normalized = bareHostname(address);
  const family = isIP(normalized);
  return family !== 0 && !(family === 4 ? blockedV4.check(normalized, 'ipv4') : blockedV6.check(normalized, 'ipv6'));
}

export function validateOfficialHttpsUrl(value, { allowedHosts, allowedPath } = {}) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw new Error('URL oficial inválida.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('La URL oficial debe usar HTTPS sin credenciales ni puerto explícito.');
  if (!allowedHostname(url.hostname, allowedHosts)) throw new Error(`Host oficial no permitido: ${url.hostname}`);
  if (allowedPath && !allowedPath.test(url.pathname)) throw new Error(`Ruta oficial no permitida: ${url.pathname}`);
  return url;
}

export async function resolveOfficialTarget(url, policy, lookup = dnsLookup) {
  const parsed = validateOfficialHttpsUrl(url, policy);
  const literal = bareHostname(parsed.hostname);
  const addresses = isIP(literal)
    ? [{ address: literal, family: isIP(literal) }]
    : await lookup(literal, { all: true, verbatim: true });
  if (!addresses?.length || addresses.some(entry => !isPublicNetworkAddress(entry.address))) {
    throw new Error(`El host oficial no resolvió exclusivamente a direcciones públicas: ${literal}`);
  }
  return { url: parsed, address: addresses[0].address, family: Number(addresses[0].family) };
}

export function responseRemoteAddress(response, target) {
  return response?.socket?.remoteAddress || target?.address || null;
}

function pinnedHttpsRequest(target, { method = 'GET', body = null, headers = {}, maxBytes = 50 * 1024 * 1024, timeoutMs = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    const outboundBody = body !== null && body !== undefined
      ? (Buffer.isBuffer(body) ? body : Buffer.from(String(body)))
      : body;
    if (outboundBody !== null && outboundBody !== undefined
      && !Object.keys(headers).some(key => key.toLowerCase() === 'content-length' || key.toLowerCase() === 'transfer-encoding')) {
      headers = { ...headers, 'Content-Length': String(outboundBody.byteLength) };
    }
    const request = https.request(target.url, {
      method, headers, servername: bareHostname(target.url.hostname),
      lookup: (_hostname, lookupOptions, callback) => lookupOptions?.all
        ? callback(null, [{ address: target.address, family: target.family }])
        : callback(null, target.address, target.family),
    }, response => {
      // IncomingMessage.socket may be nulled by Node after the stream ends.
      // Capture the peer while headers arrive; target.address is the already
      // DNS-validated and pinned public fallback.
      const remoteAddress = responseRemoteAddress(response, target);
      const chunks = [];
      let total = 0;
      response.on('data', chunk => {
        total += chunk.length;
        if (total > maxBytes) {
          request.destroy(new Error(`La respuesta oficial supera ${maxBytes} bytes.`));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ status: response.statusCode || 0, headers: response.headers, body: Buffer.concat(chunks), remoteAddress }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('Tiempo de espera agotado al consultar la fuente oficial.')));
    request.on('socket', socket => {
      const validateRemoteAddress = () => {
        if (!isPublicNetworkAddress(socket.remoteAddress)) request.destroy(new Error('La conexión oficial terminó en una dirección no pública.'));
      };
      if (socket.connecting === false) validateRemoteAddress();
      else socket.once('secureConnect', validateRemoteAddress);
    });
    request.on('error', reject);
    if (outboundBody !== null && outboundBody !== undefined) request.write(outboundBody);
    request.end();
  });
}

export async function safeOfficialFetch(value, policy, options = {}) {
  const maxRedirects = options.maxRedirects ?? 3;
  const request = options.request || pinnedHttpsRequest;
  const lookup = options.lookup || dnsLookup;
  let current = validateOfficialHttpsUrl(value, policy);
  let requestOptions = { ...options };
  for (let redirect = 0; ; redirect += 1) {
    const target = await resolveOfficialTarget(current, policy, lookup);
    const response = await request(target, requestOptions);
    if (!isPublicNetworkAddress(response.remoteAddress || target.address)) throw new Error('La fuente oficial respondió desde una dirección no pública.');
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers?.location) {
      if (redirect >= maxRedirects) throw new Error('La fuente oficial excedió el límite de redirects.');
      current = validateOfficialHttpsUrl(new URL(response.headers.location, current).toString(), policy);
      if ([301, 302, 303].includes(response.status) && String(requestOptions.method || 'GET').toUpperCase() !== 'GET') {
        requestOptions = { ...requestOptions, method: 'GET', body: null };
      }
      continue;
    }
    const body = Buffer.from(response.body || []);
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      url: current.toString(),
      headers: response.headers || {},
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      text: async () => body.toString('utf8'),
      json: async () => JSON.parse(body.toString('utf8')),
    };
  }
}
