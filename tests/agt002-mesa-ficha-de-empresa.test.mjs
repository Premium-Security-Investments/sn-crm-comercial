// AGT-002 — la ficha de empresa viaja a la Mesa (punto 1 del encargo del 2026-10-30, por el catálogo de fuentes).
//
// Lo que fija, y es lo que evita que afirmemos en una licitación algo que nadie verificó:
//   1. la vigencia se calcula contra la FECHA DE CIERRE del proceso, no contra hoy, y la fecha autoritativa es
//      `raw.deadline`;
//   2. un bloque pendiente de confirmación humana **no sostiene una afirmación**, por más texto de vigencia que
//      tenga (`sostiene_afirmacion` sale en falso);
//   3. una vigencia que hay que interpretar viaja como prosa, y la prosa tampoco sostiene;
//   4. pertinencia, no volcado: la pregunta selecciona, y el total siempre viaja;
//   5. los bloques con datos de personas no viajan;
//   6. la Mesa pide los seis datos declarados y le pasa la pregunta al catálogo.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DATOS, ESTADOS, FORMAS, minimizarFuentes, puedeLeer, resolverEvidenciaAlCierre, resolverExperiencia, sostieneAfirmacion,
} from '../catalogo-fuentes.js';
import { AGT002_MESA_FUENTES } from '../verticales/licitaciones/agt002-workbench-runtime.js';

const TENDER = 'f5094a70-f56e-4a2a-96e6-50787e02efe7';

// Registro y documentos reales de producción (2026-10-30), recortados a lo que la prueba necesita.
const REGISTRO = [
  { entry_id: 'rce_policy', document_class: 'Póliza de responsabilidad civil extracontractual', existence_status: 'verified', human_review_status: 'approved', vigencia_text: 'Póliza 2026-02-06 a 2027-02-06', expiry: '2027-02-06' },
  { entry_id: 'quality_certifications', document_class: 'Certificaciones de calidad', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'BASC vence 2027-06-17; las ISO 2028-12-22', expiry: '2027-06-17' },
  { entry_id: 'chamber_of_commerce', document_class: 'Cámara de Comercio', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'No vence por sí mismo: caduca su antigüedad', expiry: null },
  { entry_id: 'legal_representative_vault', document_class: 'Documentos del representante legal', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'Paquetes de septiembre y octubre', expiry: null },
  { entry_id: 'personnel_credentials_vault', document_class: 'Credenciales del personal', existence_status: 'reported', human_review_status: 'pending_human_review', vigencia_text: 'Depende de cada credencial', expiry: null },
];
const DOCUMENTOS = [
  { id: 'doc-rce', document_type: 'rce_policy', display_name: 'Póliza RCE 2026.zip', issued_at: '2026-02-10', expires_at: '2027-02-06', current: true, version: 1 },
  { id: 'doc-cc', document_type: 'certificado', display_name: 'CC 2026-10-06.pdf', issued_at: '2026-10-06', expires_at: null, current: true, version: 1 },
];
const EXPERIENCIA = [
  { rup_number: 12, contracting_party: 'MEGABUS S.A.', contract_object: 'Vigilancia y seguridad privada', value_smmlv: 4200, value_cop: null, contract_year: 2024, updated_at: '2026-10-28T00:00:00Z' },
  { rup_number: 8, contracting_party: 'MUNICIPIO DE PEREIRA', contract_object: 'Servicio de vigilancia con medios tecnológicos', value_smmlv: 3100, value_cop: null, contract_year: 2023, updated_at: '2026-10-28T00:00:00Z' },
  { rup_number: 3, contracting_party: 'TERMINAL DE TRANSPORTE', contract_object: 'Vigilancia fija', value_smmlv: 900, value_cop: null, contract_year: 2022, updated_at: '2026-10-20T00:00:00Z' },
];

function fakeDatabase({ raw = { deadline: '2026-11-04' }, deadlineAt = '2026-11-04T00:00:00Z', registro = REGISTRO, documentos = DOCUMENTOS, experiencia = EXPERIENCIA } = {}) {
  return {
    from(table) {
      if (table === 'psi_public_tenders') {
        const chain = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: { deadline_at: deadlineAt, raw }, error: null }) };
        return chain;
      }
      if (table === 'psi_agt002_company_evidence_registry') {
        const chain = { select: () => chain, eq: () => chain, then: (resolve) => resolve({ data: registro, error: null }) };
        return chain;
      }
      if (table === 'psi_company_procurement_documents') {
        const chain = { select: () => chain, eq: () => chain, then: (resolve) => resolve({ data: documentos, error: null }) };
        return chain;
      }
      if (table === 'psi_company_experience') {
        const chain = { select: () => chain, order: () => Promise.resolve({ data: experiencia, error: null }) };
        return chain;
      }
      throw new Error(`tabla inesperada: ${table}`);
    },
  };
}

