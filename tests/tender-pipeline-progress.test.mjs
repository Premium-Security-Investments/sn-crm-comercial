import { strict as assert } from 'node:assert';
import { summarizeImportProgress, analysisLabel } from '../tender-pipeline-progress.js';

// summarizeImportProgress agrupa sin exponer 40 logs individuales.
{
  const summary = summarizeImportProgress({
    documents_discovered: 40,
    documents_processed: 40,
    documents_imported: 38,
    documents_unchanged: 0,
    documents_failed: 2,
  });
  assert.equal(summary.label, '38 importados · 2 fallidos');
  assert.equal(summary.imported, 38);
  assert.equal(summary.failed, 2);
  assert.equal(summary.discovered, 40);
  assert.equal(summary.processed, 40);
  assert.equal(summary.remaining, 0);
  assert.equal(summary.status_kind, 'partial');
}

// Sin fallos, todo procesado -> completo.
{
  const summary = summarizeImportProgress({
    documents_discovered: 10, documents_processed: 10, documents_imported: 9, documents_unchanged: 1, documents_failed: 0,
  });
  assert.equal(summary.label, '9 importados · 1 sin cambios');
  assert.equal(summary.status_kind, 'complete');
  assert.equal(summary.remaining, 0);
}

// En progreso: quedan documentos por procesar.
{
  const summary = summarizeImportProgress({
    documents_discovered: 5, documents_processed: 2, documents_imported: 2, documents_unchanged: 0, documents_failed: 0,
  });
  assert.equal(summary.remaining, 3);
  assert.equal(summary.status_kind, 'in_progress');
}

// Sin actividad todavía.
{
  const summary = summarizeImportProgress({
    documents_discovered: 0, documents_processed: 0, documents_imported: 0, documents_unchanged: 0, documents_failed: 0,
  });
  assert.equal(summary.label, '0 de 0 procesados');
  assert.equal(summary.status_kind, 'pending');
}

// analysisLabel: etiquetas normativas exactas (spec §10.2).
assert.equal(
  analysisLabel({ requested: 'AGT-002', used: 'siio_rules_v1', fallback: true, reason: 'quota' }),
  'Esperando capacidad/cuota de AGT-002',
);
assert.equal(
  analysisLabel({ requested: 'AGT-002', used: 'siio_rules_v1', fallback: true, reason: 'saturated' }),
  'Esperando capacidad/cuota de AGT-002',
);
assert.equal(
  analysisLabel({ requested: 'AGT-002', used: 'siio_rules_v1', fallback: true, reason: 'busy' }),
  'Esperando capacidad/cuota de AGT-002',
);
assert.equal(
  analysisLabel({ requested: 'AGT-002', used: null, fallback: true, reason: 'not_configured' }),
  'AGT-002 no disponible',
);
assert.equal(
  analysisLabel({ requested: 'AGT-002', used: null, fallback: true, reason: 'preview_unavailable' }),
  'AGT-002 no disponible',
);
assert.equal(analysisLabel({ used: 'AGT-002', fallback: false }), 'Análisis con IA · AGT-002');
assert.equal(analysisLabel({ used: 'siio_rules_v1', fallback: false }), 'Preanálisis por reglas · SIIO');

console.log('tender-pipeline-progress contract passed');
