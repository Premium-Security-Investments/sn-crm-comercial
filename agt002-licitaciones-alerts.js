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

const REVIEW_TEXT = {
  documents_missing: 'SECOP cambió de fase hace unos 3 días y datos.gov.co todavía no publica los documentos nuevos. Hay que revisar en SECOP y subirlos a mano.',
  documents_unstable: 'La lista de documentos en datos.gov.co sigue cambiando desde hace unos 3 días. Hay que revisar en SECOP y subirlos a mano.',
  documents_incomplete: 'Los documentos nuevos que muestra datos.gov.co están incompletos. Hay que revisar en SECOP y subirlos a mano.',
};
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
export function agt002AlertItems({ detections = [], documents = [], analyses = [], results = [], reviews = [], failures = [] } = {}, { day }) {
  const items = [];
  for (const d of detections) items.push({ key: `link:${d.opportunityId}:${d.noticeUid}`, opportunityId: d.opportunityId, type: 'link', fact: d });
  for (const d of documents) items.push({ key: `docs:${d.opportunityId}:${d.setHash}`, opportunityId: d.opportunityId, type: 'documents', fact: d });
  for (const a of analyses) {
    const daily = ['safety_limit', 'not_admitted', 'failed'].includes(a.outcome) ? `:${day}` : '';
    items.push({ key: `analysis:${a.opportunityId}:${a.setHash}:${a.outcome}${daily}`, opportunityId: a.opportunityId, type: 'analysis', fact: a });
  }
  for (const r of results) items.push({ key: `result:${r.jobId}:${r.status}`, opportunityId: r.opportunityId, type: 'result', fact: r });
  for (const r of reviews) items.push({ key: `review:${r.opportunityId}:${r.noticeUid}:${r.review}`, opportunityId: r.opportunityId, type: 'review', fact: r });
  for (const f of failures) items.push({ key: `failure:${f.opportunityId}:${f.setHash}:${day}`, opportunityId: f.opportunityId, type: 'failure', fact: f });
  return items;
}

function itemLines(item) {
  const fact = item.fact;
  switch (item.type) {
    case 'link':
      return [`SECOP publicó ${whatPublished(fact.change || fact)}. El enlace de la oportunidad se actualizó; el anterior queda como histórico.${fact.url ? ` Nuevo enlace: ${fact.url}` : ''}`];
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
      return [REVIEW_TEXT[fact.review] || 'Requiere revisión humana.'];
    case 'failure':
      return ['No se pudieron bajar todos los documentos nuevos de SECOP; se reintenta en la próxima revisión.'];
    default:
      return [];
  }
}

const ORDER = ['link', 'documents', 'analysis', 'result', 'failure', 'review'];

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
    const lines = [...list].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type)).flatMap(itemLines);
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
