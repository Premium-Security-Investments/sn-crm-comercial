// Estudios de Seguridad Física: SecurityOps como fuente del estudio (Juan, 2026-11-10: "podemos construir ya").
//
// Juan: en SecurityOps, el formulario «Alerta de Riesgos» y la entrada «Estudio de seguridad» del historial del puesto se
// están construyendo "precisamente para que sean unas de nuestras fuentes de información". Este módulo:
//
//   1. trae el directorio de puestos de SecurityOps para buscar y vincular (migración 201);
//   2. para cada estudio vinculado, trae los antecedentes del puesto en los últimos 12 meses.
//
// Lo corre el servidor de tareas (ops/estudios-seguridad/run-estudios-seguridad-securityops.mjs), que tiene la cuenta de
// servicio de SOLO LECTURA. A Firestore se le piden únicamente los campos de FIELDS (proyección): nunca nombres de
// guardas o supervisores, cédulas, firmas, selfies, coordenadas de las personas ni biometría. De las novedades sólo
// salen conteos: su texto libre puede llevar datos de capturados (judicialización).

export const SECOPS_PROJECT = 'security-ops-e8534';
export const WINDOW_DAYS = 365;
export const DIRECTORY_MAX_AGE_HOURS = 24;
export const STUDY_REFRESH_HOURS = 24;
const MAX_DOCS = 3000;
const MAX_ALERTS = 40;
const MAX_NOTES = 40;
const MAX_FAILURES = 40;
const EDITABLE = ['borrador', 'devuelto', 'en_revision', 'revisado'];
// Los aprobados también se refrescan una vez al día (no a pedido): sus siniestros posteriores piden revaloración
// (vigencia.js). La versión aprobada no cambia: congeló lo que había.
const DAILY = [...EDITABLE, 'aprobado', 'archivado'];
// Estados de un ticket de fallas que siguen abiertos (SecurityOps src/utils/reportesFallas.js; igual que AGT-004).
const TICKET_OPEN = new Set(['nuevo', 'convertido', 'atendido', 'en_aprobacion', 'cotizacion_aprobada', 'cotizacion_rechazada']);

export const FIELDS = Object.freeze({
  puestos: ['name', 'address', 'municipio', 'departamento', 'regional', 'zone', 'sap', 'type', 'status', 'esUnidadMonitoreo', 'position', 'pendienteGeo'],
  novedades: ['tipo', 'prioridad', 'createdAt'],
  rondas: ['iniciadaEn', 'completitud', 'status'],
  puesto_visits: ['arrivalAt', 'tipoVisita', 'status'],
  reportes_fallas: ['titulo', 'estado', 'prioridad', 'createdAt'],
  visitas_tecnico: ['fecha', 'status'],
  // «Alerta de Riesgos»: el riesgo, la alerta y las recomendaciones. Las fotos sólo se cuentan.
  formularios: ['formType', 'fecha', 'createdAt', 'identificacionRiesgo', 'descripcionAlerta', 'recomendaciones', 'fotos', 'createdByRole'],
  // «Estudio de seguridad» del historial del puesto: lo escribe coordinación. `creadoPor` no se pide.
  historial: ['tipo', 'titulo', 'detalle', 'fecha', 'realizadoPor', 'recomendaciones', 'adjuntos', 'anulada', 'createdAt'],
});

// --- Firestore por REST --------------------------------------------------------------------------------------

export function decodeValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decodeValue(item)]));
  if ('referenceValue' in value) return value.referenceValue;
  return null;
}

export function decodeDoc(doc) {
  const fields = Object.fromEntries(Object.entries(doc.fields || {}).map(([key, value]) => [key, decodeValue(value)]));
  return { id: String(doc.name || '').split('/').pop(), ...fields };
}

const fieldValue = value => (typeof value === 'boolean' ? { booleanValue: value } : Number.isInteger(value) ? { integerValue: String(value) } : { stringValue: String(value) });

