// AGT-002 — vigilancia de la ficha de empresa (mejora 2 del encargo del 2026-10-31).
//
// Lo que fija: que el sistema avise de lo que es cierto y decide, y que NO avise de lo que no sabe.
// El encargo lo pone como la restricción principal: "una falsa alarma de la vigilancia hace que la
// gente deje de leer las alarmas, que es el único daño difícil de revertir". Así que la mitad de estas
// pruebas son sobre silencios.
//
// Los datos son los reales de producción leídos el 2026-10-30 y el 2026-11-01, los mismos que usa
// `tests/tender-company-document-bridge.test.mjs`, para que lo que aquí pasa sea lo que Juan verá.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agt002CompanyEvidenceNotices,
  agt002EvidenceDatesContradictingDocument,
  agt002EvidenceDecisionsWithoutAnchor,
  agt002WatchCloseDate,
  runAgt002CompanyEvidenceWatch,
} from '../verticales/licitaciones/agt002-company-evidence-watch.js';

const NOW = new Date('2026-11-01T12:00:00.000Z');
const TERMINAL = { id: 't-1', ref: 'TT-SPO-07-2026', converted_opportunity_id: 'opp-terminal', deadline_at: '2026-11-04T00:00:00.000Z', raw: { deadline: '2026-11-04' } };

const REGISTRY = [
  { entry_id: 'rce_policy', document_class: 'Póliza de responsabilidad civil extracontractual', existence_status: 'verified', human_review_status: 'approved', vigencia_text: 'Póliza observada: 2026-02-06 a 2027-02-06', expiry: '2027-02-06', current: true, decision_support_document_id: null, decision_humana_fecha: '2026-10-27' },
  { entry_id: 'supervigilancia_operating_license', document_class: 'Licencia de funcionamiento SuperVigilancia', existence_status: 'verified', human_review_status: 'approved', vigencia_text: 'Resolución 20214100005697', expiry: '2029-05-10', current: true, decision_support_document_id: 'doc-licencia', decision_humana_fecha: '2026-10-30' },
  { entry_id: 'authorized_weapons_list', document_class: 'Listado de armas autorizadas', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'Expedido 2026-06-19; vigencia declarada de 60 días', expiry: '2026-08-18', current: true, decision_support_document_id: null, decision_humana_fecha: null },
  { entry_id: 'collective_life_policy', document_class: 'Póliza de seguro de vida colectivo', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'Renovación 2026-2027', expiry: null, current: true, decision_support_document_id: null, decision_humana_fecha: null },
  { entry_id: 'accredited_experience', document_class: 'Experiencia acreditada', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'Sin caducidad general', expiry: null, current: true, decision_support_document_id: null, decision_humana_fecha: null },
];

const DOCUMENTS = [
  { id: 'doc-rce', document_type: 'rce_policy', display_name: 'Póliza RCE expediente Pereira 2026.zip', issued_at: '2026-02-10', expires_at: '2027-02-06', current: true, version: 1 },
  { id: 'doc-licencia', document_type: 'supervigilancia_operating_license', display_name: 'Licencia SuperVigilancia.pdf', issued_at: '2021-05-10', expires_at: '2029-05-10', current: true, version: 1 },
  // El caso real de la mejora 2: el listado de armas venció en agosto y nadie lo notó.
  { id: 'doc-armas', document_type: 'authorized_weapons_list', display_name: 'Listado de armas 2026-06-19.pdf', issued_at: '2026-06-19', expires_at: '2026-08-18', current: true, version: 1 },
  // Vence DESPUÉS de hoy pero ANTES del cierre: el que decide.
  { id: 'doc-vida', document_type: 'collective_life_policy', display_name: 'Póliza colectiva de vida.pdf', issued_at: '2025-11-02', expires_at: '2026-11-03', current: true, version: 1 },
];

