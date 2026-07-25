function isPrivateHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local') || normalized === '::1') return true;
  const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  const octets = ipv4.slice(1).map(Number);
  if (octets.some(value => value > 255)) return true;
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || first >= 224 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
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
