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

// Descarga por una ruta same-origin protegida con Bearer. El navegador no adjunta
// el token de sesión a la navegación de un enlace, así que la petición tiene que
// salir de aquí. El backend responde 302 hacia una URL firmada de vigencia corta:
// fetch sigue ese redirect y, por ser de otro origen, la cabecera Authorization no
// viaja con él.
export async function apiDownload(url: string): Promise<Blob> {
  const res = await fetch(url, {
    headers: currentAccessToken ? { Authorization: `Bearer ${currentAccessToken}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Error ${res.status}`);
  }
  return res.blob();
}

export async function exitTenderOpportunity(opportunityId: string, destination: 'radar' | 'seguimiento', reason = '') {
  return api('/api/tender-opportunity-exit', {
    method: 'POST',
    body: JSON.stringify({ opportunity_id: opportunityId, destination, reason }),
  });
}