// Lector de sólo lectura. `getToken` da el token de la cuenta de servicio; `fetchImpl` permite probar sin red.
export function firestoreReader({ getToken, project = SECOPS_PROJECT, fetchImpl = globalThis.fetch }) {
  const root = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
  async function runQuery({ collection, parent = '', where = [], select, limit = MAX_DOCS, after }) {
    const filters = where.map(([field, value]) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: fieldValue(value) } }));
    const structuredQuery = {
      from: [{ collectionId: collection }],
      ...(select ? { select: { fields: select.map(fieldPath => ({ fieldPath })) } } : {}),
      ...(filters.length === 1 ? { where: filters[0] } : filters.length > 1 ? { where: { compositeFilter: { op: 'AND', filters } } } : {}),
      ...(after !== undefined ? { orderBy: [{ field: { fieldPath: '__name__' } }] } : {}),
      ...(after ? { startAt: { values: [{ referenceValue: after }], before: false } } : {}),
      limit,
    };
    const response = await fetchImpl(`${root}${parent ? `/${parent}` : ''}:runQuery`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await getToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ structuredQuery }),
    });
    if (!response.ok) throw Object.assign(new Error(`firestore_${response.status}`), { code: 'securityops_lectura' });
    const rows = await response.json();
    return rows.filter(row => row.document).map(row => row.document);
  }
  return {
    async query(collection, { where = [], parent = '', limit = MAX_DOCS } = {}) {
      return (await runQuery({ collection, parent, where, select: FIELDS[collection], limit })).map(decodeDoc);
    },
    // Toda la colección por páginas, en orden de documento (sólo para el directorio de puestos).
    async all(collection, { page = 1000 } = {}) {
      const out = [];
      let after = null;
      for (;;) {
        const docs = await runQuery({ collection, select: FIELDS[collection], limit: page, after });
        out.push(...docs.map(decodeDoc));
        if (docs.length < page || out.length >= 20000) return out;
        after = docs.at(-1).name;
      }
    },
  };
}

// --- Directorio de puestos -----------------------------------------------------------------------------------

export function normalizeSearch(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// "Zona 3 - Nombre del coordinador" → 3. El nombre del coordinador no se guarda.
const zoneNumber = value => { const match = String(value ?? '').match(/\d+/); return match ? Number(match[0]) : null; };
const clean = (value, max = 300) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text ? text.slice(0, max) : null; };
const coordinate = (value, limit) => (Number.isFinite(value) && Math.abs(value) <= limit && value !== 0 ? Math.round(value * 1e6) / 1e6 : null);

export function puestoRow(puesto, stamp) {
  const name = clean(puesto.name, 200) || '(sin nombre)';
  const address = clean(puesto.address, 300);
  const municipio = clean(puesto.municipio, 120);
  return {
    id: puesto.id, name, address, municipio,
    departamento: clean(puesto.departamento, 120),
    regional: clean(puesto.regional, 60)?.toUpperCase() || null,
    zone: zoneNumber(puesto.zone),
    sap: clean(puesto.sap, 40),
    kind: clean(puesto.type, 40),
    monitoring: puesto.esUnidadMonitoreo === true,
    latitude: coordinate(puesto.position?.lat, 90),
    longitude: coordinate(puesto.position?.lng, 180),
    geo_pending: puesto.pendienteGeo === true,
    active: puesto.status !== 'archivado',
    search_text: normalizeSearch([name, address, municipio, clean(puesto.sap, 40)].filter(Boolean).join(' ')),
    synced_at: stamp,
  };
}

const missingTable = error => error && (error.code === '42P01' || error.code === '42703' || error.code === 'PGRST205' || error.code === 'PGRST204' || /does not exist|could not find/i.test(error.message || ''));

export async function syncDirectory(db, reader, now = new Date()) {
  const stamp = now.toISOString();
  const rows = (await reader.all('puestos')).filter(puesto => puesto.id).map(puesto => puestoRow(puesto, stamp));
  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await db.from('psi_securityops_puestos').upsert(rows.slice(index, index + 500), { onConflict: 'id' });
    if (error) throw error;
  }
  // Lo que ya no está en SecurityOps queda inactivo (no se borra: puede estar vinculado a un estudio).
  const seen = new Set(rows.map(row => row.id));
  const { data: known, error } = await db.from('psi_securityops_puestos').select('id').eq('active', true);
  if (error) throw error;
  const gone = (known || []).map(row => row.id).filter(id => !seen.has(id));
  if (gone.length) {
    const { error: updateError } = await db.from('psi_securityops_puestos').update({ active: false }).in('id', gone);
    if (updateError) throw updateError;
  }
  return { puestos: rows.length, inactivos: gone.length };
}

