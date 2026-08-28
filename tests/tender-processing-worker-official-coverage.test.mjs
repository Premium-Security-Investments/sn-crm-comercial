// TDD (RED) — el worker durable debe hacer visible (y durable) la cobertura
// documental oficial que su fase de descubrimiento consiguio.
//
// Hoy `discoverDocuments` devuelve una lista plana y el worker solo cuenta su
// longitud: si la seleccion dejo documentos oficiales fuera, el job avanza a
// `importing_documents` con `documents_discovered` igual a lo que se trajo, y
// no queda ninguna huella de lo que NO se trajo. El evento
// `document_discovery_started` publica `{ discovered: N }` y nada mas, asi que
// ni la conversion ni el refresco pueden distinguir "el proceso tenia 7
// documentos y estan los 7" de "tenia 43 y estan 40".
//
// Contrato que fija este archivo:
//
//   * `discoverDocuments` devuelve `{ items, coverage }`.
//   * `documents_discovered` cuenta los items importables.
//   * El evento de descubrimiento publica la cobertura completa, incluida la
//     enumeracion de omitidos.
//   * Cada documento omitido se registra como import item `failed_terminal` con
//     un codigo cerrado, para que la maquinaria que YA existe lo arrastre:
//     `chunkDocuments` lee los `failed_terminal` del job y los convierte en
//     gaps del inventario -> `decision_ready` falla cerrado. Un omitido
//     CRITICO ademas marca `critical: true`, que es lo que impide que el job
//     resuelva a `ready_for_snapshot`.
//   * La forma antigua (arreglo plano) sigue funcionando, pero NO puede
//     declararse como cobertura completa: se publica `null`.
//
// Ejecutar: node tests/tender-processing-worker-official-coverage.test.mjs

import { strict as assert } from 'node:assert';
import { createTenderProcessingWorker } from '../tender-processing-worker.js';
import { isCriticalTenderDocument } from '../tender-critical-documents.js';

const OMITTED_REASON = 'official_document_omitted_by_selection_cap';
const OMITTED_ERROR_CODE = 'TENDER_DOC_COVERAGE_OMITTED';

const ITEMS = [
  { source: 'SECOP II', sourceDocumentId: 'SECOP-DOC-0001', sourceUrl: 'https://community.secop.gov.co/d/1', name: 'PLIEGO DE CONDICIONES DEFINITIVO.pdf', critical: true },
  { source: 'SECOP II', sourceDocumentId: 'SECOP-DOC-0004', sourceUrl: 'https://community.secop.gov.co/d/4', name: 'ANALISIS DEL SECTOR.pdf', critical: false },
];

const OMITTED = [
  { document_id: 'SECOP-DOC-0041', name: 'ANEXO FINANCIERO 41.xlsx', reason: OMITTED_REASON },
  { document_id: 'SECOP-DOC-0042', name: 'COTIZACION 42 ALFA.pdf', reason: OMITTED_REASON },
  { document_id: 'SECOP-DOC-0043', name: 'ANALISIS DEL SECTOR 43.pdf', reason: OMITTED_REASON },
];

const PARTIAL_COVERAGE = Object.freeze({
  status: 'partial',
  total_official_documents: 43,
  selected_count: 40,
  omitted_count: 3,
  omitted_documents: OMITTED,
});

const COMPLETE_COVERAGE = Object.freeze({
  status: 'complete',
  total_official_documents: 2,
  selected_count: 2,
  omitted_count: 0,
  omitted_documents: [],
});

function makeDeps(discoverDocuments) {
  const calls = { updateJob: [], recordImportItem: [], appendEvent: [] };
  return {
    calls,
    deps: {
      claimJob: async () => ({
        job_id: 'job-cov', lease_id: 'lease-cov', tender_id: 'tender-cov', opportunity_id: 'opp-cov',
        status: 'queued', current_step: 'documents',
      }),
      updateJob: async (jobId, leaseId, patch) => { calls.updateJob.push({ jobId, leaseId, patch }); },
      recordImportItem: async item => { calls.recordImportItem.push(item); },
      appendEvent: async event => { calls.appendEvent.push(event); },
      revalidateOfficialStatus: async () => ({ terminal: false }),
      discoverDocuments,
      importOneDocument: async () => { throw new Error('la fase de descubrimiento no importa documentos'); },
      publishSnapshot: async () => ({ id: 'snap-cov' }),
      requestAgt002: async () => ({ status: 'quota' }),
      now: () => 0,
    },
  };
}

