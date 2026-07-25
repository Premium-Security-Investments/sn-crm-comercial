function isPrivateIpv4(hostname: string) {
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some(value => value > 255)) return true;
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || first >= 224 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

function isPrivateHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) return true;
  if (isPrivateIpv4(normalized)) return true;
  if (!normalized.includes(':')) return false;
  if (normalized === '::' || normalized === '::1') return true;
  const firstHextetText = normalized.split(':').find(Boolean) || '0';
  const firstHextet = Number.parseInt(firstHextetText, 16);
  if ((firstHextet >= 0xfc00 && firstHextet <= 0xfdff) || firstHextet >= 0xfe80) return true;
  const mappedHex = normalized.match(/(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return isPrivateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  const mappedDotted = normalized.match(/(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  return mappedDotted ? isPrivateIpv4(mappedDotted[1]) : false;
}

export function safePublicTenderSourceUrl(value: unknown): string | null {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || isPrivateHostname(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function beginTenderRefresh(current: ReadonlySet<string>, opportunityId: string) {
  const next = new Set(current);
  next.add(opportunityId);
  return next;
}

export function finishTenderRefresh(current: ReadonlySet<string>, opportunityId: string) {
  const next = new Set(current);
  next.delete(opportunityId);
  return next;
}