async function directoryIsStale(db, now) {
  const { data, error } = await db.from('psi_securityops_puestos').select('synced_at').order('synced_at', { ascending: false }).limit(1);
  if (error) throw error;
  if (!data?.length) return true;
  return now.getTime() - Date.parse(data[0].synced_at) > DIRECTORY_MAX_AGE_HOURS * 3600e3;
}

// --- Antecedentes de un puesto -------------------------------------------------------------------------------

// Día en Colombia (UTC−5, sin horario de verano): una novedad de las 9 p. m. no puede quedar al día siguiente.
const day = value => {
  if (!value) return null;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time - 5 * 3600e3).toISOString().slice(0, 10) : null;
};
const within = (value, from) => { const d = day(value); return Boolean(d) && d >= from; };
const countBy = (rows, key) => rows.reduce((acc, row) => { const k = clean(row[key], 60) || 'sin dato'; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
const latest = rows => rows.map(row => row._day).filter(Boolean).sort().at(-1) || null;

export function buildAntecedentes(raw, now = new Date()) {
  const to = day(now.toISOString());
  const from = day(new Date(now.getTime() - WINDOW_DAYS * 86400e3).toISOString());
  const pick = (rows, field) => (rows || []).map(row => ({ ...row, _day: day(row[field]) })).filter(row => within(row._day, from));

  const novedades = pick(raw.novedades, 'createdAt');
  const rondas = pick(raw.rondas, 'iniciadaEn');
  const visitas = pick(raw.visitas, 'arrivalAt');
  const fallas = pick(raw.fallas, 'createdAt');
  const tecnicas = pick(raw.tecnicas, 'fecha');
  const completitudes = rondas.map(row => Number(row.completitud)).filter(Number.isFinite);
  const priorities = countBy(novedades, 'prioridad');
  // Migración 209: los días de las novedades graves, para pedir revaloración si ocurren después de aprobar.
  const graves = novedades.filter(row => ['alta', 'critica'].includes(row.prioridad)).map(row => row._day).filter(Boolean).sort().reverse().slice(0, 50);

  const summary = {
    novedades: { total: novedades.length, por_tipo: countBy(novedades, 'tipo'), altas: (priorities.alta || 0) + (priorities.critica || 0), altas_fechas: graves, ultima: latest(novedades) },
    rondas: { total: rondas.length, completitud_promedio: completitudes.length ? Math.round(completitudes.reduce((a, b) => a + b, 0) / completitudes.length) : null },
    visitas: { total: visitas.length, por_tipo: countBy(visitas, 'tipoVisita'), ultima: latest(visitas) },
    fallas: { total: fallas.length, abiertas: fallas.filter(row => TICKET_OPEN.has(row.estado)).length },
    visitas_tecnicas: { total: tecnicas.length, ultima: latest(tecnicas) },
  };

  // Las alertas y notas no se recortan a 12 meses: son pocas y son justamente lo que se quiere leer.
  const alerts = (raw.alertas || [])
    .filter(row => row.formType === 'alerta-riesgos' && clean(row.identificacionRiesgo))
    .map(row => ({
      id: row.id, fecha: day(row.fecha) || day(row.createdAt),
      riesgo: clean(row.identificacionRiesgo, 300), descripcion: clean(row.descripcionAlerta, 2000),
      recomendaciones: clean(row.recomendaciones, 2000), fotos: Array.isArray(row.fotos) ? row.fotos.filter(Boolean).length : 0,
      rol: clean(row.createdByRole, 40),
    }))
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, MAX_ALERTS);
  const notes = (raw.historial || [])
    .filter(row => row.tipo === 'estudio' && row.anulada !== true && (clean(row.titulo) || clean(row.detalle)))
    .map(row => ({
      id: row.id, fecha: day(row.fecha) || day(row.createdAt),
      titulo: clean(row.titulo, 160), detalle: clean(row.detalle, 4000), realizado_por: clean(row.realizadoPor, 120),
      recomendaciones: clean(row.recomendaciones, 4000), adjuntos: Array.isArray(row.adjuntos) ? row.adjuntos.length : 0,
    }))
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, MAX_NOTES);
  const failures = fallas
    .map(row => ({ fecha: row._day, titulo: clean(row.titulo, 200), estado: clean(row.estado, 40), prioridad: clean(row.prioridad, 20), abierta: TICKET_OPEN.has(row.estado) }))
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, MAX_FAILURES);
  return { window_from: from, window_to: to, summary, alerts, notes, failures };
}

