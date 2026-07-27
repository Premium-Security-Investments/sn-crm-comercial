import { strict as assert } from 'node:assert';
import { buildSync } from 'esbuild';
import { readFileSync } from 'node:fs';

const entry = new URL('../src/tenders/dossierUtils.ts', import.meta.url);
const built = buildSync({ stdin: { contents: readFileSync(entry, 'utf8'), loader: 'ts', sourcefile: 'dossierUtils.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const mod = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

assert.deepEqual(mod.tenderDossierQueueState({ document_count: 0, missing_document_count: 1, document_import_status: 'pendiente_documentos', decision: null }), {
  process: 'Expediente incompleto',
  nextAction: 'Completar o importar documentos',
  error: null,
});
assert.deepEqual(mod.tenderDossierQueueState({ document_count: 2, missing_document_count: 0, document_import_status: 'analisis_generado', decision: null }), {
  process: 'Decisión humana pendiente',
  nextAction: 'Revisar análisis y decidir GO / NO GO',
  error: null,
});
assert.deepEqual(mod.tenderDossierQueueState({ document_count: 1, missing_document_count: 0, document_import_status: 'fallo_importacion', document_import_error: 'TLS inválido', decision: null }), {
  process: 'Requiere atención',
  nextAction: 'Resolver error documental',
  error: 'TLS inválido',
});

const view = readFileSync(new URL('../src/tenders/TenderOpportunitiesView.tsx', import.meta.url), 'utf8');
assert.match(view, /tenderDossierQueueState\(dossier\)/, 'La cola debe usar un único resumen derivado');
assert.match(view, /Proceso actual/);
assert.match(view, /Siguiente acción/);
assert.match(view, /queueState\.error/);
assert.doesNotMatch(view, /JSON\.stringify\(dossier/, 'La cola no debe volcar el expediente completo');

console.log('tender dossier queue state contract passed');