test('la fecha de cierre que manda es raw.deadline, no la columna', () => {
  // Réplica deliberada de resolveCanonicalTenderDeadline: la columna es un timestamptz anclado a
  // medianoche UTC que se corre un día en Bogotá, y usarla daría avisos de "no llega al cierre" por
  // un día inventado. Si la original cambia, esta prueba debe fallar.
  assert.equal(agt002WatchCloseDate({ raw: { deadline: '2026-11-04' }, deadline_at: '2026-11-05T00:00:00.000Z' }), '2026-11-04');
  assert.equal(agt002WatchCloseDate({ raw: {}, deadline_at: '2026-11-05T00:00:00.000Z' }), '2026-11-05T00:00:00.000Z');
  assert.equal(agt002WatchCloseDate({ raw: { deadline: 'cuando la entidad decida' }, deadline_at: '2026-11-05T00:00:00.000Z' }), '2026-11-05T00:00:00.000Z');
  assert.equal(agt002WatchCloseDate({}), null);
});

test('avisa de lo vencido y de lo que no llega al cierre, en una línea por asunto', () => {
  const notices = agt002CompanyEvidenceNotices({ registry: REGISTRY, documents: DOCUMENTS, tender: TERMINAL, now: NOW });
  const codes = notices.map(notice => notice.code);

  assert.ok(codes.includes('ficha_vencida'), 'el listado de armas venció en agosto: eso se avisa');
  const vencida = notices.find(notice => notice.code === 'ficha_vencida');
  assert.match(vencida.text, /Listado de armas autorizadas/);
  assert.match(vencida.text, /2026-08-18/);
  assert.equal(vencida.severity, 'alta');

  assert.ok(codes.includes('ficha_no_llega_al_cierre'), 'la póliza de vida vence el 3 y el cierre es el 4');
  const noLlega = notices.find(notice => notice.code === 'ficha_no_llega_al_cierre');
  assert.match(noLlega.text, /vida colectiva|vida/i);
  assert.match(noLlega.text, /2026-11-04/, 'el aviso dice contra qué cierre');

  // Una línea por asunto, no una por documento: el aviso se agrega a diario.
  assert.equal(codes.filter(code => code === 'ficha_vencida').length, 1);
  assert.equal(codes.filter(code => code === 'ficha_no_llega_al_cierre').length, 1);
});

test('avisa de una decisión que no nombra su documento — el caso de la póliza RCE', () => {
  const unanchored = agt002EvidenceDecisionsWithoutAnchor({ registry: REGISTRY, documents: DOCUMENTS });
  assert.deepEqual(unanchored.map(item => item.entryId), ['rce_policy'],
    'sólo la RCE: la licencia sí nombra su documento y los pendientes no están decididos');
  assert.equal(unanchored[0].decidedAt, '2026-10-27');

  const notices = agt002CompanyEvidenceNotices({ registry: REGISTRY, documents: DOCUMENTS, tender: TERMINAL, now: NOW });
  const aviso = notices.find(notice => notice.code === 'aprobacion_sin_documento');
  assert.ok(aviso, 'una aprobación sin ancla se avisa');
  assert.match(aviso.text, /responsabilidad civil/i);
  assert.match(aviso.text, /monto asegurado/, 'el aviso dice por qué importó: nadie había leído el monto');
});

// --- Los silencios, que son la mitad del asunto -----------------------------------------------

test('un bloque sin documento cargado NO avisa: es el estado normal de una ficha que se llena', () => {
  const notices = agt002CompanyEvidenceNotices({ registry: REGISTRY, documents: DOCUMENTS, tender: TERMINAL, now: NOW });
  // `accredited_experience` está en el registro sin documento, y la mayoría de las 20 clases no
  // tienen archivo. Catorce líneas diarias por licitación enseñarían a ignorar el aviso.
  for (const notice of notices) {
    assert.doesNotMatch(notice.text, /sin archivo|no está cargado/i, `aviso de ruido: ${notice.text}`);
  }
  assert.ok(!notices.some(notice => notice.code === 'ficha_sin_archivo'));
});

test('una vigencia en prosa, sin fecha, NO avisa: no se alarma sobre lo que no se sabe', () => {
  const soloProsa = [{ entry_id: 'accredited_experience', document_class: 'Experiencia acreditada', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'Sin caducidad general', expiry: null, current: true }];
  const conDocumento = [{ id: 'doc-exp', document_type: 'accredited_experience', display_name: 'Experiencia.pdf', issued_at: '2026-01-01', expires_at: null, current: true, version: 1 }];
  const notices = agt002CompanyEvidenceNotices({ registry: soloProsa, documents: conDocumento, tender: TERMINAL, now: NOW });
  assert.deepEqual(notices, [], 'vigencia por confirmar es un desconocido, no una alarma');
});