test('la vigencia se mide contra el cierre del proceso y `raw.deadline` manda', async () => {
  const resuelto = await resolverEvidenciaAlCierre(fakeDatabase(), { tenderId: TENDER, pregunta: '¿la póliza RCE llega vigente al cierre?' });
  assert.equal(resuelto.valor.cierre_del_proceso, '2026-11-04');
  // `deadline_at` dice otra cosa y no manda: la autoridad es la fecha de calendario exacta de `raw`.
  const corrido = await resolverEvidenciaAlCierre(
    fakeDatabase({ raw: { deadline: '2026-11-04' }, deadlineAt: '2026-11-03T00:00:00Z' }),
    { tenderId: TENDER, pregunta: 'póliza' },
  );
  assert.equal(corrido.valor.cierre_del_proceso, '2026-11-04');
});

test('un bloque confirmado y vigente al cierre sostiene una afirmación', async () => {
  const resuelto = await resolverEvidenciaAlCierre(fakeDatabase(), { tenderId: TENDER, pregunta: 'responsabilidad civil' });
  assert.deepEqual(resuelto.valor.bloques.map(bloque => bloque.bloque), ['rce_policy']);
  assert.equal(resuelto.valor.bloques[0].estado_al_cierre, 'listo_al_cierre');
  assert.equal(resuelto.valor.bloques[0].confirmado_por_una_persona, true);
  assert.equal(resuelto.estado, ESTADOS.VIGENTE);
  assert.equal(resuelto.forma, FORMAS.TIPADO);
  assert.equal(sostieneAfirmacion(resuelto), true);
});

test('un bloque pendiente de confirmación NO sostiene, aunque tenga fecha de vigencia', async () => {
  // El BASC vence el 2027-06-17, mucho después del cierre, pero nadie confirmó el bloque y el soporte no está.
  const resuelto = await resolverEvidenciaAlCierre(fakeDatabase(), { tenderId: TENDER, pregunta: '¿el BASC llega vigente al cierre?' });
  assert.deepEqual(resuelto.valor.bloques.map(bloque => bloque.bloque), ['quality_certifications']);
  assert.equal(resuelto.valor.bloques[0].confirmado_por_una_persona, false);
  assert.equal(resuelto.estado, ESTADOS.NO_VERIFICADO);
  assert.equal(sostieneAfirmacion(resuelto), false, 'es el control que evita afirmar lo que nadie verificó');
});

test('una vigencia que hay que interpretar viaja como prosa y tampoco sostiene', async () => {
  const resuelto = await resolverEvidenciaAlCierre(fakeDatabase(), { tenderId: TENDER, pregunta: 'cámara de comercio' });
  assert.equal(resuelto.valor.bloques[0].bloque, 'chamber_of_commerce');
  assert.equal(resuelto.valor.bloques[0].estado_al_cierre, 'vigencia_por_confirmar');
  assert.match(resuelto.valor.bloques[0].vigencia_declarada, /caduca su antigüedad/);
  assert.equal(resuelto.forma, FORMAS.PROSA);
  assert.equal(resuelto.requiere_interpretacion, true);
  assert.equal(sostieneAfirmacion(resuelto), false);
});

test('sin pregunta que nombre documentos, responde lo que está en riesgo, no todo', async () => {
  const resuelto = await resolverEvidenciaAlCierre(fakeDatabase(), { tenderId: TENDER, pregunta: '¿cómo vamos?' });
  assert.ok(resuelto.valor.bloques.length <= 6, 'nunca se vuelca la ficha entera');
  assert.ok(resuelto.valor.bloques.every(bloque => bloque.estado_al_cierre !== 'listo_al_cierre'));
  // El total siempre viaja, para que la muestra no se lea como si fuera todo. Son las clases canónicas del puente
  // —20, con o sin entrada en el registro, porque una clase sin registro es justo la que sale "sin soporte"— menos
  // los dos bloques de personas.
  assert.equal(resuelto.valor.bloques_de_la_ficha, 18);
  assert.equal(resuelto.valor.listos_al_cierre, 1, 'sólo la póliza RCE llega vigente al cierre');
  assert.equal(resuelto.valor.bloques_mirados, 6, 'la respuesta se acota aunque haya más en riesgo');
});

test('los bloques con datos de personas no viajan a la Mesa', async () => {
  for (const pregunta of ['representante legal', 'credenciales del personal', 'hojas de vida']) {
    const resuelto = await resolverEvidenciaAlCierre(fakeDatabase(), { tenderId: TENDER, pregunta });
    const bloques = resuelto.valor.bloques.map(bloque => bloque.bloque);
    assert.ok(!bloques.includes('legal_representative_vault'), pregunta);
    assert.ok(!bloques.includes('personnel_credentials_vault'), pregunta);
  }
});