export async function fetchAntecedentes(reader, puestoId, now = new Date()) {
  const by = [['puestoId', puestoId]];
  const [novedades, rondas, visitas, fallas, tecnicas, alertas, historial] = await Promise.all([
    reader.query('novedades', { where: by }),
    reader.query('rondas', { where: by }),
    reader.query('puesto_visits', { where: by }),
    reader.query('reportes_fallas', { where: by }),
    reader.query('visitas_tecnico', { where: by }),
    reader.query('formularios', { where: [...by, ['formType', 'alerta-riesgos']] }),
    reader.query('historial', { parent: `puestos/${encodeURIComponent(puestoId)}`, where: [['tipo', 'estudio']] }),
  ]);
  return buildAntecedentes({ novedades, rondas, visitas, fallas, tecnicas, alertas, historial }, now);
}

// Estudios con puesto vinculado que piden datos: recién vinculados o con "Actualizar", y los que siguen en trabajo y
// tienen más de un día. Los aprobados no se refrescan: su versión ya congeló lo que había.
export async function pendingStudies(db, now = new Date()) {
  const { data: studies, error } = await db.from('psi_security_studies').select('id, status, securityops_puesto_id, securityops_requested_at').in('status', DAILY);
  if (error) throw error;
  const linked = (studies || []).filter(study => study.securityops_puesto_id);
  if (!linked.length) return [];
  const { data: synced, error: syncedError } = await db.from('psi_security_study_securityops').select('study_id, puesto_id, synced_at').in('study_id', linked.map(study => study.id));
  if (syncedError) throw syncedError;
  const last = new Map((synced || []).map(row => [row.study_id, row]));
  return linked.filter(study => {
    const row = last.get(study.id);
    if (!row || row.puesto_id !== study.securityops_puesto_id) return true;
    const at = Date.parse(row.synced_at);
    if (study.securityops_requested_at && Date.parse(study.securityops_requested_at) > at) return true;
    return now.getTime() - at > STUDY_REFRESH_HOURS * 3600e3;
  });
}

async function saveSync(db, row) {
  const { error } = await db.from('psi_security_study_securityops').upsert(row, { onConflict: 'study_id' });
  if (error) throw error;
}

export async function runSecurityOpsSync(db, reader, log = () => {}, now = new Date()) {
  const result = { directorio: null, estudios: 0, fallidos: 0 };
  try {
    if (await directoryIsStale(db, now)) {
      result.directorio = await syncDirectory(db, reader, now);
      log({ event: 'estudios_securityops_directorio', ...result.directorio });
    }
  } catch (error) {
    if (missingTable(error)) { log({ event: 'estudios_securityops_sin_migracion' }); return result; }
    log({ event: 'estudios_securityops_directorio_fallido', code: error?.code || 'desconocido' });
  }
  let pending;
  try {
    pending = await pendingStudies(db, now);
  } catch (error) {
    if (missingTable(error)) { log({ event: 'estudios_securityops_sin_migracion' }); return result; }
    throw error;
  }
  for (const study of pending.slice(0, 10)) {
    const base = { study_id: study.id, puesto_id: study.securityops_puesto_id, synced_at: now.toISOString() };
    try {
      await saveSync(db, { ...base, status: 'ok', error: null, ...(await fetchAntecedentes(reader, study.securityops_puesto_id, now)) });
      result.estudios += 1;
    } catch (error) {
      result.fallidos += 1;
      log({ event: 'estudios_securityops_estudio_fallido', study: study.id, code: error?.code || 'desconocido' });
      await saveSync(db, { ...base, status: 'error', error: 'No se pudo leer SecurityOps; se reintenta en la próxima corrida.', summary: {}, alerts: [], notes: [], failures: [] }).catch(() => {});
    }
  }
  return result;
}

// --- Lo que lee el SIIO --------------------------------------------------------------------------------------

export async function searchPuestos(db, query = '', { todos = false } = {}) {
  const words = normalizeSearch(query).split(' ').filter(word => word.length >= 2).slice(0, 4);
  if (!words.length) return [];
  let request = db.from('psi_securityops_puestos').select('id, name, address, municipio, departamento, regional, zone, sap, kind, monitoring, latitude, longitude, geo_pending').eq('active', true);
  if (!todos) request = request.eq('monitoring', false);
  for (const word of words) request = request.ilike('search_text', `%${word}%`);
  const { data, error } = await request.order('name', { ascending: true }).limit(25);
  if (error) {
    if (missingTable(error)) return [];
    throw error;
  }
  return data || [];
}

