// El valor y el cierre de la oportunidad, al día con lo que publicó la entidad (Juan, 2026-11-11: «automático y vamos
// adelante»).
//
// Por qué: el valor de la oportunidad se copia del presupuesto de SECOP al convertir el proceso y nadie lo vuelve a
// mirar. En Manizales LP-01-2026 el pliego definitivo del 10-nov bajó el presupuesto de $16.355.871.342 a
// $8.481.856.074 (y el plazo de 43,5 a 23,5 meses); el CRM siguió con el viejo y el resumen al equipo salió con la cifra
// vieja. Vig-IA lo notó, pero sólo como texto del análisis.
//
// Qué hace, en la revisión programada de licitaciones activas:
//   * Presupuesto: lo lee del TEXTO de los documentos de la entidad con una regla fija, sin modelo: la cifra entre
//     paréntesis que sigue a «presupuesto oficial» («… PESOS MCTE. ($8.481.856.074)»). Manda el documento más fuerte
//     (adenda > pliego definitivo > apertura > pliego > otro; nunca un proyecto) y, dentro de él, la cifra tiene que ser
//     una sola: si el documento trae dos distintas, no se toca nada y se avisa.
//   * Cierre: del cronograma confirmado que extrae el análisis (fecha de presentación de ofertas). Los cronogramas vienen
//     en formatos muy distintos según la entidad, y ése ya está normalizado y citado.
//   * Sólo se reemplaza un valor que sea una cifra oficial (la de SECOP o la de algún documento de la entidad): si la
//     oportunidad tiene otro valor, alguien lo puso a propósito y no se toca. Tampoco se toca una oferta ya presentada.
//   * Cada cambio deja su constancia en la oportunidad, con el documento de donde salió.

import { tenderSemanaDia } from './tender-semana.js';

const KEY = /presupuesto\s+oficial/gi;
// «($8.481.856.074)», «($26.238.136.487=)», «( $ 1.748.327.901 )». Al menos millones: tres grupos de cifras.
const MONEY = /\(\s*\$\s*(\d{1,3}(?:[.\s]\d{3}){2,})(?:,\d+)?\s*=?\s*\)/;
const WINDOW = 700;

/** Las cifras de presupuesto oficial que trae un texto, en orden de aparición. Pura. */
export function tenderBudgetFigures(text) {
  const value = String(text || '');
  const figures = [];
  for (const match of value.matchAll(KEY)) {
    const money = MONEY.exec(value.slice(match.index, match.index + WINDOW));
    if (money) figures.push(Number(money[1].replace(/[.\s]/g, '')));
  }
  return figures;
}

/** El presupuesto de un texto si es uno solo; null si no trae o si trae dos distintos. Pura. */
export function tenderBudgetOf(text) {
  const distinct = [...new Set(tenderBudgetFigures(text))];
  return distinct.length === 1 ? distinct[0] : null;
}

const fold = value => String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Qué tan fuerte es un documento para decir el presupuesto vigente. -1: no cuenta (un proyecto). Pura. */
export function tenderDocumentWeight(document) {
  const name = fold(document?.name);
  if (/proyecto/.test(name)) return -1;
  if (/adenda/.test(name)) return 4;
  // «Estudios Previos Definitivo» no es el pliego: sólo gana el pliego (o su complemento) definitivo.
  if (/definitiv/.test(name) && /pliego|complemento/.test(name)) return 3;
  if (/apertura/.test(name)) return 2;
  if (/pliego|complemento/.test(name) || document?.document_type === 'pliego') return 1;
  return 0;
}

/**
 * El presupuesto vigente según los documentos de la entidad: el del documento más fuerte (y, a igual fuerza, el más
 * reciente) que traiga una cifra. Si ese documento trae dos cifras distintas, `ambiguous` y sin valor. También devuelve
 * todas las cifras oficiales vistas, para saber si el valor de la oportunidad es una copia oficial. Pura.
 * `documents`: [{ name, document_type, created_at, extracted_text }], ya filtrados a los de la entidad.
 */
export function tenderOfficialBudget(documents) {
  const official = new Set();
  const ranked = [];
  for (const document of Array.isArray(documents) ? documents : []) {
    const figures = tenderBudgetFigures(document?.extracted_text);
    figures.forEach(figure => official.add(figure));
    const weight = tenderDocumentWeight(document);
    if (figures.length && weight >= 0) ranked.push({ document, weight, distinct: [...new Set(figures)] });
  }
  ranked.sort((a, b) => b.weight - a.weight || String(b.document.created_at || '').localeCompare(String(a.document.created_at || '')));
  const best = ranked[0];
  if (!best) return { value: null, ambiguous: false, document: null, official: [...official] };
  if (best.distinct.length !== 1) return { value: null, ambiguous: true, document: best.document, figures: best.distinct, official: [...official] };
  return { value: best.distinct[0], ambiguous: false, document: best.document, official: [...official] };
}

// Una fecha sin hora (medianoche) vale su fecha escrita; una hora real se lee en Bogotá (memoria del 2026-11-04: un
// cierre «00:00Z» corrido a Colombia caía un día antes).
const bogotaDate = value => tenderSemanaDia(value);

