// AGT-002 · Avisos por correo de Vig-IA Licitaciones (decisión del dueño 2026-10-08).
//
// Tras cada revisión de fases nuevas de SECOP (agt002-phase-change-review.js), si hubo novedad, el CRM arma UN correo
// con todo lo que pasó en las licitaciones convertidas activas y lo deja en un "outbox" auditable. El CRM nunca envía:
// Hermes lo envía tal cual (ops/agt002-licitaciones-alerts/HERMES-DELIVERY-CONTRACT.md). El día que el CRM envíe directo
// por Microsoft, sólo cambia quién lee el outbox: este módulo (qué se dice, a quién, con qué id) no cambia.
//
// Módulo puro: recibe los hechos ya leídos y devuelve el outbox. Identifica cada licitación por entidad y valor, nunca
// por códigos internos.

import { createHash } from 'node:crypto';

export const AGT002_ALERTS_CONTRACT = 'agt002-licitaciones-alerts-v1';
export const AGT002_ALERTS_CAPABILITY = 'agt002.licitaciones_alerts';
export const AGT002_ALERTS_SENDER = 'juanbotero@premiumsecurity.ai';
/** Destinatarios FIJOS (decisión del dueño). */
export const AGT002_ALERTS_RECIPIENTS = Object.freeze(['juanbotero@premiumsecurity.ai', 'directora.licitaciones@seguridadnacional.co']);
export const AGT002_ALERTS_APP_URL = 'https://seguridad-nacional-crm.vercel.app';

const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

export function bogotaDay(iso) {
  return new Date(Date.parse(iso) - BOGOTA_OFFSET_MS).toISOString().slice(0, 10);
}