test('un bloque aprobado SIN documento cargado no es este defecto: no hay nada contra qué confirmar', () => {
  const registry = [{ entry_id: 'quality_certifications', document_class: 'Certificaciones de calidad', existence_status: 'reported', human_review_status: 'approved', vigencia_text: 'BASC y tres ISO', expiry: '2027-06-17', current: true, decision_support_document_id: null }];
  assert.deepEqual(agt002EvidenceDecisionsWithoutAnchor({ registry, documents: [] }), []);
});

test('sin fecha de cierre no se concluye nada sobre llegar vigente al cierre', () => {
  const notices = agt002CompanyEvidenceNotices({ registry: REGISTRY, documents: DOCUMENTS, tender: { id: 't-2', raw: {}, deadline_at: null }, now: NOW });
  assert.deepEqual(notices, [], 'un proceso sin fecha es un problema del Radar, no de la ficha');
});

// --- La tercera regla: la fecha de la ficha contra el documento -------------------------------
//
// Hoy NO dispara en producción: el caso real —antecedentes con `expiry` 2026-08-29 y paquetes del
// 2026-09-02 y del 2026-10-17— se corrigió a mano en los datos el 2026-10-30. Es la guarda de que no
// vuelva a pasar en silencio.

test('una fecha registrada distinta a la del documento se denuncia, y manda el documento', () => {
  const registry = [{ entry_id: 'rce_policy', document_class: 'Póliza RCE', expiry: '2026-12-31', current: true, human_review_status: 'pending_human_review', existence_status: 'verified', vigencia_text: 'Póliza observada' }];
  const documents = [{ id: 'd1', document_type: 'rce_policy', display_name: 'RCE.pdf', issued_at: '2026-02-10', expires_at: '2027-02-06', current: true }];
  const found = agt002EvidenceDatesContradictingDocument({ registry, documents });
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'otra_fecha');
  assert.equal(found[0].registered, '2026-12-31');
  assert.equal(found[0].documentDate, '2027-02-06');

  const notices = agt002CompanyEvidenceNotices({ registry, documents, tender: TERMINAL, now: NOW });
  const aviso = notices.find(notice => notice.code === 'fecha_registrada_contradice_el_documento');
  assert.ok(aviso);
  assert.match(aviso.text, /la ficha dice que vence el 2026-12-31 y el documento dice el 2027-02-06/);
  assert.match(aviso.text, /Manda el documento/);
});

test('el caso real: una fecha observada anterior a la expedición del documento cargado', () => {
  // Antecedentes con ventana observada hasta el 2026-08-29 y un paquete del 2026-10-17.
  const registry = [{ entry_id: 'corporate_background_checks', document_class: 'Antecedentes de la persona jurídica', expiry: '2026-08-29', current: true, human_review_status: 'pending_human_review', existence_status: 'reported', vigencia_text: 'Ventana observada de 89 días' }];
  const documents = [{ id: 'd2', document_type: 'procuraduria_empresa', display_name: '05_Procuraduria_Empresa_2026-10-17.pdf', issued_at: '2026-10-17', expires_at: null, current: true }];
  const found = agt002EvidenceDatesContradictingDocument({ registry, documents });
  assert.equal(found.length, 1, 'el tipo legado tiene que resolverse al bloque, o el caso no se ve');
  assert.equal(found[0].kind, 'anterior_al_documento');
  assert.equal(found[0].registered, '2026-08-29');
  assert.equal(found[0].documentDate, '2026-10-17');
});

test('una ficha coherente con su documento no se denuncia', () => {
  // Los cuatro bloques de producción que tienen fecha y documento son coherentes (medido 2026-11-01).
  const registry = [
    { entry_id: 'rce_policy', document_class: 'Póliza RCE', expiry: '2027-02-06', current: true },
    { entry_id: 'supervigilancia_operating_license', document_class: 'Licencia SuperVigilancia', expiry: '2029-05-10', current: true },
  ];
  const documents = [
    { id: 'd1', document_type: 'rce_policy', issued_at: '2026-02-10', expires_at: '2027-02-06', current: true },
    { id: 'd2', document_type: 'supervigilancia_operating_license', issued_at: '2021-02-11', expires_at: '2029-05-10', current: true },
  ];
  assert.deepEqual(agt002EvidenceDatesContradictingDocument({ registry, documents }), []);
});

