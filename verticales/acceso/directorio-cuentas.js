// Directorio común de cuentas (Firebase Auth del proyecto de SecurityOps), visto desde el servidor del SIIO.
// Decisión de Juan (25/26-nov-2026): una cuenta por persona en ese directorio; el SIIO crea o reconoce la cuenta al dar de
// alta a alguien y nunca la borra ni la desactiva (desactivar en el SIIO quita solo el SIIO).
//
// Se habla con la API de administración de Identity Toolkit usando la cuenta de servicio de Cloud Run (servidor de
// metadatos de Google): sin llaves en el código ni en archivos. Fuera de Google (Vercel) no hay token → el directorio
// responde «no disponible» y quien llama decide.

const IDENTITY = 'https://identitytoolkit.googleapis.com/v1';
const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** El cambio definitivo: con esta variable en `on` la entrada normal del SIIO usa el directorio común. */
export function loginDirectorioActivo(environment = process.env) {
  return String(environment?.SIIO_LOGIN_DIRECTORIO || '').trim().toLowerCase() === 'on';
}

function directorioError(code, message, status = 502) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function createMetadataTokenSource({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  let cached = null;
  let expiresAt = 0;
  return async function getToken() {
    if (cached && now() < expiresAt) return cached;
    let response;
    try {
      response = await fetchImpl(METADATA_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } });
    } catch {
      throw directorioError('directorio_sin_credencial', 'El directorio común no está disponible desde este servidor.', 503);
    }
    if (!response.ok) throw directorioError('directorio_sin_credencial', 'El directorio común no está disponible desde este servidor.', 503);
    const body = await response.json();
    cached = body.access_token;
    expiresAt = now() + Math.max(0, Number(body.expires_in || 0) - 60) * 1000;
    return cached;
  };
}

export function createDirectorioCuentas({ projectId, getToken = createMetadataTokenSource(), fetchImpl = fetch } = {}) {
  if (!projectId) throw directorioError('directorio_sin_proyecto', 'Falta el proyecto del directorio común.', 503);

  async function llamar(path, payload, { extraHeaders = {} } = {}) {
    const token = await getToken();
    const response = await fetchImpl(`${IDENTITY}/projects/${projectId}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = String(body?.error?.message || `http_${response.status}`).split(' ')[0];
      throw directorioError(`directorio_${reason.toLowerCase()}`, `El directorio común respondió ${reason}.`);
    }
    return body;
  }

  function normalizar(email) {
    const value = String(email || '').trim().toLowerCase();
    if (!EMAIL_PATTERN.test(value)) throw directorioError('directorio_correo_invalido', 'Correo inválido.', 400);
    return value;
  }

  async function buscar(email) {
    const body = await llamar('accounts:lookup', { email: [normalizar(email)] });
    const user = Array.isArray(body.users) ? body.users[0] : null;
    return user ? { uid: user.localId, email: user.email, disabled: Boolean(user.disabled), conClave: Boolean(user.passwordHash) || (user.providerUserInfo || []).some(p => p.providerId === 'password') } : null;
  }

  /** Crea la cuenta si no existe; si existe la reconoce tal cual (nunca cambia su clave ni su estado). */
  async function asegurar({ email, nombre, clave }) {
    const correo = normalizar(email);
    const existente = await buscar(correo);
    if (existente) return { ...existente, creada: false };
    const payload = { email: correo, emailVerified: false };
    if (nombre) payload.displayName = String(nombre).slice(0, 120);
    if (clave) payload.password = String(clave);
    const body = await llamar('accounts', payload);
    return { uid: body.localId, email: correo, disabled: false, conClave: Boolean(clave), creada: true };
  }

  /** Correo de Google (en español) para poner o cambiar la clave; vuelve al SIIO al terminar. */
  async function enviarCorreoDeClave(email, continueUrl) {
    const payload = { requestType: 'PASSWORD_RESET', email: normalizar(email) };
    if (continueUrl) payload.continueUrl = continueUrl;
    await llamar('accounts:sendOobCode', payload, { extraHeaders: { 'X-Firebase-Locale': 'es' } });
    return true;
  }

  /** El mismo enlace, para compartirlo a mano cuando el correo no sale. */
  async function enlaceDeClave(email, continueUrl) {
    const payload = { requestType: 'PASSWORD_RESET', email: normalizar(email), returnOobLink: true };
    if (continueUrl) payload.continueUrl = continueUrl;
    const body = await llamar('accounts:sendOobCode', payload, { extraHeaders: { 'X-Firebase-Locale': 'es' } });
    return body.oobLink || null;
  }

  return { buscar, asegurar, enviarCorreoDeClave, enlaceDeClave };
}
