// Estudios de Seguridad Física, tramo 9 (primera parte): el revisor de inconsistencias (Juan, 2026-11-06: "vamos con el 9").
//
// Reglas fijas, sin modelo: señala lo que en los estudios reales se coló sin que nadie lo viera (§2.3 del plan) —un
// riesgo alto sin plan, calificaciones copiadas de un riesgo a otro, el nombre de otro cliente pegado en los textos, un
// residual que no baja, un riesgo alto sin foto, controles descritos sin calificar o calificados sin describir, causas
// con el número repetido—. Sólo LEE: no cambia estados, calificaciones ni textos. Quien revisa decide.
import { readinessIssues } from './flujo.js';

const HIGH_LEVELS = new Set(['alto', 'critico', 'inaceptable']);
const LEVEL_WORD = { alto: 'alto', critico: 'crítico', inaceptable: 'inaceptable' };
// Sufijos societarios que no distinguen a un cliente de otro.
const LEGAL_SUFFIXES = /\b(s ?a ?s|s ?a|ltda|limitada|e ?s ?p|s en c|y cia|cia|sociedad anonima|sucursal colombia|bic)\b/g;
const MIN_NAME = 4;
const SAME_RATINGS_MIN = 3;

export function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function clientCore(name) {
  return normalizeText(name).replace(LEGAL_SUFFIXES, ' ').replace(/\s+/g, ' ').trim();
}

// Las fechas llegan como texto desde supabase-js y como Date desde otros lectores.
const isoDay = value => (value instanceof Date ? value.toISOString().slice(0, 10) : value ? String(value).slice(0, 10) : null);
const riskCode = risk => `R${risk.number}`;
const list = codes => (codes.length > 1 ? `${codes.slice(0, -1).join(', ')} y ${codes.at(-1)}` : codes[0]);
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const rated = (risk, prefix) => risk[`${prefix}_quality`] != null && risk[`${prefix}_efficacy`] != null && risk[`${prefix}_efficiency`] != null;

// Los textos del estudio donde se puede colar algo de otro estudio, con el lugar donde está cada uno.
function studyTexts(detail) {
  const { study } = detail;
  const texts = [
    ['el título', study.title], ['el alcance', study.scope], ['la descripción del cliente', study.client_description],
    ['la ubicación', study.location_description], ['el contexto externo', study.external_context],
    ['los grupos delincuenciales', study.criminal_groups], ['el contexto interno', study.internal_context],
  ];
  for (const zone of detail.zones || []) texts.push([`la zona ${zone.name}`, `${zone.name || ''} ${zone.description || ''}`]);
  for (const risk of detail.risks || []) {
    texts.push([riskCode(risk), [risk.title, risk.causes, risk.consequences, risk.current_control, risk.proposed_control].filter(Boolean).join(' ')]);
  }
  const numberOf = new Map((detail.risks || []).map(risk => [risk.id, riskCode(risk)]));
  for (const action of detail.actions || []) texts.push([`una acción de ${numberOf.get(action.risk_id) || 'un riesgo'}`, action.description]);
  for (const item of detail.evidence || []) if (item.caption) texts.push([`la leyenda de ${item.file_name}`, item.caption]);
  return texts.filter(([, value]) => hasText(value)).map(([where, value]) => [where, ` ${normalizeText(value)} `]);
}

function otherClientFindings(detail, otherClients) {
  const own = clientCore(detail.study.client_name);
  const cores = new Map();
  for (const name of otherClients) {
    const core = clientCore(name);
    // Por palabras completas: "Hada" no es otro cliente dentro de "Hada Internacional", ni al revés.
    if (core.length < MIN_NAME || ` ${own} `.includes(` ${core} `) || (own.length >= MIN_NAME && ` ${core} `.includes(` ${own} `))) continue;
    if (!cores.has(core)) cores.set(core, name);
  }
  if (!cores.size) return [];
  const findings = [];
  const texts = studyTexts(detail);
  for (const [core, name] of cores) {
    const places = texts.filter(([, value]) => value.includes(` ${core} `)).map(([where]) => where);
    if (places.length) {
      findings.push({ code: 'otro_cliente', severity: 'revisar', message: `Aparece el nombre de otro cliente («${name}») en ${list([...new Set(places)])}. ¿Se copió de otro estudio?` });
    }
  }
  return findings;
}

function sameRatingFindings(risks) {
  const groups = new Map();
  for (const risk of risks) {
    if (!rated(risk, 'current')) continue;
    const key = ['probability', 'impact_company', 'impact_people', 'current_quality', 'current_efficacy', 'current_efficiency', 'proposed_quality', 'proposed_efficacy', 'proposed_efficiency'].map(field => risk[field] ?? '-').join('|');
    groups.set(key, [...(groups.get(key) || []), risk]);
  }
  return [...groups.values()].filter(group => group.length >= SAME_RATINGS_MIN).map(group => ({
    code: 'calificaciones_identicas', severity: 'revisar',
    message: `${list(group.map(riskCode))} tienen exactamente las mismas calificaciones (probabilidad, impactos y controles). ¿Se valoró cada uno o se copiaron?`,
  }));
}

function causeFindings(risk) {
  if (!hasText(risk.causes)) return [];
  const lines = risk.causes.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const numbers = lines.map(line => line.match(/^(\d{1,2})[.)-]\s/)?.[1]).filter(Boolean);
  const repeatedNumbers = [...new Set(numbers.filter((value, index) => numbers.indexOf(value) !== index))];
  const bodies = lines.map(line => normalizeText(line.replace(/^\d{1,2}[.)-]\s*/, ''))).filter(Boolean);
  const repeatedText = bodies.some((value, index) => bodies.indexOf(value) !== index);
  const findings = [];
  if (repeatedNumbers.length) findings.push({ code: 'causas_numeracion', severity: 'revisar', risk: risk.number, message: `${riskCode(risk)}: hay dos causas con el número ${list(repeatedNumbers)}.` });
  if (repeatedText) findings.push({ code: 'causas_repetidas', severity: 'revisar', risk: risk.number, message: `${riskCode(risk)}: una causa está escrita dos veces.` });
  return findings;
}

