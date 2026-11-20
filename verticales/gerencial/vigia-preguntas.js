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
export const CONVERSACIONES_TABLE = 'siio_vigia_conversaciones';
export const CONVERSACIONES_VISIBLES = 60;
// Desde aquí la pantalla sugiere abrir otra: cada mensaje relee la conversación entera y gasta más suscripción.
export const MENSAJES_LARGA = 16;
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

const COLUMNAS_PREGUNTA = 'id,question,parent_id,conversation_id,status,answer,answer_table,failure_code,progress,requested_at,started_at,finished_at,duration_ms';

export function tituloDeConversacion(pregunta) {
  const texto = String(pregunta || '').replace(/\s+/g, ' ').trim();
  return texto.length > 120 ? `${texto.slice(0, 117).trimEnd()}…` : texto;
}

async function conversacionPropia(database, profile, id) {
  const filas = requireResult(await database.from(CONVERSACIONES_TABLE).select('id,title,created_at,last_message_at')
    .eq('id', id).eq('asked_by', profile.id).limit(1)) || [];
  if (!filas.length) throw fail('No se encontró la conversación.', 404, 'VIGIA_CONVERSACION_NO_EXISTE');
  return filas[0];
}

/**
 * Registra un mensaje del perfil. Sin `conversation_id` abre una conversación nueva (Juan, 2026-11-20: sólo cuando el
 * directivo presiona «Nueva conversación»); con él, sigue esa conversación. Un mensaje a la vez por persona, y un tope
 * diario para no agotar la suscripción.
 */
export async function askQuestion(database, profile, body = {}, now = new Date()) {
  if (!profile?.id) throw fail('Inicie sesión para preguntar.', 401);
  const question = limpiarPregunta(body.question);
  const conversacionPedida = typeof body.conversation_id === 'string' && body.conversation_id ? body.conversation_id : null;
  await expirarAbandonadas(database, now);

  const abiertas = requireResult(await database.from(PREGUNTAS_TABLE).select('id')
    .eq('asked_by', profile.id).in('status', ['pendiente', 'leyendo']).limit(1)) || [];
  if (abiertas.length) throw fail('Vig-IA todavía está contestando su mensaje anterior. Espere a que termine.', 409, 'VIGIA_PREGUNTA_EN_CURSO');

  const hoy = requireResult(await database.from(PREGUNTAS_TABLE).select('id')
    .eq('asked_by', profile.id).gte('requested_at', bogotaDayStart(now).toISOString())) || [];
  if (hoy.length >= PREGUNTAS_POR_DIA) throw fail(`Ya hizo ${PREGUNTAS_POR_DIA} preguntas hoy. Vuelva mañana.`, 429, 'VIGIA_TOPE_DIARIO');

  let conversationId = conversacionPedida;
  let parentId = null;
  if (conversacionPedida) {
    await conversacionPropia(database, profile, conversacionPedida);
    const ultima = requireResult(await database.from(PREGUNTAS_TABLE).select('id')
      .eq('conversation_id', conversacionPedida).order('requested_at', { ascending: false }).limit(1)) || [];
    parentId = ultima[0]?.id || null;
  } else {
    const nueva = requireResult(await database.from(CONVERSACIONES_TABLE)
      .insert({ asked_by: profile.id, title: tituloDeConversacion(question), created_at: now.toISOString(), last_message_at: now.toISOString() })
      .select('id').single());
    conversationId = nueva.id;
  }
  const inserted = await database.from(PREGUNTAS_TABLE)
    .insert({ asked_by: profile.id, question, parent_id: parentId, conversation_id: conversationId, status: 'pendiente', requested_at: now.toISOString() })
    .select(COLUMNAS_PREGUNTA).single();
  const fila = requireResult(inserted);
  await database.from(CONVERSACIONES_TABLE).update({ last_message_at: now.toISOString() }).eq('id', conversationId);
  return fila;
}

/** Las conversaciones de ESTE perfil, la más reciente primero, con cuántos mensajes tiene cada una. */
export async function listConversations(database, profile, now = new Date()) {
  if (!profile?.id) throw fail('Inicie sesión.', 401);
  await expirarAbandonadas(database, now);
  const conversaciones = requireResult(await database.from(CONVERSACIONES_TABLE).select('id,title,created_at,last_message_at')
    .eq('asked_by', profile.id).order('last_message_at', { ascending: false }).limit(CONVERSACIONES_VISIBLES)) || [];
  const ids = conversaciones.map(c => c.id);
  const mensajes = ids.length ? requireResult(await database.from(PREGUNTAS_TABLE).select('conversation_id,status')
    .eq('asked_by', profile.id).in('conversation_id', ids)) || [] : [];
  const cuenta = new Map();
  const enCurso = new Set();
  for (const m of mensajes) {
    cuenta.set(m.conversation_id, (cuenta.get(m.conversation_id) || 0) + 1);
    if (m.status === 'pendiente' || m.status === 'leyendo') enCurso.add(m.conversation_id);
  }
  return {
    conversaciones: conversaciones.map(c => ({ ...c, mensajes: cuenta.get(c.id) || 0, en_curso: enCurso.has(c.id) })),
    puede_ver_aprendizaje: esAdministrador(profile),
    mensajes_larga: MENSAJES_LARGA,
  };
}

/** Una conversación de ESTE perfil con todos sus mensajes, en orden. */
export async function loadConversation(database, profile, id, now = new Date()) {
  if (!profile?.id) throw fail('Inicie sesión.', 401);
  await expirarAbandonadas(database, now);
  const conversacion = await conversacionPropia(database, profile, id);
  const mensajes = requireResult(await database.from(PREGUNTAS_TABLE).select(COLUMNAS_PREGUNTA)
    .eq('conversation_id', id).eq('asked_by', profile.id).order('requested_at', { ascending: true }).limit(200)) || [];
  return { conversacion, mensajes };
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
