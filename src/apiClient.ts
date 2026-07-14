let currentAccessToken: string | null = null;

export function setApiAccessToken(token: string | null) {
  currentAccessToken = token;
}

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    ...(currentAccessToken ? { Authorization: `Bearer ${currentAccessToken}` } : {}),
    ...(options?.headers || {}),
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Error ${res.status}`);
  }
  return res.json() as Promise<T>;
}