function riskFindings(detail) {
  const findings = [];
  const photos = new Set((detail.evidence || []).filter(item => item.kind === 'foto' && item.risk_id).map(item => item.risk_id));
  const titles = new Map();
  for (const risk of detail.risks || []) {
    const { actual, residual } = risk.valuation;
    const code = riskCode(risk);
    if (HIGH_LEVELS.has(actual.nivel)) {
      if (!rated(risk, 'proposed') && !hasText(risk.proposed_control)) {
        findings.push({ code: 'sin_control_propuesto', severity: 'revisar', risk: risk.number, message: `${code} está en nivel ${LEVEL_WORD[actual.nivel]} y no tiene control propuesto: el residual queda igual al actual.` });
      } else if (residual.escogida === false) {
        // Guía de calificación: la probabilidad residual la escoge el analista; sin ella, el residual es el actual.
        findings.push({ code: 'sin_probabilidad_residual', severity: 'revisar', risk: risk.number, message: `${code} está en nivel ${LEVEL_WORD[actual.nivel]} y no tiene probabilidad residual: el residual queda igual al actual.` });
      } else if (residual.magnitud >= actual.magnitud) {
        findings.push({ code: 'residual_no_baja', severity: 'revisar', risk: risk.number, message: `${code} está en nivel ${LEVEL_WORD[actual.nivel]} y el control propuesto no lo baja (sigue en ${residual.magnitud}).` });
      }
      if (detail.evidence_available !== false && !photos.has(risk.id)) {
        findings.push({ code: 'sin_foto', severity: 'revisar', risk: risk.number, message: `${code} está en nivel ${LEVEL_WORD[actual.nivel]} y no tiene ninguna foto que lo respalde.` });
      }
    }
    // IEC 31010: el juicio experto se contrasta con datos y declara su incertidumbre.
    if (HIGH_LEVELS.has(actual.nivel) && risk.valuation.metodologia === 'guia-calificacion-2026') {
      if (risk.suggested_probability == null) findings.push({ code: 'juicio_sin_dato', severity: 'revisar', risk: risk.number, message: `${code} está en nivel ${LEVEL_WORD[actual.nivel]} y su probabilidad no tiene dato de respaldo (ni estadística de la zona ni SecurityOps): es juicio del analista.` });
      if (risk.confidence === 'baja') findings.push({ code: 'confianza_baja', severity: 'revisar', risk: risk.number, message: `${code} está en nivel ${LEVEL_WORD[actual.nivel]} y el analista declaró confianza baja: conviene una segunda opinión.` });
    }
    for (const [prefix, word] of [['current', 'existente'], ['proposed', 'propuesto']]) {
      const described = hasText(risk[`${prefix}_control`]);
      if (described && !rated(risk, prefix)) findings.push({ code: 'control_sin_calificar', severity: 'revisar', risk: risk.number, message: `${code}: el control ${word} está descrito pero no calificado, así que no cuenta en la valoración.` });
      if (!described && rated(risk, prefix)) findings.push({ code: 'calificacion_sin_control', severity: 'revisar', risk: risk.number, message: `${code}: el control ${word} está calificado pero no dice cuál es.` });
    }
    if (rated(risk, 'current') && rated(risk, 'proposed') && residual.efectividadControl < actual.efectividadControl) {
      findings.push({ code: 'propuesto_mas_debil', severity: 'revisar', risk: risk.number, message: `${code}: el control propuesto califica peor que el existente.` });
    }
    findings.push(...causeFindings(risk));
    const title = normalizeText(risk.title);
    titles.set(title, [...(titles.get(title) || []), code]);
  }
  for (const codes of titles.values()) {
    if (codes.length > 1) findings.push({ code: 'riesgo_repetido', severity: 'revisar', message: `${list(codes)} tienen el mismo nombre.` });
  }
  return findings;
}

function actionFindings(detail) {
  const visit = isoDay(detail.study.visit_date);
  if (!visit) return [];
  const numberOf = new Map((detail.risks || []).map(risk => [risk.id, riskCode(risk)]));
  return (detail.actions || [])
    .filter(action => action.due_date && action.status !== 'descartada' && isoDay(action.due_date) < visit)
    .map(action => ({ code: 'fecha_accion', severity: 'revisar', message: `Una acción de ${numberOf.get(action.risk_id) || 'un riesgo'} vence (${isoDay(action.due_date)}) antes de la visita (${visit}).` }));
}

// Puro: recibe el detalle de getStudy y los nombres de los otros clientes con estudio.
export function consistencyFindings(detail, { otherClients = [] } = {}) {
  const blocking = readinessIssues(detail).map(message => ({ code: 'incompleto', severity: 'bloquea', message }));
  return [
    ...blocking,
    ...otherClientFindings(detail, otherClients),
    ...sameRatingFindings(detail.risks || []),
    ...riskFindings(detail),
    ...actionFindings(detail),
  ];
}

// Lee los nombres de los otros clientes con estudio; sólo SELECT.
export async function reviewStudy(db, detail) {
  const { data, error } = await db.from('psi_security_studies').select('client_name, client_ref');
  if (error) throw error;
  const otherClients = (data || []).filter(row => row.client_ref !== detail.study.client_ref).map(row => row.client_name);
  const findings = consistencyFindings(detail, { otherClients });
  return { findings, blocking: findings.filter(item => item.severity === 'bloquea').length, total: findings.length };
}
