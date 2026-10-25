// AGT-002 — punto 4 de la definición de Juan (2026-10-21): si la aclaración es de la empresa, Vig-IA propone
// guardarla en la ficha de la empresa. Lo que es de la empresa sirve para toda licitación ("el contrato 70 de
// Tiendas Ara está en el RUP", "en Medellín tenemos agencia"); lo que es de este proceso se queda en él ("vamos
// a enviar observaciones al numeral 4.3.1"). Vig-IA sólo propone: la escritura en la ficha la autoriza la persona.
//
// Funciones puras, sin dependencias: las usan el servidor y la pantalla.

// Temas de la ficha de la empresa. El tema se informa para que la persona sepa dónde va a quedar el dato.
const TOPICS = Object.freeze([
  { topic: 'sedes', label: 'sedes y agencias', pattern: /\b(sedes?|agencias?|sucursal(?:es)?|domicilio|oficinas?)\b/i },
  { topic: 'rup', label: 'RUP y códigos', pattern: /\b(rup|unspsc|c[oó]digos?)\b/i },
  { topic: 'experiencia', label: 'experiencia acreditada', pattern: /\b(experiencia|contratos?|smmlv|smlmv)\b/i },
  { topic: 'licencias', label: 'licencias y permisos', pattern: /\b(licencias?|supervigilancia|permisos?|resoluci[oó]n|dijin|armas|uniformes)\b/i },
  { topic: 'financiero', label: 'capacidad financiera', pattern: /\b(indicadores?|liquidez|endeudamiento|patrimonio|financier[oa]s?|balance)\b/i },
  { topic: 'personal', label: 'personal', pattern: /\b(coordinador(?:es)?|supervisor(?:es)?|personal|planta|empleados|vigilantes)\b/i },
  { topic: 'polizas', label: 'pólizas y seguros', pattern: /\b(p[oó]lizas?|aseguradora|cupo|rce)\b/i },
]);
// Habla de la empresa, en primera persona o nombrándola: eso es lo que convierte un tema en un dato de la ficha.
const COMPANY_VOICE = /\b(tenemos|ten[ií]amos|contamos con|somos|cubrimos|nuestr[oa]s?|la empresa (?:tiene|cuenta|es|ya|no)|seguridad nacional|est[áa] (?:en el|inscrit[oa])|ya cubre)\b/i;
// Lo que pertenece a ESTA licitación: una observación que se va a radicar, el pliego, la entidad o una adenda.
const TENDER_ONLY = /(vamos a (?:enviar|pasar|presentar|radicar|solicitar)|observaci[oó]n(?:es)?\s*:|\bel pliego\b|\bla entidad\b|\badenda\b|\bnumeral\b)/i;

const LINE_MAX = 600;
const squash = value => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Día en texto corto para la ficha: la fecha de la aclaración, sin hora. */
function shortDay(value) {
  const text = squash(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : text.slice(0, 40);
}

/**
 * La línea que se propone agregar a la ficha: el dato tal como lo escribió la persona, con de dónde salió.
 * La procedencia va siempre, porque en la ficha un dato sin autor ni fecha no se puede verificar después.
 */
export function agt002CompanyClarificationLine(clarification, { tenderLabel = '' } = {}) {
  const content = squash(clarification?.content ?? clarification?.aclaracion);
  if (!content) return '';
  const autor = squash(clarification?.author_name ?? clarification?.autor) || 'Encargado de la licitación';
  const fecha = shortDay(clarification?.created_at ?? clarification?.fecha);
  const punto = squash(clarification?.target_label ?? clarification?.punto);
  const origen = [
    `aclaración de ${autor}`,
    fecha ? `del ${fecha}` : '',
    squash(tenderLabel) ? `en ${squash(tenderLabel)}` : '',
    punto ? `sobre «${punto}»` : '',
  ].filter(Boolean).join(' ');
  const line = `${content} (${origen}).`;
  return line.length <= LINE_MAX ? line : `${line.slice(0, LINE_MAX - 1).trimEnd()}…`;
}

/**
 * ¿Esta aclaración es un dato de la empresa que sirve para toda licitación? Devuelve la propuesta, nunca una
 * escritura: `{ company, topic, topicLabel, reason, line }`. Es una heurística deliberadamente conservadora —
 * ante la duda no propone— y quien decide es la persona.
 */
export function agt002CompanyClarificationSuggestion(clarification, { tenderLabel = '' } = {}) {
  const content = squash(clarification?.content ?? clarification?.aclaracion);
  const none = { company: false, topic: null, topicLabel: null, reason: '', line: '' };
  if (!content) return none;
  if (TENDER_ONLY.test(content)) {
    return { ...none, reason: 'Habla de este proceso: una observación, el pliego, la entidad o una adenda.' };
  }
  const match = TOPICS.find(item => item.pattern.test(content));
  if (!match) return { ...none, reason: 'No menciona ningún dato de la ficha de la empresa.' };
  if (!COMPANY_VOICE.test(content)) {
    return { ...none, topic: match.topic, topicLabel: match.label, reason: 'Menciona el tema, pero no afirma nada sobre la empresa.' };
  }
  return {
    company: true,
    topic: match.topic,
    topicLabel: match.label,
    reason: `Afirma algo de la empresa sobre ${match.label}: sirve para toda licitación, no sólo para esta.`,
    line: agt002CompanyClarificationLine(clarification, { tenderLabel }),
  };
}

export { LINE_MAX as AGT002_COMPANY_CLARIFICATION_LINE_MAX };
