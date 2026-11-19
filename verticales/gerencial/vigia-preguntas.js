// AGT-001 «Pregúntele a Vig-IA»: preguntas en lenguaje natural de los directivos, en la pestaña Vig-IA de la Torre.
//
// Decisiones de Juan Botero, 2026-11-19 (reemplazan el «sin chat» del 2026-10-11 para esta función):
// - lo usa todo perfil con acceso a la Torre; no hay permiso aparte;
// - ve datos completos: nombres, cédulas y salarios;
// - cada persona ve solo sus preguntas y respuestas;
// - Vig-IA aprende: guarda dónde encontró cada dato y lo que hay que saber de él, y el administrador ve qué se pregunta
//   más (sin las respuestas) y puede quitar lo aprendido.
//
// La API solo registra y lee. Responde el trabajador del servidor (ops/agt001-preguntas), que lee la cola, corre
// Vig-IA con herramientas de solo lectura sobre Avancys, SecurityOps y el CRM, y escribe la respuesta.

export const PREGUNTAS_TABLE = 'siio_vigia_preguntas';
export const CONOCIMIENTO_TABLE = 'siio_vigia_conocimiento';
export const MAX_PREGUNTA = 600;
export const PREGUNTAS_POR_DIA = 40;
export const PREGUNTAS_VISIBLES = 30;
// Una pregunta «leyendo» que pasa de esto se da por perdida (el trabajador corta cada turno a los 8 minutos).
export const PREGUNTA_ABANDONADA_MS = 12 * 60_000;

function fail(message, status, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function requireResult(result) {
  if (result?.error) throw result.error;
  return result?.data;
}

export function bogotaDayStart(now = new Date()) {
  const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return new Date(`${fecha}T05:00:00.000Z`);
}

/** La forma con que se comparan dos preguntas: sin tildes, mayúsculas, signos ni espacios de más. */
export function normalizarPregunta(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function limpiarPregunta(texto) {
  const pregunta = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (pregunta.length < 3) throw fail('Escriba la pregunta.', 400, 'VIGIA_PREGUNTA_VACIA');
  if (pregunta.length > MAX_PREGUNTA) throw fail(`La pregunta puede tener hasta ${MAX_PREGUNTA} caracteres.`, 400, 'VIGIA_PREGUNTA_LARGA');
  return pregunta;
}

export function esAdministrador(profile) {
  return profile?.role === 'admin';
}

async function expirarAbandonadas(database, now) {
  const limite = new Date(now.getTime() - PREGUNTA_ABANDONADA_MS).toISOString();
  await database.from(PREGUNTAS_TABLE).update({ status: 'fallida', failure_code: 'VIGIA_ABANDONADA', finished_at: now.toISOString() })
    .eq('status', 'leyendo').lt('started_at', limite);
}

const COLUMNAS_PREGUNTA = 'id,question,parent_id,status,answer,answer_table,failure_code,requested_at,started_at,finished_at,duration_ms';

/** Registra una pregunta del perfil. Una a la vez por persona, y un tope diario para no agotar la suscripción. */
export async function askQuestion(database, profile, body = {}, now = new Date()) {
  if (!profile?.id) throw fail('Inicie sesión para preguntar.', 401);
  const question = limpiarPregunta(body.question);
  const parentId = typeof body.parent_id === 'string' && body.parent_id ? body.parent_id : null;
  await expirarAbandonadas(database, now);

  const abiertas = requireResult(await database.from(PREGUNTAS_TABLE).select('id')
    .eq('asked_by', profile.id).in('status', ['pendiente', 'leyendo']).limit(1)) || [];
  if (abiertas.length) throw fail('Vig-IA todavía está contestando su pregunta anterior. Espere a que termine.', 409, 'VIGIA_PREGUNTA_EN_CURSO');

  const hoy = requireResult(await database.from(PREGUNTAS_TABLE).select('id')
    .eq('asked_by', profile.id).gte('requested_at', bogotaDayStart(now).toISOString())) || [];
  if (hoy.length >= PREGUNTAS_POR_DIA) throw fail(`Ya hizo ${PREGUNTAS_POR_DIA} preguntas hoy. Vuelva mañana.`, 429, 'VIGIA_TOPE_DIARIO');

  if (parentId) {
    const padre = requireResult(await database.from(PREGUNTAS_TABLE).select('id').eq('id', parentId).eq('asked_by', profile.id).limit(1)) || [];
    if (!padre.length) throw fail('No se encontró la respuesta sobre la que pregunta.', 404);
  }
  const inserted = await database.from(PREGUNTAS_TABLE)
    .insert({ asked_by: profile.id, question, parent_id: parentId, status: 'pendiente', requested_at: now.toISOString() })
    .select(COLUMNAS_PREGUNTA).single();
  return requireResult(inserted);
}

/** Las preguntas de ESTE perfil, la más reciente primero. Nadie ve las de otro. */
export async function listMyQuestions(database, profile, now = new Date()) {
  if (!profile?.id) throw fail('Inicie sesión.', 401);
  await expirarAbandonadas(database, now);
  const preguntas = requireResult(await database.from(PREGUNTAS_TABLE).select(COLUMNAS_PREGUNTA)
    .eq('asked_by', profile.id).order('requested_at', { ascending: false }).limit(PREGUNTAS_VISIBLES)) || [];
  return { preguntas, puede_ver_aprendizaje: esAdministrador(profile) };
}

/** Agrupa preguntas por su forma normalizada: qué se pregunta, cuántas veces y cuántas personas. */
export function agruparPreguntas(filas) {
  const grupos = new Map();
  for (const fila of filas) {
    const clave = normalizarPregunta(fila.question);
    if (!clave) continue;
    const grupo = grupos.get(clave) || { pregunta: fila.question, veces: 0, personas: new Set(), ultima: fila.requested_at, sin_respuesta: 0 };
    grupo.veces += 1;
    grupo.personas.add(fila.asked_by);
    if (fila.requested_at > grupo.ultima) { grupo.ultima = fila.requested_at; grupo.pregunta = fila.question; }
    if (fila.status === 'fallida') grupo.sin_respuesta += 1;
    grupos.set(clave, grupo);
  }
  return [...grupos.values()]
    .map(grupo => ({ ...grupo, personas: grupo.personas.size }))
    .sort((a, b) => b.veces - a.veces || String(b.ultima).localeCompare(String(a.ultima)));
}

/** Solo el administrador: lo que más se pregunta (sin respuestas ni nombres) y lo que Vig-IA aprendió. */
export async function loadLearning(database, profile) {
  if (!esAdministrador(profile)) throw fail('Solo el administrador ve lo que Vig-IA aprende.', 403);
  const desde = new Date(Date.now() - 90 * 86400_000).toISOString();
  const filas = requireResult(await database.from(PREGUNTAS_TABLE).select('question,asked_by,status,requested_at')
    .gte('requested_at', desde).order('requested_at', { ascending: false }).limit(3000)) || [];
  const conocimiento = requireResult(await database.from(CONOCIMIENTO_TABLE).select('id,topic,note,uses,active,updated_at')
    .eq('active', true).order('updated_at', { ascending: false }).limit(200)) || [];
  return { mas_preguntadas: agruparPreguntas(filas).slice(0, 30), conocimiento };
}

export async function deactivateKnowledge(database, profile, id) {
  if (!esAdministrador(profile)) throw fail('Solo el administrador puede quitar lo aprendido.', 403);
  const { error } = await database.from(CONOCIMIENTO_TABLE).update({ active: false, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
  return { ok: true };
}