test('sin fecha de cierre no se inventa una vigencia', async () => {
  const resuelto = await resolverEvidenciaAlCierre(fakeDatabase({ raw: {}, deadlineAt: null }), { tenderId: TENDER, pregunta: 'BASC' });
  assert.equal(resuelto.valor, null);
  assert.equal(resuelto.estado, ESTADOS.NO_VERIFICADO);
  assert.match(resuelto.procedencia.nota, /no tiene fecha de cierre/);
  assert.equal(sostieneAfirmacion(resuelto), false);
});

test('la experiencia se selecciona por la pregunta y el total siempre viaja', async () => {
  const porPregunta = await resolverExperiencia(fakeDatabase(), { pregunta: '¿tenemos experiencia con Megabus?' });
  assert.equal(porPregunta.valor.total_inscritas_en_el_crm, 3);
  assert.equal(porPregunta.valor.seleccionadas_por_la_pregunta, true);
  assert.deepEqual(porPregunta.valor.experiencias.map(item => item.contratante), ['MEGABUS S.A.']);

  const sinPregunta = await resolverExperiencia(fakeDatabase(), { pregunta: '¿cómo vamos?' });
  assert.equal(sinPregunta.valor.seleccionadas_por_la_pregunta, false);
  assert.equal(sinPregunta.valor.experiencias.length, 3, 'las de mayor valor, acotadas');
  assert.equal(sinPregunta.estado, ESTADOS.VIGENTE);
});

test('la Mesa pide los seis datos y los puede leer', () => {
  assert.deepEqual(AGT002_MESA_FUENTES, [
    'empresa.identidad', 'empresa.codigos_rup', 'analisis.canonico.company_fit',
    'empresa.sedes', 'empresa.evidencia_al_cierre', 'empresa.experiencia',
  ]);
  for (const nombre of AGT002_MESA_FUENTES) {
    assert.ok(DATOS[nombre], `${nombre} debe estar declarado en el catálogo`);
    assert.equal(puedeLeer(nombre, 'agt002.mesa'), true, `${nombre} debe ser legible por la Mesa`);
  }
  // Los dos datos nuevos tienen responsable humano: sin él el catálogo los sirve como no_verificado.
  assert.equal(DATOS['empresa.evidencia_al_cierre'].responsable, 'Katherine');
  assert.equal(DATOS['empresa.experiencia'].responsable, 'Katherine');
});

test('así es como la Mesa recibe el dato: con sostiene_afirmacion adentro', async () => {
  const resuelto = await resolverEvidenciaAlCierre(fakeDatabase(), { tenderId: TENDER, pregunta: 'BASC' });
  const [minimizado] = minimizarFuentes([{ ...resuelto, sensibilidad: 'interna', responsable: 'Katherine' }]);
  assert.equal(minimizado.nombre, 'empresa.evidencia_al_cierre');
  assert.equal(minimizado.sostiene_afirmacion, false);
  assert.equal(minimizado.responsable, 'Katherine');
  assert.match(minimizado.valor, /quality_certifications/);
  assert.match(minimizado.procedencia, /Ley 1581/);
});

// --- La pregunta llega al catálogo -------------------------------------------------------------------------------
// La pertinencia no sirve de nada si el resolvedor no sabe qué se preguntó. El responder le pasa `message` al
// catálogo, igual que ya le pasaba la licitación.
test('el responder le pasa la pregunta y la licitación al catálogo', async () => {
  const { createAgt002WorkbenchResponder } = await import('../verticales/licitaciones/agt002-workbench-responder.js');
  const visto = [];
  const responder = createAgt002WorkbenchResponder({
    client: {
      run: () => Promise.resolve({
        content: JSON.stringify({ content_text: 'Respuesta.', source_links: [], missing_information: [], required_actions: [] }),
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    },
    model: 'modelo-de-prueba',
    timeoutMs: 1000,
    checkGate: () => true,
    resolveSources: args => { visto.push(args); return []; },
  });
  await responder.respond({
    job_id: '20000000-0000-4000-8000-000000000001',
    thread_id: '20000000-0000-4000-8000-000000000002',
    origin_message_id: '20000000-0000-4000-8000-000000000003',
    opportunity_id: '20000000-0000-4000-8000-000000000004',
    tender_id: TENDER,
    snapshot_id: '20000000-0000-4000-8000-000000000006',
    base_version_id: null,
    capability_id: 'agt002.dossier-workbench.reply.v1',
    contract_version: 'agt002.dossier-workbench.v1',
    policy_version: 'agt002.dossier-workbench.policy.v1',
    context_links: [{ kind: 'source', id: '20000000-0000-4000-8000-000000000009', label: 'Pliego', source_ref: 'documento:pliego#1' }],
    message: '¿El BASC llega vigente al cierre?',
  });
  assert.equal(visto.length, 1);
  assert.equal(visto[0].tenderId, TENDER);
  assert.equal(visto[0].message, '¿El BASC llega vigente al cierre?');
  assert.equal(visto[0].capabilityId, 'agt002.dossier-workbench.reply.v1');
});
