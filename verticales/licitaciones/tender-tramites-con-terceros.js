// Mejora 3 (encargo desde Terminal, 2026-11-04): los trámites que dependen de un tercero se separan desde el GO.
//
// En TT-SPO-07 el RUP nuevo, los certificados de Megabús y Matecaña, el de multas y sanciones de la SuperVigilancia y el
// de la Personería de Bogotá no salieron antes del cierre: todos tienen días de espera y se pidieron tarde. Al registrar
// el GO se crea una tarea por cada trámite con tercero que el proceso necesita y que no llega vigente al cierre, con el
// tercero, el responsable, la fecha límite para pedirlo y el tiempo típico de respuesta.
//
// Los tiempos son ESTIMADOS (criterio acordado con Juan, §8.3) y así se dicen: se ajustan con lo observado. Módulo puro.

import { TENDER_COMPANY_DOCUMENT_CLASSES } from './tender-company-document-bridge.js';

/** Quién expide cada documento de la empresa y cuántos días hábiles suele tardar (estimado). */
export const TRAMITES_CON_TERCEROS = Object.freeze({
  chamber_of_commerce: { tercero: 'la Cámara de Comercio', dias_habiles: 1 },
  rup: { tercero: 'la Cámara de Comercio (renovación o actualización del RUP y su firmeza)', dias_habiles: 10 },
  rut: { tercero: 'la DIAN', dias_habiles: 1 },
  corporate_background_checks: { tercero: 'la Procuraduría, la Contraloría y la Policía', dias_habiles: 1 },
  no_fines_sanctions_certificate: { tercero: 'la Superintendencia de Vigilancia y Seguridad Privada', dias_habiles: 10 },
  legal_representative_vault: { tercero: 'la Procuraduría, la Contraloría, la Policía y la Personería', dias_habiles: 3 },
  bank_certificate: { tercero: 'el banco', dias_habiles: 2 },
  rce_policy: { tercero: 'la aseguradora', dias_habiles: 5 },
  collective_life_policy: { tercero: 'la aseguradora', dias_habiles: 5 },
  authorized_weapons_list: { tercero: 'el Ministerio de Defensa (Control de Comercio de Armas)', dias_habiles: 10 },
});
// Lo que no es un documento de la empresa sino del proceso: sale de los requisitos del análisis.
const SERIEDAD = { key: 'garantia_seriedad', label: 'Garantía de seriedad de la oferta', owner: 'Financiero', tercero: 'la aseguradora', dias_habiles: 3 };
const EXPERIENCIA = { key: 'certificados_experiencia', label: 'Certificados de experiencia de los contratantes', owner: 'Licitaciones', tercero: 'cada contratante', dias_habiles: 15 };

export const TRAMITE_ITEM_KEY_PREFIX = 'agt002_req:tramite:';
const NOT_READY = new Set(['sin_archivo', 'vencido', 'vence_antes_del_cierre']);
const CLASS_BY_KEY = new Map(TENDER_COMPANY_DOCUMENT_CLASSES.map(entry => [entry.key, entry]));
const fold = value => String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** El último día para pedirlo: el cierre menos el tiempo típico (días hábiles a calendario) y un día de margen. */
export function fechaLimiteParaPedir(closeDate, diasHabiles, today) {
  const close = /^\d{4}-\d{2}-\d{2}/.test(String(closeDate || '')) ? String(closeDate).slice(0, 10) : null;
  if (!close) return { fecha: today || null, alcanza: null };
  const limite = addDays(close, -(Math.ceil(diasHabiles * 7 / 5) + 1));
  if (today && limite < today) return { fecha: today, alcanza: false };
  return { fecha: limite, alcanza: true };
}

function item({ key, label, owner, tercero, dias_habiles: dias, motivo }, closeDate, today) {
  const limite = fechaLimiteParaPedir(closeDate, dias, today);
  const lines = [
    `Qué hacer: pedirle a ${tercero} ${label.charAt(0).toLowerCase()}${label.slice(1)}.`,
    `Por qué: ${motivo}`,
    `Tiempo típico de respuesta: unos ${dias} ${dias === 1 ? 'día hábil' : 'días hábiles'} (estimado; se ajusta con lo observado).`,
    limite.alcanza === false
      ? 'Ya no alcanza el tiempo típico antes del cierre: pedirlo hoy y avisar a Juan si no llega.'
      : limite.fecha ? `Pedirlo a más tardar el ${limite.fecha} para que llegue antes del cierre.` : 'La licitación no tiene fecha de cierre: pedirlo cuanto antes.',
    `Responsable: ${owner}. Trámite con tercero creado al registrar el GO.`,
  ];
  return {
    item_key: `${TRAMITE_ITEM_KEY_PREFIX}${key}`.slice(0, 200),
    title: `${owner} · Trámite con tercero: ${label}`.slice(0, 400),
    required: true,
    target_date: limite.fecha,
    instruction: lines.join('\n').slice(0, 4000),
  };
}

/**
 * Las tareas de trámite con tercero para ESTE proceso. `matrix` dice qué documentos de la empresa pide el pliego (lo que
 * no aplica no cuenta); `bridge` dice cuáles no llegan vigentes al cierre; `requirementRows` aporta la garantía de
 * seriedad y los certificados de experiencia, que no son documentos de la empresa sino del proceso.
 */
export function tramitesConTercerosSeedItems({ matrix = null, bridge = null, requirementRows = [], closeDate = null, today = null } = {}) {
  const required = new Set();
  for (const row of matrix?.rows || []) {
    if (row.status === 'no_aplica') continue;
    for (const support of row.company_support || []) required.add(support.key);
  }
  const bridgeRows = new Map((bridge?.rows || []).map(row => [row.key, row]));
  const items = [];
  for (const key of required) {
    const tramite = TRAMITES_CON_TERCEROS[key];
    const entry = CLASS_BY_KEY.get(key);
    const row = bridgeRows.get(key);
    if (!tramite || !entry || entry.kind === 'hecho_inscrito' || !NOT_READY.has(row?.state)) continue;
    const motivo = row.state === 'sin_archivo' ? 'no hay soporte cargado.'
      : row.state === 'vencido' ? `el que hay venció${row.expires_at ? ` el ${row.expires_at}` : ''}.`
        : `el que hay vence${row.expires_at ? ` el ${row.expires_at}` : ''}, antes del cierre.`;
    items.push(item({ key, label: entry.label, owner: entry.owner, ...tramite, motivo }, closeDate, today));
  }
  const open = (requirementRows || []).filter(row => row.status !== 'no_aplica' && row.status !== 'cumple');
  if (open.some(row => /garant\w*.{0,40}seriedad|seriedad.{0,40}garant/.test(fold(`${row.title} ${row.demand || ''}`)))) {
    items.push(item({ ...SERIEDAD, motivo: 'el pliego la exige con la oferta y no presentarla no se subsana.' }, closeDate, today));
  }
  if (open.some(row => row.category === 'EXPERIENCE')) {
    items.push(item({ ...EXPERIENCIA, motivo: 'la experiencia que pide el pliego no está acreditada del todo; cada certificado lo expide el contratante.' }, closeDate, today));
  }
  // Lo que hay que pedir primero, primero.
  return items.sort((a, b) => String(a.target_date || '9').localeCompare(String(b.target_date || '9')));
}