test('sin fecha registrada no hay contradicción posible: no se alarma sobre la prosa', () => {
  const registry = [{ entry_id: 'corporate_background_checks', document_class: 'Antecedentes', expiry: null, current: true, vigencia_text: 'Paquetes posteriores localizados el 2026-10-30' }];
  const documents = [{ id: 'd1', document_type: 'procuraduria_empresa', issued_at: '2026-10-17', expires_at: null, current: true }];
  assert.deepEqual(agt002EvidenceDatesContradictingDocument({ registry, documents }), [],
    'así quedó el caso real tras corregirse a mano: fecha en nulo y prosa');
});

test('un bloque decidido con soporte bajo tipo legado también se revisa el ancla', () => {
  // Antes el ancla comparaba el tipo de forma exacta, así que un soporte cargado como `certificado`
  // no se revisaba: el bloque podía figurar aprobado sin ancla y nadie lo veía.
  const registry = [{ entry_id: 'chamber_of_commerce', document_class: 'Cámara de Comercio', expiry: null, current: true, human_review_status: 'approved', decision_support_document_id: null, existence_status: 'verified', vigencia_text: 'No vence por sí mismo' }];
  const documents = [{ id: 'cc-1', document_type: 'certificado', display_name: 'CC.pdf', issued_at: '2026-10-06', expires_at: null, current: true }];
  const unanchored = agt002EvidenceDecisionsWithoutAnchor({ registry, documents });
  assert.deepEqual(unanchored.map(item => item.entryId), ['chamber_of_commerce']);
});

// --- La ceguera dicha en voz alta: el caso que la primera versión NO detectaba ----------------
//
// El listado de armas venció el 2026-08-18 y la vigilancia no lo vio, porque en producción su
// vigencia vive sólo como prosa —«Expedido 2026-06-19; vigencia declarada de 60 días»— sin fecha y
// sin documento cargado. Derivar la fecha de la prosa es la fecha adivinada que la casa prohíbe. Lo
// que sí se puede afirmar es que el bloque declara una vida finita y nadie la vigila.

test('un bloque con plazo declarado en prosa y sin fecha se denuncia como no vigilable', () => {
  const registry = [
    { entry_id: 'authorized_weapons_list', document_class: 'Listado de armas autorizadas', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'Expedido 2026-06-19; vigencia declarada de 60 días', expiry: null, current: true },
    { entry_id: 'no_fines_sanctions_certificate', document_class: 'Certificado de multas y sanciones', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'Expedido 2026-06-18; vigencia declarada de 90 días hábiles', expiry: null, current: true },
  ];
  const notices = agt002CompanyEvidenceNotices({ registry, documents: [], tender: TERMINAL, now: NOW });
  const ciego = notices.find(notice => notice.code === 'vigencia_solo_en_prosa');
  assert.ok(ciego, 'la ceguera se dice, no se calla');
  assert.equal(ciego.severity, 'media', 'es un hueco de dato, no un vencimiento comprobado');
  assert.match(ciego.text, /Listado de armas/);
  assert.match(ciego.text, /multas y sanciones/);
  assert.match(ciego.text, /60 días/, 'se cita la prosa tal cual, sin interpretarla');
  // Y no se inventa ninguna fecha de vencimiento.
  assert.doesNotMatch(ciego.text, /2026-08-18|vence el/, 'no se calcula la fecha que la prosa no da');
  assert.ok(!notices.some(notice => notice.code === 'ficha_vencida'), 'sin fecha no se afirma un vencimiento');
});

test('una prosa sin plazo en días sigue siendo un desconocido y no se denuncia', () => {
  const registry = [
    { entry_id: 'accredited_experience', document_class: 'Experiencia acreditada', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'Sin caducidad general; correspondencia contractual por requisito', expiry: null, current: true },
    { entry_id: 'bank_certificate', document_class: 'Certificación bancaria', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'Expedida 2026-06-22; vigencia práctica dependiente del pliego', expiry: null, current: true },
  ];
  const notices = agt002CompanyEvidenceNotices({ registry, documents: [], tender: TERMINAL, now: NOW });
  assert.deepEqual(notices, [], 'una vigencia que de verdad nadie sabe no es una ceguera nuestra');
});

