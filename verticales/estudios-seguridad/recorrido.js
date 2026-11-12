// Estudios de Seguridad Física: respuestas del recorrido guiado y lo que proponen (migración 214; Juan, 2026-11-12).
//
// Cada respuesta desfavorable de la lista de verificación es una VULNERABILIDAD (causa del riesgo) con su CONTRAMEDIDA
// (control propuesto); cada favorable, un CONTROL EXISTENTE. Los escenarios "¿qué pasaría si…?" quedan como análisis.
// Con eso se propone, por riesgo de la lista base, lo que el analista puede llevar al estudio. No se califica nada:
// probabilidad, impacto y controles los califica el analista (y la probabilidad tiene su sugerencia con datos).
import { AREAS, QUESTIONS, QUESTIONNAIRE_VERSION, questionByCode } from './preguntas.js';

const ANSWERS = 'psi_security_study_answers';
const VALUES = new Set(['si', 'no', 'na']);
const missingTable = error => error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message || ''));
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export async function loadAnswers(db, studyId) {
  const { data, error } = await db.from(ANSWERS).select('question_code, value, note, answered_at').eq('study_id', studyId);
  if (missingTable(error)) return null;
  if (error) throw error;
  return data || [];
}

/** Guarda o borra una respuesta. La ruta comprueba que el estudio sea editable. */
export async function saveAnswer(db, studyId, code, body = {}, profile, now = new Date()) {
  const question = questionByCode(code);
  if (!question) throw fail('Esa pregunta no existe.', 404);
  const note = typeof body.note === 'string' ? body.note.replace(/\s+/g, ' ').trim().slice(0, 2000) : '';
  const value = body.value === undefined || body.value === null || body.value === '' ? null : body.value;
  if (value !== null && (question.tipo !== 'verificacion' || !VALUES.has(value))) throw fail('Respuesta: sí, no o no aplica.');
  if (value === null && note.length < 3) {
    // Sin respuesta ni análisis: se borra (desmarcar).
    const { error } = await db.from(ANSWERS).delete().eq('study_id', studyId).eq('question_code', code);
    if (error) throw error;
    return { deleted: true };
  }
  if (question.tipo === 'escenario' && note.length < 3) throw fail('Escriba el análisis del escenario.');
  const row = { study_id: studyId, question_code: code, value, note: note || null, answered_by: profile.id, answered_at: now.toISOString() };
  const { data, error } = await db.from(ANSWERS).upsert(row, { onConflict: 'study_id,question_code' }).select('question_code, value, note, answered_at').single();
  if (error) throw error;
  return data;
}

const numbered = items => (items.length > 1 ? items.map((item, index) => `${index + 1}. ${item}`).join('\n') : items[0] || null);

/**
 * Lo que proponen las respuestas, por riesgo de la lista base. `catalog`: la plantilla; `risks`: los riesgos que ya tiene
 * el estudio (para decir "ya está como R#").
 */
export function proposalsFromAnswers(answers, catalog, risks = []) {
  const byRisk = new Map();
  const entry = code => {
    if (!byRisk.has(code)) byRisk.set(code, { vulnerabilidades: [], controles: [], contramedidas: [], escenarios: [], preguntas: [] });
    return byRisk.get(code);
  };
  for (const answer of answers) {
    const question = questionByCode(answer.question_code);
    if (!question) continue;
    for (const code of question.riesgos) {
      const target = entry(code);
      if (question.tipo === 'escenario') {
        if (answer.note) { target.escenarios.push(`${question.texto} ${answer.note}`); target.preguntas.push(question.codigo); }
        continue;
      }
      if (answer.value === 'na') continue;
      const favorable = answer.value === question.favorable;
      if (favorable && question.control) target.controles.push(question.control);
      if (!favorable) {
        target.vulnerabilidades.push(answer.note ? `${question.vulnerabilidad} ${answer.note}` : question.vulnerabilidad);
        target.contramedidas.push(question.contramedida);
        target.preguntas.push(question.codigo);
      }
    }
  }
  const existing = new Map(risks.filter(risk => risk.catalog_risk_code).map(risk => [risk.catalog_risk_code, risk.number]));
  return (catalog?.riesgos || [])
    .filter(item => byRisk.has(item.codigo) && (byRisk.get(item.codigo).vulnerabilidades.length || byRisk.get(item.codigo).escenarios.length))
    .map(item => {
      const found = byRisk.get(item.codigo);
      return {
        codigo: item.codigo, nombre: item.nombre, categoria: item.categoria,
        vulnerabilidades: found.vulnerabilidades.length, preguntas: [...new Set(found.preguntas)],
        causas: numbered([...new Set(found.vulnerabilidades)]),
        control_existente: numbered([...new Set(found.controles)]),
        control_propuesto: numbered([...new Set(found.contramedidas)]),
        escenarios: found.escenarios,
        ya_en_estudio: existing.has(item.codigo) ? existing.get(item.codigo) : null,
      };
    })
    .sort((a, b) => b.vulnerabilidades - a.vulnerabilidades || a.codigo.localeCompare(b.codigo));
}

/** Lo que ve la ficha: preguntas por área con su respuesta, avance y propuestas. */
export function guidedView(answers, catalog, risks) {
  if (answers === null) return { available: false };
  const byCode = new Map(answers.map(answer => [answer.question_code, answer]));
  const areas = AREAS.map(area => {
    const questions = QUESTIONS.filter(question => question.area === area.codigo).map(question => ({
      codigo: question.codigo, tipo: question.tipo, texto: question.texto, favorable: question.favorable ?? null,
      respuesta: byCode.get(question.codigo)?.value ?? null, nota: byCode.get(question.codigo)?.note ?? null,
    }));
    return { ...area, preguntas: questions, respondidas: questions.filter(question => question.respuesta || question.nota).length };
  });
  const total = QUESTIONS.length;
  const respondidas = areas.reduce((sum, area) => sum + area.respondidas, 0);
  return { available: true, version: QUESTIONNAIRE_VERSION, total, respondidas, areas, propuestas: proposalsFromAnswers(answers, catalog, risks) };
}

/** Lo que se congela en la versión aprobada y va como anexo del informe: sólo lo respondido. */
export function answersSnapshot(answers) {
  if (!answers?.length) return null;
  const byCode = new Map(answers.map(answer => [answer.question_code, answer]));
  return {
    version: QUESTIONNAIRE_VERSION,
    respuestas: QUESTIONS.filter(question => byCode.has(question.codigo)).map(question => ({
      codigo: question.codigo, area: AREAS.find(area => area.codigo === question.area)?.nombre || question.area, tipo: question.tipo,
      pregunta: question.texto, respuesta: byCode.get(question.codigo).value, nota: byCode.get(question.codigo).note,
      favorable: question.tipo === 'verificacion' && byCode.get(question.codigo).value !== 'na' ? byCode.get(question.codigo).value === question.favorable : null,
    })),
  };
}
