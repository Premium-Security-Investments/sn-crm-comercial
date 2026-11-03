// AGT-002 — la vigilancia de las sesiones de los puentes (cuarto caso de la mejora 2, encargo del 2026-10-31).
//
// La sesión de Claude del puente de AGT-002 vencía la noche del 31-oct, en plena semana de dos cierres, y se
// descubrió de casualidad. Cuando el plazo se cumple, el CLI intenta renovar, no puede y deja las credenciales en
// blanco SIN aviso: toda función de IA de ese agente falla en menos de un segundo y nadie sabe por qué.
//
// Por qué la fecha no vive en una tabla ni en el código: cambia con cada login, y una fecha copiada se pudre. La
// fuente es el propio archivo de sesión de cada puente, así que se lee de ahí cada vez.
//
// Lo que esto lee del archivo, y nada más: `refreshTokenExpiresAt` y si `accessToken` está vacío. El token nunca
// sale de `readBridgeSession`: ni a un log, ni a un evento, ni a una línea. Leer esos archivos exige root (son 600
// de cada usuario de puente), por eso corre como paso del trabajo diario que ya es root (el puente SharePoint) y
// con autorización de Juan del 2026-11-03.

const DAY_MS = 24 * 60 * 60 * 1000;
export const AGT002_BRIDGE_SESSION_WARNING_DAYS = 7;

/** Lee una sesión y devuelve SÓLO su vencimiento y si quedó en blanco. Nunca el token. */
export async function readBridgeSession(path, readFile) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    const oauth = parsed?.claudeAiOauth || {};
    const expiresAt = Number(oauth.refreshTokenExpiresAt);
    return {
      expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null,
      blank: typeof oauth.accessToken !== 'string' || oauth.accessToken.length === 0,
      unreadable: false,
    };
  } catch {
    return { expiresAt: null, blank: false, unreadable: true };
  }
}

const utc = time => `${new Date(time).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/**
 * La línea para el expediente, o null si nada está por vencer. Nombra la FECHA y no los días que faltan: así la línea
 * no cambia de un día a otro y la escritura (que no duplica una línea igual) no la repite cada mañana.
 */
export function agt002BridgeSessionNoticeLine(sessions = [], { now = new Date(), warningDays = AGT002_BRIDGE_SESSION_WARNING_DAYS } = {}) {
  const time = new Date(now).getTime();
  const parts = [];
  for (const session of sessions) {
    if (session.unreadable) parts.push(`${session.agent}: no se pudo leer su sesión, así que esta revisión no la puede vigilar`);
    else if (session.blank) parts.push(`${session.agent}: la sesión ya venció (credenciales en blanco); sus funciones de IA fallan`);
    else if (session.expiresAt === null) parts.push(`${session.agent}: su sesión no declara vencimiento, así que no se puede vigilar`);
    else if (session.expiresAt - time <= warningDays * DAY_MS) {
      parts.push(session.expiresAt <= time
        ? `${session.agent}: la sesión venció el ${utc(session.expiresAt)}`
        : `${session.agent}: la sesión vence el ${utc(session.expiresAt)}`);
    }
  }
  if (!parts.length) return null;
  return `Vig-IA, sesiones de los puentes: ${parts.join('; ')}. Al vencer, el puente deja de responder sin avisar. Se renueva con \`claude auth login\` en el servidor (lo hace Juan, con navegador) y después se reinicia el puente.`;
}

/** Lee las sesiones, arma la línea y la deja en cada expediente activo. Devuelve eventos sin datos de la sesión. */
export async function runAgt002BridgeSessionWatch(database, {
  sessions = [], readFile, now = new Date(), log = () => {}, inactiveReason, appendLine, limit = 50,
} = {}) {
  const events = [];
  const read = [];
  for (const { agent, path } of sessions) {
    const state = await readBridgeSession(path, readFile);
    read.push({ agent, ...state });
    events.push({ event: 'agt002_bridge_session_read', agent, expires_at: state.expiresAt ? new Date(state.expiresAt).toISOString() : null, blank: state.blank, unreadable: state.unreadable });
  }
  const line = agt002BridgeSessionNoticeLine(read, { now });
  if (!line) {
    events.push({ event: 'agt002_bridge_session_sin_avisos' });
    for (const event of events) log(event);
    return events;
  }
  const { data: tenders, error } = await database
    .from('psi_public_tenders')
    .select('id,ref,converted_opportunity_id,internal_status')
    .eq('internal_status', 'convertida_oportunidad')
    .limit(limit);
  if (error) {
    events.push({ event: 'agt002_bridge_session_watch_unavailable', message: String(error.message || error).slice(0, 200) });
    for (const event of events) log(event);
    return events;
  }
  for (const tender of tenders || []) {
    const opportunityId = tender?.converted_opportunity_id;
    if (!opportunityId) continue;
    try {
      if (inactiveReason && await inactiveReason(database, opportunityId, tender.id)) continue;
      if (appendLine) await appendLine(database, opportunityId, line);
      events.push({ event: 'agt002_bridge_session_notice', opportunityId, ref: tender.ref || null });
    } catch (cause) {
      events.push({ event: 'agt002_bridge_session_watch_failed', opportunityId, message: String(cause?.message || cause).slice(0, 200) });
    }
  }
  for (const event of events) log(event);
  return events;
}
