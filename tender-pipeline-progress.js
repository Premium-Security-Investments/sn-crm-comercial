export function summarizeImportProgress(job) {
  const discovered = job.documents_discovered ?? 0;
  const processed = job.documents_processed ?? 0;
  const imported = job.documents_imported ?? 0;
  const unchanged = job.documents_unchanged ?? 0;
  const failed = job.documents_failed ?? 0;
  const remaining = Math.max(0, discovered - processed);

  const parts = [];
  if (imported > 0) parts.push(`${imported} importados`);
  if (unchanged > 0) parts.push(`${unchanged} sin cambios`);
  if (failed > 0) parts.push(`${failed} fallidos`);
  const label = parts.length > 0 ? parts.join(' · ') : `0 de ${discovered} procesados`;

  let status_kind;
  if (failed > 0 && remaining === 0) status_kind = 'partial';
  else if (remaining > 0) status_kind = 'in_progress';
  else if (discovered > 0 && remaining === 0) status_kind = 'complete';
  else status_kind = 'pending';

  return { label, imported, unchanged, failed, discovered, processed, remaining, status_kind };
}

const WAITING_CAPACITY_REASONS = new Set(['quota', 'saturated', 'busy']);
const UNAVAILABLE_REASONS = new Set(['not_configured', 'preview_unavailable']);

// Normative UI labels (spec §10.2): a rules fallback never presents as AI analysis.
export function analysisLabel(analysisEngine = {}) {
  const { used, fallback, reason } = analysisEngine;
  if (WAITING_CAPACITY_REASONS.has(reason)) return 'Esperando capacidad/cuota de AGT-002';
  if (UNAVAILABLE_REASONS.has(reason)) return 'AGT-002 no disponible';
  if (used === 'AGT-002' && !fallback) return 'Análisis con IA · AGT-002';
  if (used === 'siio_rules_v1' || used === 'rules') return 'Preanálisis por reglas · SIIO';
  return 'AGT-002 no disponible';
}
