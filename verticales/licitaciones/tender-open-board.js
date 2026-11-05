// AGT-002 — el tablero de procesos abiertos (mejora 4 del encargo de Juan, 2026-10-31: "barato y rinde").
//
// Cada expediente ya sabe lo suyo: qué pide el pliego (la matriz de cumplimiento) y si los documentos de la empresa
// llegan vigentes a SU cierre (el puente). Lo que nadie ve es el conjunto, y ahí estaban los dos casos que lo
// pidieron:
//
//   - un solo certificado del RUP servía para Terminal y Supersalud (uno lo exigía desde el 5-oct y el otro desde el
//     6). Lo notó una persona con los dos procesos en la cabeza; sin eso se compran dos;
//   - dos garantías de seriedad por casi $2.800 millones con 19 horas de diferencia, de la misma aseguradora. Ese no es
//     un dato de un proceso: es del conjunto, y decide si se pueden presentar los dos.
//
// El tablero contesta tres preguntas, y sólo cruza lo que ya existe:
//
//   1. qué trámite sirve para cuántas licitaciones (`tramites`);
//   2. qué documento vence antes de qué cierre (`vencimientos`);
//   3. qué hay que pedir una vez por proceso, aunque sea lo mismo (`por_proceso`: hoy, la garantía de seriedad).
//
// Lo que NO hace: no lee la antigüedad máxima que cada pliego exige (eso está en prosa en el texto del requisito, y
// se muestra tal cual), no suma montos que no estén escritos como cifra y no decide nada. Módulo puro.

import { TENDER_COMPANY_DOCUMENT_CLASSES, TENDER_COMPANY_DOCUMENT_KINDS } from './tender-company-document-bridge.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOT_READY = new Set(['sin_archivo', 'vencido', 'vence_antes_del_cierre', 'vigencia_por_confirmar']);
const EXPIRING = new Set(['vencido', 'vence_antes_del_cierre']);
const CLASS_BY_KEY = new Map(TENDER_COMPANY_DOCUMENT_CLASSES.map(entry => [entry.key, entry]));
// Cierres a esta distancia o menos se tratan como simultáneos: lo que se pide por proceso hay que pedirlo junto.
export const TENDER_OPEN_BOARD_CLUSTER_DAYS = 3;

const SERIOUSNESS_TEXT = /garant[ií]a de seriedad|p[oó]liza de seriedad|seriedad de la oferta/i;
const MONEY_TEXT = /\$\s?\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?|\$\s?\d+(?:,\d+)?\s*(?:millones|mil millones)/i;
const PERCENT_TEXT = /\d+(?:[.,]\d+)?\s?%/;

const day = value => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);
const dayTime = value => (day(value) ? Date.parse(`${day(value)}T00:00:00Z`) : null);
const label = process => process.ref || process.entity || process.opportunity_id;

/** Las claves de documento corporativo que ESTE proceso pide, según la matriz (lo que no aplica no cuenta). */
function requiredClasses(process) {
  const keys = new Set();
  for (const row of process.matrix?.rows || []) {
    if (row.status === 'no_aplica') continue;
    for (const support of row.company_support || []) keys.add(support.key);
  }
  return keys;
}

function processRef(process) {
  return { opportunity_id: process.opportunity_id, ref: label(process), entity: process.entity || null, close_date: day(process.close_date) };
}

/** 1. Un trámite, cuántas licitaciones. Sólo los que hay que hacer en al menos una; en orden de urgencia. */
function buildTramites(processes) {
  const byKey = new Map();
  for (const process of processes) {
    const bridgeRows = new Map((process.bridge?.rows || []).map(row => [row.key, row]));
    for (const key of requiredClasses(process)) {
      const entry = CLASS_BY_KEY.get(key);
      if (!entry || entry.kind === 'hecho_inscrito') continue;
      const row = bridgeRows.get(key);
      if (!byKey.has(key)) byKey.set(key, { entry, row, processes: [] });
      byKey.get(key).processes.push({ ...processRef(process), state: row?.state || null, age_at_close_days: row?.age_at_close_days ?? null });
    }
  }
  return [...byKey.values()]
    .filter(group => group.processes.some(item => NOT_READY.has(item.state)))
    .map(({ entry, row, processes: list }) => {
      const sorted = [...list].sort((a, b) => String(a.close_date || '9').localeCompare(String(b.close_date || '9')));
      const pending = sorted.filter(item => NOT_READY.has(item.state));
      const first = pending[0]?.close_date || null;
      const names = sorted.map(item => item.ref).join(', ');
      return {
        key: entry.key,
        label: entry.label,
        owner: entry.owner,
        kind: entry.kind,
        kind_label: TENDER_COMPANY_DOCUMENT_KINDS[entry.kind],
        document_name: row?.document?.display_name || null,
        issued_at: row?.document?.issued_at || null,
        expires_at: row?.expires_at || null,
        processes: sorted,
        pending_count: pending.length,
        first_close: first,
        // Un documento del catálogo es de la empresa, no del proceso: lo que se tramita una vez sirve para todos.
        note: sorted.length > 1
          ? `Un solo trámite sirve para ${sorted.length} licitaciones (${names}). Tenerlo antes del ${first || 'primer cierre'} y revisar contra cada pliego la antigüedad que exige.`
          : `Lo pide ${names}. Tenerlo antes del ${first || 'cierre'}.`,
      };
    })
    .sort((a, b) => String(a.first_close || '9').localeCompare(String(b.first_close || '9')) || b.processes.length - a.processes.length);
}

