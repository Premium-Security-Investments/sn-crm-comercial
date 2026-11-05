// Estudios de Seguridad Física, tramo 5 — la caracterización de la sede (Juan, 2026-11-05).
//
// Lo que el informe real de HADA trae en su capítulo I-A y el SIIO no capturaba: el contexto de la sede y tres tablas
// (estadística de delitos con su fuente, contactos y dispositivo de seguridad). El dispositivo se puede sembrar desde
// los puestos del contrato en Avancys —la fuente del dato— y luego completar (horario, armado, modalidad), que Avancys
// no tiene. Como el resto del módulo: sólo se edita en borrador o devuelto, y lo valida el servidor.

const EDITABLE_STATUSES = new Set(['borrador', 'devuelto']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const CHARACTERIZATION_TABLES = Object.freeze({
  estadisticas: 'psi_security_study_crime_stats',
  contactos: 'psi_security_study_contacts',
  dispositivo: 'psi_security_study_posts',
});
const CONTACT_KINDS = new Set(['apoyo', 'empresa', 'interventor']);
const MODALITIES = new Set(['vigilancia', 'guia_canino', 'supervision', 'monitoreo', 'otro']);
const MAX_ROWS = 60;

function invalid(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function text(value, { field, min = 0, max }) {
  if (value !== undefined && value !== null && typeof value !== 'string') throw invalid(`${field}: debe ser texto.`);
  const clean = typeof value === 'string' ? value.trim() : '';
  if (clean.length < min) throw invalid(`${field}: dato obligatorio.`);
  if (clean.length > max) throw invalid(`${field}: máximo ${max} caracteres.`);
  return clean || null;
}

const oneLine = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ') : value);

async function must(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

async function editableStudy(db, studyId) {
  if (typeof studyId !== 'string' || !UUID.test(studyId)) throw invalid('Estudio: identificador inválido.');
  const study = await must(db.from('psi_security_studies').select('id, status, client_source, client_ref, client_nit').eq('id', studyId).maybeSingle());
  if (!study) throw invalid('Estudio no encontrado.', 404);
  if (!EDITABLE_STATUSES.has(study.status)) throw invalid('El estudio no está en borrador: no se puede modificar.', 409);
  return study;
}

/** Los campos de texto de la caracterización, para `updateStudy`. Sólo los que vienen en el cuerpo. */
export function cleanCharacterization(body = {}) {
  const patch = {};
  const longText = (key, field, max) => { if (body[key] !== undefined) patch[key] = text(body[key], { field, max }); };
  longText('client_description', 'Descripción del cliente', 4000);
  longText('location_description', 'Ubicación y vía de aproximación', 4000);
  longText('external_context', 'Contexto externo', 8000);
  longText('criminal_groups', 'Grupos delincuenciales', 4000);
  longText('internal_context', 'Contexto interno', 8000);
  for (const [key, field, limit] of [['latitude', 'Latitud', 90], ['longitude', 'Longitud', 180]]) {
    if (body[key] === undefined) continue;
    if (body[key] === null || body[key] === '') { patch[key] = null; continue; }
    const number = Number(body[key]);
    if (!Number.isFinite(number) || Math.abs(number) > limit) throw invalid(`${field}: debe ser un número entre -${limit} y ${limit}.`);
    patch[key] = Math.round(number * 1e6) / 1e6;
  }
  if (body.context_sources !== undefined) {
    if (!Array.isArray(body.context_sources) || body.context_sources.length > 15) throw invalid('Fuentes: máximo 15.');
    patch.context_sources = body.context_sources.map((source, index) => {
      const nombre = text(oneLine(source?.nombre), { field: `Fuente ${index + 1}`, min: 2, max: 200 });
      const url = text(source?.url, { field: `Fuente ${index + 1} (enlace)`, max: 500 });
      if (url && !/^https?:\/\//i.test(url)) throw invalid(`Fuente ${index + 1}: el enlace debe empezar por http.`);
      const fecha = source?.fecha && ISO_DATE.test(source.fecha) ? source.fecha : null;
      return { nombre, url, fecha };
    });
  }
  return patch;
}

function cleanRow(kind, body = {}) {
  if (kind === 'estadisticas') {
    const count = Number(body.count);
    if (!Number.isInteger(count) || count < 0) throw invalid('Cantidad: debe ser un número entero.');
    return {
      crime: text(oneLine(body.crime), { field: 'Delito', min: 2, max: 160 }),
      count,
      source: text(oneLine(body.source), { field: 'Fuente', min: 2, max: 300 }),
      cutoff_date: body.cutoff_date && ISO_DATE.test(body.cutoff_date) ? body.cutoff_date : null,
    };
  }
  if (kind === 'contactos') {
    if (!CONTACT_KINDS.has(body.kind)) throw invalid('Tipo de contacto inválido.');
    return {
      kind: body.kind,
      entity: text(oneLine(body.entity), { field: 'Entidad', min: 2, max: 160 }),
      detail: text(oneLine(body.detail), { field: 'Detalle', max: 200 }),
      phone: text(oneLine(body.phone), { field: 'Teléfono', max: 120 }),
      email: text(oneLine(body.email), { field: 'Correo', max: 160 }),
    };
  }
  if (kind === 'dispositivo') {
    const modality = body.modality ?? 'vigilancia';
    if (!MODALITIES.has(modality)) throw invalid('Modalidad inválida.');
    const quantity = body.quantity === undefined || body.quantity === '' ? 1 : Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw invalid('Cantidad: de 1 a 999.');
    return {
      name: text(oneLine(body.name), { field: 'Servicio', min: 2, max: 200 }),
      modality,
      schedule: text(oneLine(body.schedule), { field: 'Horario', max: 120 }),
      armed: body.armed === true ? true : body.armed === false ? false : null,
      quantity,
    };
  }
  throw invalid('Sección inválida.', 404);
}

function tableFor(kind) {
  const table = CHARACTERIZATION_TABLES[kind];
  if (!table) throw invalid('Sección inválida.', 404);
  return table;
}

export async function addCharacterizationRow(db, studyId, kind, body = {}) {
  const study = await editableStudy(db, studyId);
  const table = tableFor(kind);
  const row = cleanRow(kind, body);
  const existing = await must(db.from(table).select('position').eq('study_id', study.id));
  if ((existing || []).length >= MAX_ROWS) throw invalid(`Máximo ${MAX_ROWS} filas por sección.`);
  const position = Math.max(0, ...(existing || []).map(item => item.position)) + 1;
  return must(db.from(table).insert({ ...row, study_id: study.id, position }).select('*').single());
}

export async function updateCharacterizationRow(db, studyId, kind, rowId, body = {}) {
  const study = await editableStudy(db, studyId);
  const table = tableFor(kind);
  if (typeof rowId !== 'string' || !UUID.test(rowId)) throw invalid('Fila: identificador inválido.');
  const current = await must(db.from(table).select('*').eq('id', rowId).eq('study_id', study.id).maybeSingle());
  if (!current) throw invalid('Fila: no existe en este estudio.', 404);
  return must(db.from(table).update(cleanRow(kind, { ...current, ...body })).eq('id', current.id).select('*').single());
}

export async function deleteCharacterizationRow(db, studyId, kind, rowId) {
  const study = await editableStudy(db, studyId);
  const table = tableFor(kind);
  if (typeof rowId !== 'string' || !UUID.test(rowId)) throw invalid('Fila: identificador inválido.');
  const current = await must(db.from(table).select('id').eq('id', rowId).eq('study_id', study.id).maybeSingle());
  if (!current) throw invalid('Fila: no existe en este estudio.', 404);
  await must(db.from(table).delete().eq('id', current.id));
  return { deleted: current.id };
}

/**
 * Siembra el dispositivo con los puestos de los contratos del cliente en Avancys. No duplica: un puesto que ya está
 * (mismo código) no se vuelve a agregar. `lector` es el de avancys-odoo-lectura.js (puestosDelCliente).
 */
export async function seedPostsFromAvancys(db, studyId, lector) {
  const study = await editableStudy(db, studyId);
  if (study.client_source !== 'avancys' || !(study.client_nit || study.client_ref)) throw invalid('El cliente del estudio no viene de Avancys: el dispositivo se registra a mano.');
  if (!lector) throw invalid('Avancys no está disponible en este momento.', 503);
  const result = await lector.puestosDelCliente({ identificacion: study.client_nit || study.client_ref });
  const posts = (result?.contratos || []).flatMap(contract => contract.puestos || []).filter(post => post?.codigo && post?.nombre);
  const existing = await must(db.from('psi_security_study_posts').select('source_ref, position').eq('study_id', study.id));
  const known = new Set((existing || []).map(item => item.source_ref).filter(Boolean));
  let position = Math.max(0, ...(existing || []).map(item => item.position));
  const rows = posts.filter(post => !known.has(post.codigo)).slice(0, MAX_ROWS - (existing || []).length)
    .map(post => ({ study_id: study.id, source: 'avancys', source_ref: post.codigo, name: String(post.nombre).slice(0, 200), modality: 'vigilancia', quantity: 1, position: ++position }));
  const created = rows.length ? await must(db.from('psi_security_study_posts').insert(rows).select('*')) : [];
  return { added: created.length, already: known.size, found: posts.length, total_contratos: result?.contratos?.length ?? 0 };
}

const missingTable = error => error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message || ''));

/** Las tres tablas para la ficha. Sin la migración 187, vacías y `available: false`. */
export async function loadCharacterization(db, studyId) {
  const entries = await Promise.all(Object.entries(CHARACTERIZATION_TABLES).map(async ([kind, table]) => {
    const { data, error } = await db.from(table).select('*').eq('study_id', studyId).order('position', { ascending: true });
    if (missingTable(error)) return [kind, null];
    if (error) throw error;
    return [kind, data || []];
  }));
  const result = Object.fromEntries(entries.map(([kind, rows]) => [kind, rows || []]));
  return { ...result, available: entries.every(([, rows]) => rows !== null) };
}
