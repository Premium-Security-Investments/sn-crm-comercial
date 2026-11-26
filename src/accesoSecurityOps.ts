// Inicio de sesión común (ensayo, 26-nov-2026): entrar al SIIO con la cuenta del directorio de SecurityOps.
// Usa la API REST de Firebase Auth (sin SDK): correo y clave → token de identidad, que el servidor del SIIO verifica.
// La sesión vive solo en esta pestaña (sessionStorage) y el token se renueva antes de vencer (dura 1 hora).

export type SesionSecurityOps = { idToken: string; refreshToken: string; email: string; venceEn: number };
// modo «ensayo»: enlace aparte en la pantalla; «directorio»: cambio definitivo, la entrada normal usa el directorio.
type Config = { enabled: true; projectId: string; apiKey: string; modo?: 'ensayo' | 'directorio' } | { enabled: false };

const CLAVE = 'siio.sesion.securityops';
const MARGEN_MS = 5 * 60 * 1000;
let config: Config | null = null;
let temporizador: ReturnType<typeof setTimeout> | null = null;
const oyentes = new Set<(sesion: SesionSecurityOps | null) => void>();

export async function configSecurityOps(): Promise<Config> {
  if (config) return config;
  try {
    const res = await fetch('/api/acceso/securityops', { cache: 'no-store' });
    config = res.ok ? await res.json() as Config : { enabled: false };
  } catch {
    config = { enabled: false };
  }
  return config;
}

function guardar(sesion: SesionSecurityOps | null) {
  try {
    if (sesion) sessionStorage.setItem(CLAVE, JSON.stringify(sesion));
    else sessionStorage.removeItem(CLAVE);
  } catch { /* sin almacenamiento: la sesión dura lo que la página */ }
  if (temporizador) clearTimeout(temporizador);
  temporizador = null;
  if (sesion) {
    const espera = Math.max(10_000, sesion.venceEn - Date.now() - MARGEN_MS);
    temporizador = setTimeout(() => { void renovar(sesion); }, espera);
  }
  oyentes.forEach(oyente => oyente(sesion));
}

export function sesionGuardada(): SesionSecurityOps | null {
  try {
    const raw = sessionStorage.getItem(CLAVE);
    if (!raw) return null;
    const sesion = JSON.parse(raw) as SesionSecurityOps;
    return sesion?.idToken && sesion.refreshToken ? sesion : null;
  } catch {
    return null;
  }
}

export function alCambiarSesion(oyente: (sesion: SesionSecurityOps | null) => void) {
  oyentes.add(oyente);
  return () => { oyentes.delete(oyente); };
}

const MENSAJES: Record<string, string> = {
  INVALID_LOGIN_CREDENTIALS: 'Correo o clave incorrectos.',
  INVALID_PASSWORD: 'Correo o clave incorrectos.',
  EMAIL_NOT_FOUND: 'Correo o clave incorrectos.',
  USER_DISABLED: 'Esta cuenta está desactivada.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Demasiados intentos. Espera unos minutos.',
};

export async function entrarConSecurityOps(email: string, clave: string): Promise<SesionSecurityOps> {
  const cfg = await configSecurityOps();
  if (!cfg.enabled) throw new Error('La entrada con SecurityOps no está disponible aquí.');
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(cfg.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: clave, returnSecureToken: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.idToken) {
    const codigo = String(body?.error?.message || '').split(' ')[0];
    throw new Error(MENSAJES[codigo] || 'No fue posible entrar con la cuenta de SecurityOps.');
  }
  const sesion = { idToken: body.idToken, refreshToken: body.refreshToken, email: String(body.email || email).toLowerCase(), venceEn: Date.now() + Number(body.expiresIn || 3600) * 1000 };
  guardar(sesion);
  return sesion;
}

async function renovar(anterior: SesionSecurityOps) {
  const cfg = await configSecurityOps();
  if (!cfg.enabled) { guardar(null); return; }
  try {
    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: anterior.refreshToken }).toString(),
    });
    const body = await res.json();
    if (!res.ok || !body.id_token) throw new Error('renovacion');
    guardar({ idToken: body.id_token, refreshToken: body.refresh_token, email: anterior.email, venceEn: Date.now() + Number(body.expires_in || 3600) * 1000 });
  } catch {
    guardar(null);
  }
}

/** Al recargar la página: si había sesión, la retoma (renovándola si ya está por vencer). */
export async function retomarSesion(): Promise<SesionSecurityOps | null> {
  const sesion = sesionGuardada();
  if (!sesion) return null;
  if (sesion.venceEn - Date.now() <= MARGEN_MS) {
    await renovar(sesion);
    return sesionGuardada();
  }
  guardar(sesion);
  return sesion;
}

/** «¿Olvidaste tu contraseña?» contra el directorio: Google manda el correo (en español) para poner una clave nueva. */
export async function enviarCorreoDeClave(email: string): Promise<void> {
  const cfg = await configSecurityOps();
  if (!cfg.enabled) throw new Error('La recuperación de clave no está disponible aquí.');
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(cfg.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Firebase-Locale': 'es' },
    body: JSON.stringify({ requestType: 'PASSWORD_RESET', email, continueUrl: window.location.origin }),
  });
  // Por seguridad no se distingue si el correo existe: la respuesta es la misma.
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const codigo = String(body?.error?.message || '').split(' ')[0];
    if (codigo === 'TOO_MANY_ATTEMPTS_TRY_LATER') throw new Error(MENSAJES[codigo]);
    if (codigo !== 'EMAIL_NOT_FOUND') throw new Error('No fue posible enviar el correo. Intenta de nuevo.');
  }
}

export function salirDeSecurityOps() {
  guardar(null);
}
