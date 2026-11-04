// Mejora 5: el borrador de la Mesa sale también como Word, guardado en el CRM. El modelo entrega el documento como
// datos; el servidor lo arma, lo guarda y escribe la metadata. Si algo falla, el borrador de texto se guarda igual.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createAgt002WorkbenchResponder } from '../verticales/licitaciones/agt002-workbench-responder.js';
import {
  agt002DraftMetadata, agt002DraftStoragePath, createAgt002DraftDocumentProducer, isAgt002DraftStoragePath,
} from '../verticales/licitaciones/agt002-workbench-document.js';

const OPP = '20000000-0000-4000-8000-000000000004';
const JOB = '20000000-0000-4000-8000-000000000001';
const ARTIFACT = '20000000-0000-4000-8000-0000000000aa';
const input = {
  job_id: JOB, thread_id: '20000000-0000-4000-8000-000000000002', origin_message_id: '20000000-0000-4000-8000-000000000003',
  opportunity_id: OPP, tender_id: '20000000-0000-4000-8000-000000000005', snapshot_id: '20000000-0000-4000-8000-000000000006',
  base_version_id: null, capability_id: 'agt002.dossier-workbench.draft.v1', contract_version: 'agt002.dossier-workbench.v1',
  policy_version: 'agt002.dossier-workbench.policy.v1',
  context_links: [{ kind: 'artifact', id: ARTIFACT, label: 'Carta de presentación', source_ref: 'artefacto:carta_presentacion' }],
  message: 'Necesito la carta de presentación',
};
const documento = { title: 'ANEXO 1 — CARTA DE PRESENTACIÓN', blocks: [{ kind: 'paragraph', text: 'Vigencia de [[90 días]].' }] };
const modelOutput = extra => ({
  content_kind: 'markdown', content_text: '# Carta de presentación', content_metadata: { url: 'https://inventada.example/x.docx' },
  source_links: [ARTIFACT], missing_information: ['Valor de la oferta'], required_actions: [], ...extra,
});
const responderWith = ({ output, produceDocument }) => {
  let schema = null;
  const responder = createAgt002WorkbenchResponder({
    client: { run: async args => { schema = args.outputSchema; return { content: JSON.stringify(output), usage: { input_tokens: 1, output_tokens: 1 } }; } },
    model: 'modelo', timeoutMs: 1000, checkGate: () => true, produceDocument,
  });
  return { responder, schema: () => schema };
};

