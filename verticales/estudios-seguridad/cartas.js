// Estudios de Seguridad Física: carta de recomendación al cliente (migración 213; Juan, 2026-11-12: "Si").
//
// Héctor Martínez (reunión del 2026-11-11): cuando el cliente no aplica lo recomendado, Seguridad Nacional le recuerda
// por escrito, con la evidencia, "y eso nos blinda": si el riesgo se materializa, la empresa muestra que lo advirtió.
//
// 1. Quien prepara, revisa o aprueba pide la carta: las recomendaciones A CARGO DEL CLIENTE que siguen pendientes en la
//    última versión aprobada, y lo que registró SecurityOps en el puesto después de aprobar.
// 2. El servidor de tareas (con el archivo del estudio) la arma sobre el membrete, la convierte en PDF y la sube a
//    SharePoint en la carpeta del estudio, sin sobrescribir.
// 3. Nadie la envía por el SIIO: una persona la manda y registra el envío.
import { canDeliver } from './entrega.js';
import { ARCHIVE_BASE_PATH, sharepointSafeName } from './informe.js';
import { loadSecurityOps } from './securityops.js';

const LETTERS = 'psi_security_study_letters';
const MEDIUMS = new Set(['correo', 'fisico', 'reunion']);
const missingTable = error => error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message || ''));
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const bogotaDay = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(value));
const day = value => (value ? (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)) : null);
const clean = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

async function approvedVersion(db, study) {
  if (!['aprobado', 'archivado'].includes(study.status)) throw fail('Sólo se escribe una carta de un estudio aprobado.', 409);
  const { data, error } = await db.from('psi_security_study_versions').select('version, approved_at, snapshot').eq('study_id', study.id).order('version', { ascending: false }).limit(1);
  if (error) throw error;
  if (!data?.[0]) throw fail('El estudio no tiene una versión aprobada.', 409);
  return data[0];
}

/** Las recomendaciones a cargo del cliente de la última versión aprobada, con su estado de hoy. */
export async function clientRecommendations(db, study, now = new Date()) {
  const version = await approvedVersion(db, study);
  const { data: actions, error } = await db.from('psi_security_study_actions').select('id, status, responsible_party').eq('study_id', study.id);
  if (error) throw error;
  const live = new Map((actions || []).map(action => [action.id, action]));
  const number = new Map((version.snapshot.riesgos || []).map(risk => [risk.id, risk]));
  const today = bogotaDay(now);
  const items = (version.snapshot.acciones || [])
    .filter(action => (live.get(action.id)?.responsible_party || action.a_cargo) === 'cliente')
    .map(action => {
      const risk = number.get(action.riesgo);
      const status = live.get(action.id)?.status || action.estado;
      const due = day(action.fecha_compromiso);
      return { id: action.id, riesgo: risk ? `R${risk.numero}` : '—', riesgo_nombre: risk?.riesgo || null, nivel: risk?.valoracion?.actual?.nivel || null, accion: action.accion, fecha: due, estado: status, vencida: Boolean(due && due < today) };
    })
    .filter(item => item.estado === 'pendiente' || item.estado === 'en_curso');
  return { version, items };
}

/** Lo que registró SecurityOps en el puesto después de aprobar: novedades graves y alertas de riesgo. */
function evidenceSince(securityops, approvedDay) {
  const data = securityops?.data?.status === 'ok' ? securityops.data : null;
  if (!data) return { fuente: null };
  const graves = (data.summary?.novedades?.altas_fechas || []).filter(value => value > approvedDay);
  const alertas = (data.alerts || []).filter(alert => alert.fecha && alert.fecha > approvedDay).slice(0, 10)
    .map(alert => ({ fecha: alert.fecha, riesgo: alert.riesgo, descripcion: alert.descripcion }));
  return {
    fuente: 'SecurityOps', puesto: securityops.puesto?.name || null, corte: data.synced_at ? day(data.synced_at) : null,
    novedades_graves: graves.length, ultima_grave: graves.sort().at(-1) || null, alertas,
  };
}