test('un bloque con fecha registrada no se denuncia como no vigilable: ya está vigilado', () => {
  const registry = [{ entry_id: 'rce_policy', document_class: 'Póliza RCE', existence_status: 'verified', human_review_status: 'pending_human_review', vigencia_text: 'Póliza observada: 2026-02-06 a 2027-02-06, con 365 días de cobertura', expiry: '2027-02-06', current: true }];
  const documents = [{ id: 'doc-rce', document_type: 'rce_policy', issued_at: '2026-02-10', expires_at: '2027-02-06', current: true, version: 1 }];
  const notices = agt002CompanyEvidenceNotices({ registry, documents, tender: TERMINAL, now: NOW });
  assert.ok(!notices.some(notice => notice.code === 'vigencia_solo_en_prosa'));
});

// --- La revisión programada -------------------------------------------------------------------

function fakeDatabase({ registry = REGISTRY, documents = DOCUMENTS, tenders = [TERMINAL] } = {}) {
  return {
    from(table) {
      const rows = table === 'psi_agt002_company_evidence_registry' ? registry
        : table === 'psi_company_procurement_documents' ? documents
        : tenders;
      const builder = {
        select: () => builder,
        eq: () => builder,
        limit: () => Promise.resolve({ data: rows, error: null }),
        then: (resolve) => resolve({ data: rows, error: null }),
      };
      return builder;
    },
  };
}

test('la revisión deja el aviso como línea en la oportunidad y nunca marca evidencia como verificada', async () => {
  const lines = [];
  const events = await runAgt002CompanyEvidenceWatch(fakeDatabase(), {
    now: NOW, appendLine: async (_db, opportunityId, line) => { lines.push({ opportunityId, line }); },
  });
  assert.ok(lines.length >= 2, 'se escribieron los avisos');
  assert.ok(lines.every(entry => entry.opportunityId === 'opp-terminal'));
  const codes = events.filter(event => event.event === 'agt002_company_evidence_watch_notice').map(event => event.code);
  assert.ok(codes.includes('ficha_vencida') && codes.includes('aprobacion_sin_documento'));
  // Custodia: la revisión sólo lee y agrega líneas. Nada de decisiones de evidencia.
  assert.ok(events.every(event => !/decision|verif|approve/i.test(event.event)));
});

test('un cierre que ya pasó no admite avisos: lo que no se reexpidió ya no se reexpide', async () => {
  const vencido = { ...TERMINAL, raw: { deadline: '2026-10-20' }, deadline_at: '2026-10-20T00:00:00.000Z' };
  const lines = [];
  const events = await runAgt002CompanyEvidenceWatch(fakeDatabase({ tenders: [vencido] }), {
    now: NOW, appendLine: async (_db, _id, line) => { lines.push(line); },
  });
  assert.deepEqual(lines, []);
  assert.ok(events.some(event => event.event === 'agt002_company_evidence_watch_closed'));
});

test('una licitación que no se puede leer no corta las demás', async () => {
  const rota = { id: 't-rota', ref: 'ROTA', converted_opportunity_id: 'opp-rota', raw: { deadline: '2026-11-04' } };
  const lines = [];
  const events = await runAgt002CompanyEvidenceWatch(fakeDatabase({ tenders: [rota, TERMINAL] }), {
    now: NOW,
    inactiveReason: async (_db, opportunityId) => { if (opportunityId === 'opp-rota') throw new Error('lectura rota'); return false; },
    appendLine: async (_db, opportunityId, line) => { lines.push({ opportunityId, line }); },
  });
  assert.ok(events.some(event => event.event === 'agt002_company_evidence_watch_failed'));
  assert.ok(lines.some(entry => entry.opportunityId === 'opp-terminal'), 'la otra licitación sí recibió sus avisos');
});

test('una oportunidad inactiva se salta sin avisar', async () => {
  const lines = [];
  await runAgt002CompanyEvidenceWatch(fakeDatabase(), {
    now: NOW, inactiveReason: async () => true, appendLine: async (_db, _id, line) => { lines.push(line); },
  });
  assert.deepEqual(lines, []);
});