export async function loadSecurityOps(db, study) {
  if (!study.securityops_puesto_id) return { available: true, puesto: null, data: null };
  const [puesto, synced] = await Promise.all([
    db.from('psi_securityops_puestos').select('id, name, address, municipio, departamento, regional, zone, sap, kind, monitoring, latitude, longitude, geo_pending, active').eq('id', study.securityops_puesto_id).maybeSingle(),
    db.from('psi_security_study_securityops').select('*').eq('study_id', study.id).maybeSingle(),
  ]);
  if (missingTable(puesto.error) || missingTable(synced.error)) return { available: false, puesto: null, data: null };
  if (puesto.error) throw puesto.error;
  if (synced.error) throw synced.error;
  const data = synced.data && synced.data.puesto_id === study.securityops_puesto_id ? synced.data : null;
  const pending = !data || (study.securityops_requested_at && Date.parse(study.securityops_requested_at) > Date.parse(data.synced_at));
  return { available: true, puesto: puesto.data || { id: study.securityops_puesto_id, name: '(puesto no encontrado en el directorio)' }, data, pending: Boolean(pending) };
}

const PUESTO_ID = /^[A-Za-z0-9_-]{1,128}$/;

// Vincula (o desvincula con null) y pide traer los datos. Sólo en un estudio editable: lo decide la ruta.
export async function linkPuesto(db, study, puestoId, now = new Date()) {
  if (puestoId !== null && !PUESTO_ID.test(String(puestoId || ''))) throw Object.assign(new Error('Puesto de SecurityOps inválido.'), { status: 400 });
  if (puestoId) {
    const { data, error } = await db.from('psi_securityops_puestos').select('id').eq('id', puestoId).maybeSingle();
    if (error) throw error;
    if (!data) throw Object.assign(new Error('Ese puesto no está en el directorio de SecurityOps.'), { status: 404 });
  }
  const { error } = await db.from('psi_security_studies').update({ securityops_puesto_id: puestoId, securityops_requested_at: puestoId ? now.toISOString() : null, updated_at: now.toISOString() }).eq('id', study.id);
  if (error) throw error;
  return { puesto_id: puestoId };
}

export async function requestRefresh(db, study, now = new Date()) {
  if (!study.securityops_puesto_id) throw Object.assign(new Error('El estudio no tiene un puesto de SecurityOps vinculado.'), { status: 409 });
  const { error } = await db.from('psi_security_studies').update({ securityops_requested_at: now.toISOString() }).eq('id', study.id);
  if (error) throw error;
  return { requested: true };
}

// "securityops:alerta:<id>" o "securityops:nota:<id>", y que esa alerta o nota esté en lo traído para ESTE estudio.
export async function resolveSourceRef(db, studyId, sourceRef) {
  const match = /^securityops:(alerta|nota):([A-Za-z0-9_-]{1,128})$/.exec(String(sourceRef || ''));
  if (!match) throw Object.assign(new Error('Referencia de SecurityOps inválida.'), { status: 400 });
  const { data, error } = await db.from('psi_security_study_securityops').select('alerts, notes').eq('study_id', studyId).maybeSingle();
  if (error) throw error;
  const list = match[1] === 'alerta' ? data?.alerts : data?.notes;
  const item = (list || []).find(entry => entry.id === match[2]);
  if (!item) throw Object.assign(new Error('Esa alerta o nota no está entre lo traído de SecurityOps para este estudio.'), { status: 409 });
  return item;
}

// "Llevar al estudio": el riesgo nace de una alerta o nota de SecurityOps, con su referencia. Las calificaciones las pone
// el analista en el mismo formulario: SecurityOps no califica nada.
export async function addRiskFromSecurityOps(db, studyId, body, profile, addRisk) {
  const sourceRef = String(body?.source_ref || '');
  await resolveSourceRef(db, studyId, sourceRef);
  const { data: existing, error } = await db.from('psi_security_study_risks').select('number').eq('study_id', studyId).eq('source_ref', sourceRef).maybeSingle();
  if (error) throw error;
  if (existing) throw Object.assign(new Error(`Esa alerta ya está en el estudio como R${existing.number}.`), { status: 409 });
  const { source_ref: _ref, ...fields } = body;
  return addRisk(db, studyId, fields, profile, { origin: 'securityops', sourceRef });
}