test('con la herramienta, el modelo debe entregar el documento y la metadata la escribe el servidor', async () => {
  const calls = [];
  const { responder, schema } = responderWith({
    output: modelOutput({ document: documento }),
    produceDocument: async args => { calls.push(args); return { archivo: { storage_path: 'x' } }; },
  });
  const envelope = await responder.respond(input);
  assert.ok(schema().required.includes('document'));
  assert.deepEqual(calls[0].document, documento);
  assert.deepEqual(envelope.content_metadata, { archivo: { storage_path: 'x' } }, 'la URL que inventó el modelo no pasa');
  assert.deepEqual(envelope.missing_information, ['Valor de la oferta']);
  assert.match(envelope.content_text, /^Word listo: «Carta de presentación» quedó en el expediente.*\(1 punto\) requiere su decisión antes de firmar\.\n\n# Carta de presentación$/s);
});

test('si el Word falla, el borrador de texto se guarda igual y lo dice en lo que falta', async () => {
  const { responder } = responderWith({
    output: modelOutput({ document: documento }),
    produceDocument: async () => { throw Object.assign(new Error('x'), { code: 'AGT002_DOCUMENT_TRANSPORT_ERROR' }); },
  });
  const envelope = await responder.respond(input);
  assert.equal(envelope.content_text, '# Carta de presentación');
  assert.deepEqual(envelope.content_metadata, { documento_error: 'AGT002_DOCUMENT_TRANSPORT_ERROR' });
  assert.match(envelope.missing_information.at(-1), /No se pudo armar el Word/);
});

test('sin la herramienta, el borrador es el de siempre: no se pide documento', async () => {
  const { responder, schema } = responderWith({ output: modelOutput(), produceDocument: null });
  const envelope = await responder.respond(input);
  assert.equal(schema().required.includes('document'), false);
  assert.equal(schema().properties.document, undefined);
  assert.deepEqual(envelope.content_metadata, { url: 'https://inventada.example/x.docx' });
});

test('el productor guarda el Word en la carpeta de borradores del proceso, sin pisar nada', async () => {
  const uploads = [];
  const database = { storage: { from: bucket => ({ upload: async (path, bytes, options) => { uploads.push({ bucket, path, bytes, options }); return { error: null }; } }) } };
  const bridgeClient = { renderDocument: async () => ({ bytes: Buffer.from('PK-word'), sha256: 'a'.repeat(64) }) };
  const produce = createAgt002DraftDocumentProducer({ database, bridgeClient, now: () => new Date('2026-11-04T10:00:00Z') });
  const metadata = await produce({ input, document: documento, missingInformation: ['Valor de la oferta'] });
  assert.equal(uploads[0].bucket, 'tender-documents');
  assert.equal(uploads[0].path, `tender-documents/${OPP}/borradores-vigia/${JOB}/ANEXO_1_CARTA_DE_PRESENTACION.docx`);
  assert.equal(uploads[0].options.upsert, false);
  assert.deepEqual(metadata.archivo, { almacen: 'crm', storage_path: uploads[0].path, nombre: 'ANEXO_1_CARTA_DE_PRESENTACION.docx', sha256: 'a'.repeat(64), bytes: 7, generado_en: '2026-11-04T10:00:00.000Z' });
  assert.deepEqual(metadata.sharepoint, { estado: 'pendiente' });
  assert.deepEqual(metadata.falta, ['Valor de la oferta']);
});

test('sólo se sirve un borrador de ESTA oportunidad', () => {
  const path = agt002DraftStoragePath({ opportunityId: OPP, jobId: JOB, fileName: 'Carta.docx' });
  assert.equal(isAgt002DraftStoragePath(path, OPP), true);
  assert.equal(isAgt002DraftStoragePath(path, '30000000-0000-4000-8000-000000000004'), false);
  assert.equal(isAgt002DraftStoragePath(`tender-documents/${OPP}/documentos/pliego.pdf`, OPP), false);
  assert.equal(isAgt002DraftStoragePath(`tender-documents/${OPP}/borradores-vigia/../../otra/x.docx`, OPP), false);
});

test('la metadata cabe en el tope del contrato aunque falten muchas cosas', () => {
  const metadata = agt002DraftMetadata({ storagePath: 'p', fileName: 'f', sha256: 's', bytes: 1, generatedAt: 't', missingInformation: Array.from({ length: 20 }, () => 'x'.repeat(2000)) });
  assert.ok(JSON.stringify(metadata).length <= 8000);
  assert.ok(metadata.falta.length > 0);
});

// Juan, 2026-11-04: el pedido de las 20:35Z falló y nadie vio nada en 16 minutos. Todo fallo deja un aviso en el chat;
// el código técnico va sólo al registro.
test('un trabajo fallido deja un aviso en el chat, en palabras simples', async () => {
  const { runAgt002WorkbenchWorker, agt002WorkbenchFailureNoticeText } = await import('../verticales/licitaciones/agt002-workbench-worker.js');
  const events = []; const notices = [];
  const persistence = {
    claimAgt002WorkbenchJob: async () => ({ status: 'claimed', claim_id: '30000000-0000-4000-8000-000000000001', job: { ...input, id: JOB, context_links: [{ kind: 'artifact', id: ARTIFACT, label: 'x', source_ref: 'termina en espacio ' }] } }),
    appendAgt002WorkbenchJobEvent: async event => { events.push(event); },
    completeAgt002WorkbenchJob: async () => { throw new Error('no debe llegar'); },
    postAgt002WorkbenchFailureNotice: async notice => { notices.push(notice); },
  };
  const outcome = await runAgt002WorkbenchWorker({ persistence, responder: { respond: async () => ({}) }, limits: { workerId: 'w', agentId: '40000000-0000-4000-8000-000000000001', responderTimeoutMs: 1000 } });
  assert.equal(outcome.status, 'failed');
  assert.equal(events[0].metadata.code, 'AGT002_INVALID_JOB_INPUT', 'el código técnico va al registro');
  assert.deepEqual(notices, [{ jobId: JOB, agentId: '40000000-0000-4000-8000-000000000001', content: 'No pude preparar esto: el pedido llegó con datos del expediente que no pude leer. Vuelva a pedirlo o avise a soporte.' }]);
  assert.equal(notices[0].content.includes('AGT002'), false, 'el código no va al chat');
  assert.match(agt002WorkbenchFailureNoticeText('ALGO_RARO'), /^No pude preparar esto: hubo un error técnico\./);
});

test('si el aviso no se puede publicar (migración 176 sin correr), el fallo igual queda registrado', async () => {
  const { runAgt002WorkbenchWorker } = await import('../verticales/licitaciones/agt002-workbench-worker.js');
  const events = [];
  const persistence = {
    claimAgt002WorkbenchJob: async () => ({ status: 'claimed', claim_id: '30000000-0000-4000-8000-000000000001', job: { ...input, id: JOB } }),
    appendAgt002WorkbenchJobEvent: async event => { events.push(event); },
    completeAgt002WorkbenchJob: async () => ({}),
    postAgt002WorkbenchFailureNotice: async () => { throw new Error('function does not exist'); },
  };
  const outcome = await runAgt002WorkbenchWorker({ persistence, responder: { respond: async () => { throw Object.assign(new Error('t'), { code: 'AGT002_RESPONDER_TIMEOUT' }); } }, limits: { workerId: 'w', agentId: '40000000-0000-4000-8000-000000000001', responderTimeoutMs: 1000 } });
  assert.equal(outcome.status, 'failed');
  assert.equal(events.length, 1);
});

test('el borrador le pasa al catálogo el documento que va a escribir, y la respuesta normal no', async () => {
  const seen = [];
  const make = () => createAgt002WorkbenchResponder({
    client: { run: async () => ({ content: JSON.stringify(modelOutput()), usage: { input_tokens: 1, output_tokens: 1 } }) },
    model: 'modelo', timeoutMs: 1000, checkGate: () => true, resolveSources: args => { seen.push(args); return []; },
  });
  await make().respond(input);
  assert.equal(seen[0].documento, 'Carta de presentación');
});