export async function requestLetter(db, study, body = {}, profile, now = new Date()) {
  if (!canDeliver(profile, study)) throw fail('Sólo quien preparó, revisa o aprueba estudios pide la carta.', 403);
  const recipient = clean(body.recipient, 300);
  if (recipient.length < 2) throw fail('Escriba a quién va dirigida la carta (nombre y cargo).');
  const { version, items } = await clientRecommendations(db, study, now);
  const chosen = Array.isArray(body.items) && body.items.length ? items.filter(item => body.items.includes(item.id)) : items;
  if (!chosen.length) throw fail('No hay recomendaciones a cargo del cliente pendientes para incluir.', 409);
  const evidence = evidenceSince(await loadSecurityOps(db, study), bogotaDay(version.approved_at));
  const row = {
    study_id: study.id, version: version.version, recipient, items: chosen.slice(0, 60), evidence,
    status: 'pendiente', requested_by: profile.id, requested_at: now.toISOString(),
  };
  const { data, error } = await db.from(LETTERS).insert(row).select('*').single();
  if (error) throw error;
  return data;
}

export async function markLetterSent(db, study, letterId, body = {}, profile, now = new Date()) {
  if (!canDeliver(profile, study)) throw fail('Sólo quien preparó, revisa o aprueba estudios registra el envío.', 403);
  const sentOn = String(body.sent_on || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sentOn) || sentOn > bogotaDay(now)) throw fail('Fecha de envío inválida (no puede ser futura).');
  const sentTo = clean(body.sent_to, 300);
  if (sentTo.length < 2) throw fail('Escriba a quién se envió.');
  if (!MEDIUMS.has(body.sent_medium)) throw fail('Medio: correo, físico o en reunión.');
  const { data, error } = await db.from(LETTERS).update({ status: 'enviada', sent_on: sentOn, sent_to: sentTo, sent_medium: body.sent_medium, sent_by: profile.id, sent_recorded_at: now.toISOString() })
    .eq('id', letterId).eq('study_id', study.id).eq('status', 'lista').select('id');
  if (error) throw error;
  if (!data?.length) throw fail('Esa carta no está lista para enviar (o ya se registró su envío).', 409);
  return { sent: true };
}

export async function loadLetters(db, study, profile, now = new Date()) {
  const { data, error } = await db.from(LETTERS).select('id, version, recipient, items, status, attempts, file_url, error, requested_at, sent_on, sent_to, sent_medium').eq('study_id', study.id).order('requested_at', { ascending: false });
  if (missingTable(error)) return { available: false, letters: [], pending: [], can: false };
  if (error) throw error;
  let pending = [];
  if (['aprobado', 'archivado'].includes(study.status)) {
    try { pending = (await clientRecommendations(db, study, now)).items; } catch { pending = []; }
  }
  return { available: true, can: canDeliver(profile, study) && ['aprobado', 'archivado'].includes(study.status), letters: (data || []).map(item => ({ ...item, items: item.items?.length ?? 0 })), pending };
}

// --- La carta: datos para el generador con membrete (el mismo del informe) ------------------------------------------