export function bogotaTime(iso) {
  return new Date(Date.parse(iso) - BOGOTA_OFFSET_MS).toISOString().slice(11, 16);
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function formatCop(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 'valor por confirmar';
  return `$${Math.round(number).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

function whatPublished(change) {
  const offer = /presentaci[oó]n de oferta/i.test(`${change?.newPhase || ''} ${change?.ref || ''}`);
  return change?.change === 'republication' ? 'una versión nueva del proceso' : offer ? 'el pliego definitivo (fase de oferta)' : 'una fase nueva del proceso';
}

// Por qué Vig-IA no pudo traer sola los documentos. Katherine (17-nov): el aviso viejo («SECOP cambió de fase hace unos 3
// días…») no decía qué significaba la fase, en qué etapa estaba el proceso ni por qué importaba. Ahora el aviso dice
// qué pasó, por qué importa, en qué etapa va el cronograma y qué hacer (reviewLines).
const REVIEW_TEXT = {
  documents_missing: 'Vig-IA no pudo traer sola esos documentos: hace unos 3 días que los datos abiertos de SECOP (datos.gov.co), de donde los baja, no los publican.',
  documents_unstable: 'Vig-IA no pudo traer sola esos documentos: hace unos 3 días que la lista de documentos en los datos abiertos de SECOP sigue cambiando y no es confiable.',
  documents_incomplete: 'Vig-IA no pudo traer sola esos documentos: los datos abiertos de SECOP muestran solo una parte de ellos.',
  // Mejora 15: la misma tanda sigue sin poder bajarse después de unos 3 días de reintentos.
  import_failing: 'Vig-IA no pudo traer sola esos documentos: hace unos 3 días que SECOP no deja bajarlos (se sigue reintentando).',
};
// Por qué importa, según lo que publicó SECOP.
function whyItMatters(change) {
  const offer = /presentaci[oó]n de oferta/i.test(`${change?.newPhase || ''} ${change?.ref || ''}`);
  if (change?.change === 'republication') return 'Una versión nueva del proceso puede traer adendas o cambios de fechas, requisitos o valores.';
  if (change?.change === 'documents') return 'Suelen ser adendas, respuestas a observaciones o informes de evaluación, que pueden cambiar plazos, requisitos o el resultado.';
  if (offer) return 'Es el pliego definitivo: con él pueden cambiar requisitos, fechas y valores, empieza a correr el plazo de observaciones al definitivo y queda fijado el cierre.';
  return 'Cada fase nueva trae documentos de la entidad (adendas, respuestas a observaciones o informes) que pueden cambiar plazos o requisitos.';
}
const LONG_DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const LONG_MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** '2026-11-20T23:59:00-05:00' → 'viernes 20 de noviembre, 11:59 p. m.' (hora de Bogotá; sin hora si es medianoche UTC de una fecha). */
export function bogotaLongLabel(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  // Medianoche UTC es una fecha sin hora (memoria «cierre de sólo fecha»): se lee en UTC para no correrla un día.
  const onlyDate = /T00:00:00(\.000)?(Z|[+-]00:00)$/.test(String(iso)) || /^\d{4}-\d{2}-\d{2}$/.test(String(iso));
  const local = new Date(onlyDate ? ms : ms - BOGOTA_OFFSET_MS);
  const date = `${LONG_DAYS[local.getUTCDay()]} ${local.getUTCDate()} de ${LONG_MONTHS[local.getUTCMonth()]}`;
  if (onlyDate) return date;
  const hours = local.getUTCHours(); const minutes = String(local.getUTCMinutes()).padStart(2, '0');
  return `${date}, ${hours % 12 || 12}:${minutes} ${hours < 12 ? 'a. m.' : 'p. m.'}`;
}
// En qué etapa va el proceso: la fase que muestra SECOP, el próximo plazo del cronograma (del análisis vigente) y el cierre.
function stageLine(info, change) {
  const parts = [];
  const phase = change?.newPhase || info?.phase;
  if (phase) parts.push(`SECOP muestra el proceso en «${phase}»`);
  if (info?.nextDeadline?.label && info.nextDeadline.value) parts.push(`el próximo plazo del cronograma es «${info.nextDeadline.label}», el ${bogotaLongLabel(info.nextDeadline.value)}`);
  if (info?.closeAt) parts.push(`el cierre está previsto para el ${bogotaLongLabel(info.closeAt)}`);
  if (!parts.length) return null;
  return `En qué vamos: ${parts.join('; ')}.`;
}
function reviewLines(fact, info) {
  const lines = [`Qué pasó: SECOP publicó ${whatPublished(fact.change || fact)}${fact.change?.newPhase ? ` (fase «${fact.change.newPhase}»)` : ''}. ${REVIEW_TEXT[fact.review] || 'Requiere revisión humana.'}`];
  lines.push(`Por qué importa: ${whyItMatters(fact.change || fact)}`);
  const stage = stageLine(info, fact.change);
  if (stage) lines.push(stage);
  const url = fact.change?.url || fact.url;
  lines.push(`Qué hacer: entrar al proceso en SECOP${url ? ` (${url})` : ''}, bajar los documentos que se publicaron en esta fase y cargarlos en la oportunidad del CRM con origen «entidad». Con eso Vig-IA los lee, actualiza el análisis y el cronograma.`);
  return lines;
}
const ANALYSIS_TEXT = {
  launched: 'Se lanzó el reanálisis automático con los documentos vigentes (sin los archivados). Tarda unos 10 minutos; el resultado llega en el siguiente aviso.',
  safety_limit: 'El reanálisis quedó pendiente porque se alcanzó el límite técnico de seguridad del día. Se intenta mañana; conviene revisar si hay un error.',
  window_elapsed: 'El reanálisis automático no se pudo lanzar en 48 horas. Hay que lanzarlo a mano desde el CRM.',
  process_closed: 'No se lanzó el reanálisis: el proceso ya cerró en SECOP o la oportunidad se cerró.',
  not_admitted: 'El reanálisis automático no se pudo lanzar; se intenta en la próxima revisión.',
  failed: 'El reanálisis automático falló al lanzarse; se intenta en la próxima revisión.',
};

/**
 * Convierte los hechos de una revisión en ítems con clave estable (lo que ya se informó no se repite).
 * `facts`: { detections, documents, analyses, results, reviews, failures } con `opportunityId` en cada uno.
 */
export function agt002AlertItems({ detections = [], reopens = [], documents = [], analyses = [], results = [], reviews = [], failures = [] } = {}, { day }) {
  const items = [];
  for (const d of detections) items.push({ key: `link:${d.opportunityId}:${d.noticeUid}`, opportunityId: d.opportunityId, type: 'link', fact: d });
  // Un descartado al que le cambió el cierre: la clave lleva el aviso nuevo, así que se informa una sola vez.
  for (const r of reopens) items.push({ key: `reopen:${r.opportunityId}:${r.noticeUid || r.deadline}`, opportunityId: r.opportunityId, type: 'reopen', fact: r });
  for (const d of documents) items.push({ key: `docs:${d.opportunityId}:${d.setHash}`, opportunityId: d.opportunityId, type: 'documents', fact: d });
  for (const a of analyses) {
    const daily = ['safety_limit', 'not_admitted', 'failed'].includes(a.outcome) ? `:${day}` : '';
    items.push({ key: `analysis:${a.opportunityId}:${a.setHash}:${a.outcome}${daily}`, opportunityId: a.opportunityId, type: 'analysis', fact: a });
  }
  for (const r of results) items.push({ key: `result:${r.jobId}:${r.status}`, opportunityId: r.opportunityId, type: 'result', fact: r });
  for (const r of reviews) items.push({ key: `review:${r.opportunityId}:${r.noticeUid}:${r.review}`, opportunityId: r.opportunityId, type: 'review', fact: r });
  // Mejora 15 (encargo desde Terminal): la misma falla de la misma tanda se informa UNA vez, no cada día (Supersalud
  // mandó el mismo aviso cuatro días seguidos). Si sigue después de ~3 días, va una revisión aparte (`import_failing`).
  for (const f of failures) items.push({ key: `failure:${f.opportunityId}:${f.setHash}`, opportunityId: f.opportunityId, type: 'failure', fact: f });
  return items;
}

function itemLines(item, info) {
  const fact = item.fact;
  switch (item.type) {
    case 'link':
      return [`SECOP publicó ${whatPublished(fact.change || fact)}. El enlace de la oportunidad se actualizó; el anterior queda como histórico.${fact.url ? ` Nuevo enlace: ${fact.url}` : ''}`];
    case 'reopen':
      return [`Este proceso se descartó con el cierre del ${fact.previousDeadlineLabel}, pero SECOP publicó «${fact.ref}»${fact.phase ? ` en «${fact.phase}»` : ''} con cierre el ${fact.deadlineLabel}. La decisión se tomó con una fecha que ya no es la vigente: vale la pena mirarlo otra vez. La oportunidad sigue descartada; nada se reanalizó.${fact.url ? ` Enlace: ${fact.url}` : ''}`];
    case 'documents': {
      const lines = [`Llegaron ${fact.newDocuments ?? fact.incomingNames?.length ?? 0} documento(s) nuevo(s): ${(fact.incomingNames || []).join(', ') || 'ver la oportunidad'}.`];
      if (fact.archived?.length) lines.push(`Pasaron a historial (ya no entran al análisis): ${fact.archived.map(a => `${a.name}${a.replacedBy ? ` (lo reemplaza ${a.replacedBy})` : ''}`).join('; ')}.`);
      if (fact.doubts?.length) lines.push(`Por duda NO se archivó: ${fact.doubts.map(d => `${d.name} (¿lo reemplaza ${d.candidate}?)`).join('; ')}. Conviene revisarlo.`);
      return lines;
    }
    case 'analysis':
      return [ANALYSIS_TEXT[fact.outcome] || ANALYSIS_TEXT.not_admitted];
    case 'result':
      if (fact.status === 'COMPLETED') return [`Terminó el reanálisis${fact.verdict ? `: ${fact.verdict}` : ' (sin veredicto legible; ver el informe en el CRM)'}.`];
      if (fact.status === 'NEEDS_ATTENTION') return ['El reanálisis quedó en espera de atención. Si termina, el resultado final llega en otro aviso.'];
      return ['El reanálisis no terminó bien. Requiere revisión humana en el CRM.'];
    case 'review':
      return reviewLines(fact, info);
    case 'failure':
      return ['No se pudieron bajar todos los documentos nuevos de SECOP; se reintenta en la próxima revisión.'];
    default:
      return [];
  }
}

const ORDER = ['reopen', 'link', 'documents', 'analysis', 'result', 'failure', 'review'];

/**
 * Outbox de una revisión. `items`: ya filtrados (sólo lo no informado). `opportunities`: Map id → { entity, value, title }.
 * Devuelve `null` si no hay novedad.
 */
export function buildAgt002AlertsOutbox({ runId, generatedAt, slot, items = [], opportunities = new Map(), appUrl = AGT002_ALERTS_APP_URL } = {}) {
  if (!items.length) return null;
  const byOpportunity = new Map();
  for (const item of items) {
    if (!byOpportunity.has(item.opportunityId)) byOpportunity.set(item.opportunityId, []);
    byOpportunity.get(item.opportunityId).push(item);
  }
  const blocks = [...byOpportunity.entries()].map(([opportunityId, list]) => {
    const info = opportunities.get(opportunityId) || {};
    const name = `${info.entity || 'Entidad por confirmar'} — ${formatCop(info.value)}`;
    const lines = [...list].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type)).flatMap(item => itemLines(item, info));
    return { opportunityId, name, title: info.title || '', url: `${appUrl}/#/detail/${encodeURIComponent(opportunityId)}`, lines };
  });
  const day = bogotaDay(generatedAt);
  const subject = blocks.length === 1
    ? `Vig-IA Licitaciones: novedades en SECOP — ${blocks[0].name}`
    : `Vig-IA Licitaciones: novedades en SECOP de ${blocks.length} licitaciones`;
  const intro = `Revisión de las ${bogotaTime(generatedAt)} (hora de Bogotá) del ${day}. Esto cambió en SECOP en las licitaciones que están en curso o por decidir:`;
  const text = [intro, '', ...blocks.flatMap(block => [
    `■ ${block.name}${block.title ? `\n  ${block.title}` : ''}`,
    ...block.lines.map(line => `  - ${line}`),
    `  Ver en el CRM: ${block.url}`, '',
  ]), 'Este correo lo arma Vig-IA Licitaciones automáticamente. No responda a este mensaje.'].join('\n');
  const html = `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2933;font-size:14px;line-height:1.5">`
    + `<p>${escapeHtml(intro)}</p>`
    + blocks.map(block => `<h3 style="margin:18px 0 4px;font-size:15px">${escapeHtml(block.name)}</h3>`
      + (block.title ? `<p style="margin:0 0 6px;color:#52606d">${escapeHtml(block.title)}</p>` : '')
      + `<ul style="margin:0 0 6px;padding-left:20px">${block.lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
      + `<p style="margin:0"><a href="${escapeHtml(block.url)}">Ver la oportunidad en el CRM</a></p>`).join('')
    + '<p style="margin-top:20px;color:#7b8794;font-size:12px">Este correo lo arma Vig-IA Licitaciones automáticamente. No responda a este mensaje.</p></body></html>';
  const keys = items.map(item => item.key).sort();
  const id = createHash('sha256').update(`${AGT002_ALERTS_CONTRACT}|${keys.join('\n')}`).digest('hex');
  return {
    contract: AGT002_ALERTS_CONTRACT,
    capability: AGT002_ALERTS_CAPABILITY,
    agent: 'AGT-002',
    run_id: runId,
    generated_at: generatedAt,
    generated_day_bogota: day,
    slot,
    sender: AGT002_ALERTS_SENDER,
    item_keys: keys,
    messages: [{
      id,
      kind: 'licitaciones_alert',
      to: [...AGT002_ALERTS_RECIPIENTS],
      cc: [],
      subject,
      text: `${text}\n`,
      html,
      opportunities: blocks.map(block => ({ opportunity_id: block.opportunityId, name: block.name, url: block.url })),
    }],
  };
}

/** Resumen legible (personas; Hermes no lo usa). */
export function agt002AlertsOutboxSummary(outbox) {
  const message = outbox.messages[0];
  return `${[`Outbox ${outbox.contract} · ${outbox.run_id}`, `Generado: ${outbox.generated_at} (${outbox.generated_day_bogota}, revisión ${outbox.slot})`,
    `Para: ${message.to.join(', ')}`, `Asunto: ${message.subject}`, `id: ${message.id}`, '', message.text].join('\n')}\n`;
}