/** La fecha de cierre (día en Bogotá) del cronograma confirmado del análisis. Pura. */
export function tenderClosingDayFromDeadlines(deadlines) {
  const submissions = (Array.isArray(deadlines) ? deadlines : [])
    .filter(deadline => String(deadline?.kind || '').toUpperCase() === 'SUBMISSION' && deadline?.certainty === 'CONFIRMED')
    .map(deadline => bogotaDate(deadline.value))
    .filter(Boolean);
  const distinct = [...new Set(submissions)];
  return distinct.length === 1 ? distinct[0] : null;
}

const pesos = value => `$${Number(value).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;
const PRESENTED = new Set(['presentada', 'adjudicada', 'no_adjudicada', 'cerrada_no_go']);

/**
 * Lo que hay que cambiar en una oportunidad y las líneas de constancia. Pura: no lee ni escribe.
 * `opportunity`: { offer_value, expected_close_date, tender_offer_status }. `secopValue`: el valor que trajo SECOP.
 */
export function tenderOfficialValuesPlan({ opportunity, secopValue = null, documents, deadlines }) {
  const updates = {};
  const lines = [];
  if (PRESENTED.has(opportunity?.tender_offer_status)) return { updates, lines, skipped: 'oferta_presentada_o_cerrada' };
  const budget = tenderOfficialBudget(documents);
  const current = Number(opportunity?.offer_value || 0);
  if (budget.ambiguous) {
    lines.push(`Vig-IA, valor oficial: «${budget.document.name}» trae dos cifras distintas de presupuesto oficial (${budget.figures.map(pesos).join(' y ')}); el valor de la oportunidad no se cambió. Revisar cuál rige.`);
  } else if (budget.value && budget.value !== current) {
    const officialCopy = !current || current === Number(secopValue || 0) || budget.official.includes(current);
    if (officialCopy) {
      updates.offer_value = budget.value;
      lines.push(`Vig-IA, valor oficial: el valor de la oportunidad pasó de ${current ? pesos(current) : 'vacío'} a ${pesos(budget.value)}, el presupuesto oficial de «${budget.document.name}».`);
    } else {
      lines.push(`Vig-IA, valor oficial: «${budget.document.name}» dice que el presupuesto oficial es ${pesos(budget.value)}; la oportunidad tiene ${pesos(current)}, que no es una cifra oficial, así que no se cambió. Revisar si es a propósito.`);
    }
  }
  const closing = tenderClosingDayFromDeadlines(deadlines);
  if (closing && closing !== String(opportunity?.expected_close_date || '').slice(0, 10)) {
    updates.expected_close_date = closing;
    lines.push(`Vig-IA, cierre: la fecha de cierre de la oportunidad pasó de ${opportunity?.expected_close_date || 'vacía'} a ${closing}, según el cronograma confirmado del análisis.`);
  }
  return { updates, lines };
}

/**
 * Revisión programada: por cada licitación convertida y activa, pone el valor y el cierre de la oportunidad al día con
 * los documentos de la entidad. Cada licitación falla por separado. Escribe sólo `offer_value` y `expected_close_date`
 * de la oportunidad, y la constancia con `appendLine` (línea que no se duplica).
 */
export async function runTenderOfficialValuesReview(database, {
  log = () => {}, inactiveReason, appendLine, isEntityDocument = () => true, limit = 50,
} = {}) {
  const events = [];
  const { data: tenders, error } = await database
    .from('psi_public_tenders')
    .select('id,ref,value,converted_opportunity_id,internal_status')
    .eq('internal_status', 'convertida_oportunidad')
    .limit(limit);
  if (error) {
    log({ event: 'tender_official_values_unavailable', message: String(error.message || error).slice(0, 200) });
    return events;
  }
  for (const tender of tenders || []) {
    const opportunityId = tender?.converted_opportunity_id;
    if (!opportunityId) continue;
    try {
      if (inactiveReason && await inactiveReason(database, opportunityId, tender.id)) continue;
      const { data: opportunity } = await database.from('psi_sales_opportunities')
        .select('id,offer_value,expected_close_date,tender_offer_status').eq('id', opportunityId).maybeSingle();
      if (!opportunity) continue;
      const { data: documents } = await database.from('psi_tender_document_versions')
        .select('name,document_type,created_at,source,origin,extracted_text').eq('opportunity_id', opportunityId).eq('current', true);
      const { data: runs } = await database.from('psi_tender_analysis_runs')
        .select('result').eq('opportunity_id', opportunityId).eq('canonical', true).limit(1);
      const plan = tenderOfficialValuesPlan({
        opportunity, secopValue: tender.value,
        documents: (documents || []).filter(isEntityDocument),
        deadlines: runs?.[0]?.result?.meta?.process_deadlines,
      });
      if (Object.keys(plan.updates).length) {
        const { error: updateError } = await database.from('psi_sales_opportunities').update(plan.updates).eq('id', opportunityId);
        if (updateError) throw new Error(updateError.message || 'no se pudo actualizar la oportunidad');
      }
      for (const line of plan.lines) if (appendLine) await appendLine(database, opportunityId, line);
      events.push({ event: Object.keys(plan.updates).length ? 'tender_official_values_updated' : 'tender_official_values_ok', opportunityId, ref: tender.ref || null, updates: plan.updates, notes: plan.lines.length, skipped: plan.skipped || null });
    } catch (cause) {
      events.push({ event: 'tender_official_values_failed', opportunityId, message: String(cause?.message || cause).slice(0, 200) });
    }
  }
  for (const event of events) log(event);
  return events;
}