const MEDIUM_WORD = { correo: 'correo electrónico', fisico: 'físico', reunion: 'en reunión' };
const STATUS_WORD = { pendiente: 'Pendiente', en_curso: 'En curso' };
const NIVEL = { bajo: 'Bajo', moderado: 'Moderado', alto: 'Alto', critico: 'Crítico', aceptable: 'Aceptable', tolerable: 'Tolerable', inaceptable: 'Inaceptable' };
const longDate = value => (value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeZone: 'America/Bogota' }).format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`)) : '—');

export function buildLetterReport(letter, snapshot, { approvedAt, requesterName, city = null, deliveredOn = null, now = new Date() }) {
  const study = snapshot.estudio;
  const client = study.cliente?.nombre || 'el cliente';
  // "…a cargo de HADA S.A.S. A la fecha…": sin doble punto cuando el nombre ya termina en punto.
  const clientEnd = /\.$/.test(client) ? client : `${client}.`;
  const blocks = [];
  const p = text => blocks.push({ kind: 'paragraph', text });
  // Fecha y destinatario alineados a la izquierda (el estilo de párrafo justifica y estira las líneas cortas).
  blocks.push({ kind: 'signature', text: `${city || study.sede?.ciudad || 'Pereira'}, ${longDate(bogotaDay(now))}` });
  blocks.push({ kind: 'spacer' });
  blocks.push({ kind: 'signature', text: `Señores\n**${client}**\nAtención: ${letter.recipient}\n${[study.sede?.nombre, study.sede?.ciudad].filter(Boolean).join(', ')}` });
  blocks.push({ kind: 'spacer' });
  p(`**Asunto: seguimiento a las recomendaciones del estudio de seguridad ${study.codigo}**`);
  p(`Respetados señores:`);
  p(`En el estudio de seguridad física ${study.codigo}, aprobado el ${longDate(day(approvedAt))}${deliveredOn ? ` y socializado con ustedes el ${longDate(deliveredOn)}` : ''}, Seguridad Nacional Ltda. recomendó las medidas que se relacionan a continuación, a cargo de ${clientEnd} A la fecha de esta comunicación, según nuestros registros, siguen pendientes:`);
  blocks.push({ kind: 'table', header: ['Riesgo', 'Recomendación', 'Fecha compromiso', 'Estado'], rows: letter.items.map(item => [
    `${item.riesgo}${item.riesgo_nombre ? ` · ${item.riesgo_nombre}` : ''}${item.nivel ? ` (${NIVEL[item.nivel] || item.nivel})` : ''}`.slice(0, 300),
    String(item.accion).slice(0, 600), item.fecha ? `${longDate(item.fecha)}${item.vencida ? ' (vencida)' : ''}` : 'Sin fecha', STATUS_WORD[item.estado] || item.estado,
  ]) });
  const ev = letter.evidence || {};
  if (ev.fuente) {
    const parts = [];
    if (ev.novedades_graves) parts.push(`${ev.novedades_graves} ${ev.novedades_graves === 1 ? 'novedad' : 'novedades'} de prioridad alta o crítica (la última, el ${longDate(ev.ultima_grave)})`);
    if (ev.alertas?.length) parts.push(`${ev.alertas.length} ${ev.alertas.length === 1 ? 'alerta' : 'alertas'} de riesgo reportadas por nuestro personal`);
    p(parts.length
      ? `Desde la aprobación del estudio, nuestro personal en el puesto registró ${parts.join(' y ')}, lo que confirma que los riesgos identificados siguen presentes.`
      : 'Desde la aprobación del estudio, nuestro personal no ha registrado novedades graves en el puesto; aun así, los riesgos identificados se mantienen mientras las medidas no se implementen.');
    if (ev.alertas?.length) blocks.push({ kind: 'list', items: ev.alertas.map(alert => `${longDate(alert.fecha)} · ${alert.riesgo}${alert.descripcion ? `: ${alert.descripcion}` : ''}`.slice(0, 500)) });
  }
  p('Les reiteramos la importancia de implementar estas medidas: mientras sigan pendientes, los riesgos asociados pueden materializarse. Quedamos atentos para acompañarlos en su implementación y para revisar juntos el plan de trabajo.');
  blocks.push({ kind: 'spacer' });
  blocks.push({ kind: 'signature', text: 'Cordialmente,' });
  blocks.push({ kind: 'spacer' });
  blocks.push({ kind: 'signature', text: `**${requesterName || 'Seguridad Nacional Ltda.'}**\nSeguridad Nacional Ltda.` });
  return { blocks };
}

export function letterPath(snapshot, letter, now = new Date()) {
  const study = snapshot.estudio;
  const folder = `${ARCHIVE_BASE_PATH}/${sharepointSafeName(`${study.codigo} ${study.cliente.nombre} - ${study.sede.nombre}`, 150)}/Cartas`;
  const name = `${sharepointSafeName(study.codigo, 40)}_Carta_recomendacion_${bogotaDay(now)}_${String(letter.id).slice(0, 8)}.pdf`;
  return { folder, name };
}

// --- La cola del servidor de tareas ---------------------------------------------------------------------------------

const LETTER_ERRORS = Object.freeze({ version: 'no se encontró la versión aprobada', carta: 'no se pudo armar la carta', pdf: 'no se pudo convertir a PDF', no_subio: 'no se pudo subir a SharePoint' });

/** Toma hasta 3 cartas pendientes (o colgadas más de 10 minutos), las arma, las convierte y las sube. */
export async function runLetterBatch(database, deps, log = () => {}, now = new Date()) {
  const stale = new Date(now.getTime() - 10 * 60e3).toISOString();
  const { data, error } = await database.from(LETTERS).select('*').in('status', ['pendiente', 'procesando']).order('requested_at', { ascending: true }).limit(10);
  if (missingTable(error)) return { processed: 0, ok: 0 };
  if (error) throw error;
  const queue = (data || []).filter(item => item.status === 'pendiente' || (item.started_at && item.started_at < stale)).slice(0, 3);
  let ok = 0;
  for (const letter of queue) {
    // Toma optimista: sólo si nadie más la tomó entretanto.
    const { data: claimed } = await database.from(LETTERS).update({ status: 'procesando', started_at: now.toISOString(), attempts: letter.attempts + 1, error: null })
      .eq('id', letter.id).eq('status', letter.status).select('id');
    if (!claimed?.length) continue;
    let reason = null;
    let url = null;
    let folder = null;
    try {
      const [{ data: version }, { data: requester }, { data: delivery }] = await Promise.all([
        database.from('psi_security_study_versions').select('snapshot, approved_at').eq('study_id', letter.study_id).eq('version', letter.version).maybeSingle(),
        database.from('psi_sales_profiles').select('full_name').eq('id', letter.requested_by).maybeSingle(),
        database.from('psi_security_study_deliveries').select('delivered_on').eq('study_id', letter.study_id).eq('version', letter.version).maybeSingle(),
      ]);
      if (!version) { reason = 'version'; throw new Error(reason); }
      let docx;
      try { docx = await deps.renderDocx(buildLetterReport(letter, version.snapshot, { approvedAt: version.approved_at, requesterName: requester?.full_name, deliveredOn: day(delivery?.delivered_on), now })); } catch { reason = 'carta'; throw new Error(reason); }
      let pdf;
      try { pdf = await deps.toPdf(docx); } catch { reason = 'pdf'; throw new Error(reason); }
      const path = letterPath(version.snapshot, letter, now);
      folder = path.folder;
      const stdout = String(await deps.upload(`${path.folder}/${path.name}`, pdf));
      if (!/escrito:/.test(stdout) && !/YA EXISTE/.test(stdout)) { reason = 'no_subio'; throw new Error(reason); }
      url = stdout.match(/^url:\s*(https:\/\/\S+)/m)?.[1] || null;
    } catch { reason = reason || 'carta'; }
    const done = !reason;
    await database.from(LETTERS).update(done
      ? { status: 'lista', file_url: url, folder_path: folder, error: null }
      : { status: letter.attempts + 1 >= 3 ? 'fallida' : 'pendiente', error: LETTER_ERRORS[reason] || 'error técnico' }).eq('id', letter.id);
    if (done) ok += 1; else log({ event: 'estudios_carta_fallida', letter_id: letter.id, motivo: reason });
  }
  if (queue.length) log({ event: 'estudios_cartas_corrida', procesadas: queue.length, listas: ok });
  return { processed: queue.length, ok };
}

export const LETTER_MEDIUMS = MEDIUM_WORD;