/** 2. Qué vence antes de qué cierre: un renglón por documento, con todos los cierres que no alcanza. */
function buildVencimientos(processes) {
  const byKey = new Map();
  for (const process of processes) {
    const required = requiredClasses(process);
    for (const row of process.bridge?.rows || []) {
      if (!EXPIRING.has(row.state)) continue;
      // Con matriz, sólo lo que el pliego pide; sin análisis todavía, todo lo del catálogo (mejor de más que callado).
      if (process.matrix && !required.has(row.key)) continue;
      if (!byKey.has(row.key)) byKey.set(row.key, { row, processes: [] });
      byKey.get(row.key).processes.push({ ...processRef(process), state: row.state });
    }
  }
  return [...byKey.values()].map(({ row, processes: list }) => {
    const sorted = [...list].sort((a, b) => String(a.close_date || '9').localeCompare(String(b.close_date || '9')));
    const already = row.state === 'vencido' || sorted.every(item => item.state === 'vencido');
    return {
      key: row.key,
      label: row.label,
      owner: row.owner,
      kind: row.kind,
      expires_at: row.expires_at || null,
      already_expired: already,
      processes: sorted,
      note: already
        ? `${row.label}: ya vencido${row.expires_at ? ` (${row.expires_at})` : ''}. No sirve para ${sorted.map(item => item.ref).join(', ')}.`
        : `${row.label}: vence el ${row.expires_at}, antes del cierre de ${sorted.map(item => `${item.ref} (${item.close_date})`).join(', ')}.`,
    };
  }).sort((a, b) => String(a.expires_at || '').localeCompare(String(b.expires_at || '')));
}

/** 3. Lo que se pide una vez por proceso: hoy, la garantía de seriedad. Agrupa los cierres casi simultáneos. */
function buildPorProceso(processes) {
  const items = [];
  for (const process of processes) {
    for (const row of process.matrix?.rows || []) {
      if (row.status === 'no_aplica') continue;
      const text = `${row.title || ''} ${row.demand || ''}`;
      if (!SERIOUSNESS_TEXT.test(text)) continue;
      items.push({
        ...processRef(process),
        requirement_key: row.key,
        title: row.title,
        demand: row.demand || null,
        amount_text: (row.demand || '').match(MONEY_TEXT)?.[0] || null,
        percent_text: (row.demand || '').match(PERCENT_TEXT)?.[0] || null,
        status: row.status,
      });
      break; // una por proceso: si el análisis la parte en varias filas, la primera la nombra
    }
  }
  items.sort((a, b) => String(a.close_date || '9').localeCompare(String(b.close_date || '9')));
  const clusters = [];
  for (const item of items) {
    const last = clusters[clusters.length - 1];
    const time = dayTime(item.close_date);
    const lastTime = last ? dayTime(last.items[last.items.length - 1].close_date) : null;
    if (last && time !== null && lastTime !== null && (time - lastTime) / DAY_MS <= TENDER_OPEN_BOARD_CLUSTER_DAYS) last.items.push(item);
    else clusters.push({ items: [item] });
  }
  return {
    kind: 'garantia_de_seriedad',
    label: 'Garantía de seriedad de la oferta',
    items,
    clusters: clusters.filter(cluster => cluster.items.length > 1).map(cluster => {
      const span = (dayTime(cluster.items[cluster.items.length - 1].close_date) - dayTime(cluster.items[0].close_date)) / DAY_MS;
      return {
        processes: cluster.items.map(item => item.ref),
        span_days: span,
        note: `${cluster.items.length} garantías de seriedad para cierres ${span === 0 ? 'el mismo día' : `con ${span} ${span === 1 ? 'día' : 'días'} de diferencia`} (${cluster.items.map(item => `${item.ref}${item.amount_text ? `: ${item.amount_text}` : ''}`).join('; ')}). Son una por proceso y no se comparten: pedirlas juntas a la aseguradora y confirmar que el cupo alcanza para todas.`,
      };
    }),
  };
}

/**
 * El tablero. `processes` son los procesos abiertos, cada uno con su `bridge` (buildTenderCompanyDocumentBridge con su
 * cierre) y su `matrix` (buildTenderComplianceMatrix, o null si aún no hay análisis terminado).
 */
export function buildTenderOpenBoard({ processes = [] } = {}) {
  const list = [...(processes || [])].sort((a, b) => String(day(a.close_date) || '9').localeCompare(String(day(b.close_date) || '9')));
  const tramites = buildTramites(list);
  const vencimientos = buildVencimientos(list);
  const porProceso = buildPorProceso(list);
  return {
    processes: list.map(process => ({
      ...processRef(process),
      offer_status: process.offer_status || null,
      has_analysis: Boolean(process.matrix),
      required_company_documents: requiredClasses(process).size,
      // Mejora 1: vencidos del expediente por consecuencia (null si no se pudo leer).
      vencidos: process.vencidos || null,
    })),
    tramites,
    vencimientos,
    por_proceso: porProceso,
    summary: {
      procesos: list.length,
      sin_analisis: list.filter(process => !process.matrix).length,
      tramites_compartidos: tramites.filter(item => item.processes.length > 1).length,
      tramites_por_hacer: tramites.length,
      documentos_que_vencen: vencimientos.length,
      garantias_simultaneas: porProceso.clusters.length,
      vencidos_que_tumban: list.reduce((total, process) => total + (process.vencidos?.vencidos_que_tumban || 0), 0),
      no_subsanables_abiertos: list.reduce((total, process) => total + (process.vencidos?.no_subsanables_abiertos || 0), 0),
    },
  };
}