async function run() {
  // =========================================================================
  // 1) Cobertura parcial: se cuenta lo importable, se publica la cobertura y
  //    se registra CADA omitido como fallo terminal enumerado.
  // =========================================================================
  {
    const { deps, calls } = makeDeps(async () => ({ items: ITEMS, coverage: PARTIAL_COVERAGE }));
    const result = await createTenderProcessingWorker(deps).runOnce({});

    assert.equal(result.status, 'discovered');
    assert.equal(result.discovered, ITEMS.length, 'documents_discovered cuenta los documentos importables');

    assert.equal(calls.updateJob.length, 1);
    assert.equal(calls.updateJob[0].patch.status, 'importing_documents');
    assert.equal(calls.updateJob[0].patch.current_step, 'documents');
    assert.equal(calls.updateJob[0].patch.documents_discovered, ITEMS.length);

    assert.equal(calls.appendEvent.length, 1);
    assert.equal(calls.appendEvent[0].eventType, 'document_discovery_started');
    assert.equal(calls.appendEvent[0].metadata.discovered, ITEMS.length);
    assert.deepEqual(
      calls.appendEvent[0].metadata.official_document_coverage,
      PARTIAL_COVERAGE,
      'el evento de descubrimiento debe publicar la cobertura oficial completa, con los omitidos enumerados',
    );

    // Un omitido no puede quedarse solo en un evento: tiene que ser durable
    // para que chunkDocuments lo lea como gap del expediente.
    assert.equal(calls.recordImportItem.length, OMITTED.length, 'cada documento oficial omitido se registra como item del job');
    assert.deepEqual(
      calls.recordImportItem.map(item => item.sourceDocumentId),
      OMITTED.map(item => item.document_id),
      'los omitidos se registran con su identidad oficial, en orden deterministico',
    );
    for (const [index, item] of calls.recordImportItem.entries()) {
      assert.equal(item.jobId, 'job-cov');
      assert.equal(item.status, 'failed_terminal', 'un documento omitido es un fallo terminal, no un pendiente invisible');
      assert.equal(item.lastErrorCode, OMITTED_ERROR_CODE);
      assert.equal(item.name, OMITTED[index].name);
      assert.equal(item.source, 'SECOP II');
      assert.equal(
        item.critical,
        isCriticalTenderDocument(OMITTED[index].name),
        'la criticidad del omitido se decide con la MISMA taxonomia objetiva que la de los importados',
      );
    }
    assert.equal(
      calls.recordImportItem.some(item => item.critical === true),
      true,
      'ANEXO FINANCIERO 41.xlsx es critico: omitirlo debe impedir que el job resuelva usable',
    );
    assert.equal(
      calls.recordImportItem.some(item => item.status !== 'failed_terminal'),
      false,
      'la fase de descubrimiento no registra items importados: solo enumera lo que quedo fuera',
    );
  }

  // =========================================================================
  // 2) Cobertura completa: nada omitido, nada que enumerar.
  // =========================================================================
  {
    const { deps, calls } = makeDeps(async () => ({ items: ITEMS, coverage: COMPLETE_COVERAGE }));
    const result = await createTenderProcessingWorker(deps).runOnce({});
    assert.equal(result.discovered, ITEMS.length);
    assert.deepEqual(calls.appendEvent[0].metadata.official_document_coverage, COMPLETE_COVERAGE);
    assert.deepEqual(calls.recordImportItem, [], 'una cobertura completa no fabrica fallos terminales');
  }

  // =========================================================================
  // 3) Idempotencia: repetir el descubrimiento produce exactamente los mismos
  //    registros (el RPC dedupe por job_id + source_document_id), nunca ids
  //    nuevos ni duplicados con identidad distinta.
  // =========================================================================
  {
    const first = makeDeps(async () => ({ items: ITEMS, coverage: PARTIAL_COVERAGE }));
    const second = makeDeps(async () => ({ items: ITEMS, coverage: PARTIAL_COVERAGE }));
    await createTenderProcessingWorker(first.deps).runOnce({});
    await createTenderProcessingWorker(second.deps).runOnce({});
    assert.deepEqual(
      second.calls.recordImportItem,
      first.calls.recordImportItem,
      'el descubrimiento es reproducible: mismos items, misma identidad, mismo orden',
    );
  }

  // =========================================================================
  // 4) Forma antigua (arreglo plano): sigue avanzando, pero NUNCA se presenta
  //    como cobertura completa.
  // =========================================================================
  {
    const { deps, calls } = makeDeps(async () => ITEMS);
    const result = await createTenderProcessingWorker(deps).runOnce({});
    assert.equal(result.discovered, ITEMS.length);
    assert.equal(calls.updateJob[0].patch.documents_discovered, ITEMS.length);
    assert.equal(
      calls.appendEvent[0].metadata.official_document_coverage,
      null,
      'sin cobertura declarada, el evento dice null: no se puede inferir que se trajo todo',
    );
    assert.deepEqual(calls.recordImportItem, []);
  }

  console.log('tender-processing-worker-official-coverage.test.mjs OK');
}

run();
