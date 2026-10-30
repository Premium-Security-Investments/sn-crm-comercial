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
// La tarjeta muestra un solo "Siguiente paso"; el análisis oficial de Vig-IA manda sobre el estado del preanálisis.
assert.match(view, /Siguiente paso/);
assert.match(view, /opportunityProcessState\(dossier, queueState\)/);
assert.match(view, /queueState\.error/);
assert.doesNotMatch(view, /JSON\.stringify\(dossier/, 'La cola no debe volcar el expediente completo');

console.log('tender dossier queue state contract passed');

// 2026-10-29: cuatro licitaciones sin documentos mostraban "Expediente incompleto · Completar o
// importar documentos", mandando a una persona a resolver algo que no estaba en su mano: la entidad
// todavía no había publicado nada y el pipeline ya tenía cita para volver a mirar.
const AHORA = new Date('2026-10-29T03:50:00Z'); // 28-oct, 10:50 p. m. en Bogotá
const esperando = {
  document_count: 0, missing_document_count: 0, document_import_status: 'pendiente_documentos', decision: null,
  documents_pending_source: {
    reason_code: 'TENDER_DOCUMENTS_NOT_PUBLISHED_YET',
    reason: 'La entidad aún no ha publicado documentos en la fuente oficial.',
    next_check_at: '2026-10-29T04:20:00Z', attempt: 1, parked: false,
  },
};

{
  const estado = mod.tenderDossierQueueState(esperando, { now: AHORA });
  assert.equal(estado.process, 'Esperando documentos de la entidad');
  assert.equal(estado.error, null, 'esperar a la fuente no es un error del expediente');
  assert.match(estado.nextAction, /vuelve a revisar a las/);
  assert.match(estado.nextAction, /11:20/, 'dice la hora de Bogotá, no la UTC');
}

{
  // Si la cita cae otro día, la hora sola no basta: tiene que nombrar el día.
  const manana = { ...esperando, documents_pending_source: { ...esperando.documents_pending_source, next_check_at: '2026-10-30T12:00:00Z' } };
  assert.match(mod.tenderDossierQueueState(manana, { now: AHORA }).nextAction, /vuelve a revisar el .+ a las/);
}

{
  // Sin fecha legible no se inventa una hora.
  for (const at of [null, undefined, 'no es fecha']) {
    const sinFecha = { ...esperando, documents_pending_source: { ...esperando.documents_pending_source, next_check_at: at } };
    assert.equal(mod.tenderDossierQueueState(sinFecha, { now: AHORA }).nextAction, 'Vig-IA vuelve a revisar automáticamente', String(at));
  }
}

{
  // Agotadas las revisiones sí es de una persona, y con el motivo a la vista.
  const aparcada = { ...esperando, documents_pending_source: {
    reason_code: 'TENDER_DOCUMENTS_NEVER_PUBLISHED',
    reason: 'La fuente oficial no publicó ningún documento en 12 revisiones durante unos 8 días.',
    next_check_at: null, attempt: 12, parked: true,
  } };
  assert.deepEqual(mod.tenderDossierQueueState(aparcada, { now: AHORA }), {
    process: 'Requiere atención',
    nextAction: 'La fuente oficial nunca publicó documentos',
    error: 'La fuente oficial no publicó ningún documento en 12 revisiones durante unos 8 días.',
  });
}

{
  // Un fallo real de importación sigue mandando sobre la espera de la fuente.
  const falla = { ...esperando, document_import_status: 'fallo_importacion', document_import_error: 'TLS inválido' };
  assert.deepEqual(mod.tenderDossierQueueState(falla, { now: AHORA }), {
    process: 'Requiere atención', nextAction: 'Resolver error documental', error: 'TLS inválido',
  });
}

{
  // Sin la razón del pipeline, la tarjeta se comporta exactamente como antes.
  assert.deepEqual(mod.tenderDossierQueueState({ document_count: 0, missing_document_count: 0, document_import_status: 'pendiente_documentos', decision: null }, { now: AHORA }), {
    process: 'Expediente incompleto', nextAction: 'Completar o importar documentos', error: null,
  });
}
