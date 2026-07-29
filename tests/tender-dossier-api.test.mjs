import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const OPP = '22222222-2222-4222-8222-222222222222';
const ITEM = '33333333-3333-4333-8333-333333333333';
const ARTIFACT = '44444444-4444-4444-8444-444444444444';
const VERSION = '55555555-5555-4555-8555-555555555555';
const director = {
  id: '11111111-1111-4111-8111-111111111111', role: 'director', active: true,
  identity_type: 'human', permissions: ['licitaciones'], areas: ['licitacion_publica'],
};
const commercial = {
  id: '66666666-6666-4666-8666-666666666666', role: 'comercial', active: true,
  identity_type: 'human', permissions: ['licitaciones'], areas: ['licitacion_publica'],
};
const outsider = {
  id: '99999999-9999-4999-8999-999999999999', role: 'colaborador', active: true,
  identity_type: 'human', permissions: [], areas: [],
};

function fakeDb(reply = () => ({}), failure = null) {
  return {
    calls: [],
    async rpc(name, args) {
      this.calls.push({ name, args });
      return failure ? { data: null, error: failure } : { data: reply(name, args), error: null };
    },
  };
}

let adapter;
try {
  adapter = await import('../tender-dossier-rpc.js');
} catch (error) {
  assert.fail(`RED esperado: falta adapter tender-dossier-rpc.js: ${error.message}`);
}

const {
  getTenderDossierWorkspace,
  callCreateTenderDossierItem,
  callAppendTenderDossierItemAction,
  callCreateTenderDossierArtifact,
  callAddTenderDossierArtifactVersion,
  callRecordTenderDossierArtifactReview,
  callSeedTenderDossier,
} = adapter;

await (async function rejectsUnauthorizedBeforeDb() {
  const db = fakeDb();
  await assert.rejects(
    () => callCreateTenderDossierItem(db, {
      opportunity_id: OPP, item_key: 'k', title: 'Título', item_type: 'general', required: false,
    }, outsider),
    error => error?.status === 403,
  );
  assert.equal(db.calls.length, 0);
})();

await (async function createsItemWithAuthenticatedActorOnly() {
  const db = fakeDb(() => ({ item: { id: ITEM } }));
  await callCreateTenderDossierItem(db, {
    opportunity_id: OPP, actor_id: outsider.id, item_key: 'validar_experiencia',
    title: 'Validar experiencia', item_type: 'pendiente_humano', required: true,
  }, commercial);
  assert.deepEqual(db.calls[0], {
    name: 'psi_create_tender_dossier_item',
    args: {
      p_opportunity_id: OPP,
      p_actor_id: commercial.id,
      p_item_key: 'validar_experiencia',
      p_title: 'Validar experiencia',
      p_item_type: 'pendiente_humano',
      p_required: true,
    },
  });
})();

await (async function readsWorkspaceAndComputesManagerGate() {
  const db = fakeDb(() => ({ checklist: [], artifacts: [], readiness: { ready: true } }));
  const workspace = await getTenderDossierWorkspace(db, OPP, director);
  assert.deepEqual(db.calls[0], {
    name: 'psi_get_tender_dossier_workspace',
    args: { p_opportunity_id: OPP },
  });
  assert.equal(workspace.can_mark_ready, true);
  assert.equal(workspace.workbench_enabled, false);

  const dbCommercial = fakeDb(() => ({ checklist: [], artifacts: [], readiness: { ready: true } }));
  const commercialWorkspace = await getTenderDossierWorkspace(dbCommercial, OPP, commercial);
  assert.equal(commercialWorkspace.can_mark_ready, false);
})();

await (async function workbenchEnabledFlagIsServerLiteral() {
  const db = fakeDb(() => ({ checklist: [], artifacts: [], readiness: { ready: true }, workbench_enabled: true }));
  const workspace = await getTenderDossierWorkspace(db, OPP, director);
  assert.equal(workspace.workbench_enabled, false, 'workbench_enabled debe ser un literal del servidor, no de la BD ni del cliente');
})();

await (async function noAplicaRequiresManagerBeforeDb() {
  const input = {
    opportunity_id: OPP, item_id: ITEM, action_type: 'marked_not_applicable',
    justification: 'No corresponde al objeto contractual.',
  };
  const db = fakeDb();
  await assert.rejects(() => callAppendTenderDossierItemAction(db, input, commercial), error => error?.status === 403);
  assert.equal(db.calls.length, 0);

  await callAppendTenderDossierItemAction(db, input, director);
  assert.equal(db.calls[0].name, 'psi_append_tender_dossier_item_action');
  assert.equal(db.calls[0].args.p_actor_id, director.id);
  assert.equal(db.calls[0].args.p_justification, input.justification);
})();

await (async function evidenceUrlMustBeHttps() {
  const db = fakeDb();
  await assert.rejects(
    () => callAppendTenderDossierItemAction(db, {
      opportunity_id: OPP, item_id: ITEM, action_type: 'evidence_attached',
      evidence_kind: 'url', evidence_url: 'javascript:alert(1)',
    }, commercial),
    error => error?.status === 400 && /https/i.test(error.message),
  );
  assert.equal(db.calls.length, 0);
})();

await (async function artifactVersionAndReviewUseAuthenticatedActor() {
  const db = fakeDb(() => ({ artifact: { id: ARTIFACT } }));
  await callCreateTenderDossierArtifact(db, {
    opportunity_id: OPP, artifact_key: 'carta', title: 'Carta', required: true,
  }, commercial);
  await callAddTenderDossierArtifactVersion(db, {
    opportunity_id: OPP, artifact_id: ARTIFACT, content_kind: 'texto', content_text: 'Versión humana',
  }, commercial);
  await callRecordTenderDossierArtifactReview(db, {
    opportunity_id: OPP, version_id: VERSION, actor_id: outsider.id,
    decision: 'aprobado', comment: 'Revisado',
  }, director);
  assert.equal(db.calls[2].name, 'psi_record_tender_dossier_artifact_review');
  assert.equal(db.calls[2].args.p_actor_id, director.id);
})();

await (async function managerOnlyReviewAndSeed() {
  const reviewDb = fakeDb();
  await assert.rejects(
    () => callRecordTenderDossierArtifactReview(reviewDb, { version_id: VERSION, decision: 'aprobado' }, commercial),
    error => error?.status === 403,
  );
  const seedDb = fakeDb();
  await assert.rejects(
    () => callSeedTenderDossier(seedDb, { opportunity_id: OPP }, commercial),
    error => error?.status === 403,
  );
  assert.equal(reviewDb.calls.length + seedDb.calls.length, 0);
})();

await (async function mapsDatabaseErrors() {
  const forbidden = fakeDb(undefined, { code: '42501', message: 'denied' });
  await assert.rejects(() => getTenderDossierWorkspace(forbidden, OPP, director), error => error?.status === 403);
  const gate = fakeDb(undefined, { code: '23514', message: 'not ready' });
  await assert.rejects(
    () => callSeedTenderDossier(gate, { opportunity_id: OPP }, director),
    error => error?.status === 409,
  );
})();

await (async function backendsRegisterSevenRoutesWithParity() {
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const vercel = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
  assert.equal(vercel, server, 'server/index.js y api/[...path].js deben ser byte-idénticos');
  assert.match(server, /from '\.\.\/tender-dossier-rpc\.js'/);
  const routes = [
    "app.get('/api/tender-dossier-workspace'",
    "app.post('/api/tender-dossier-item'",
    "app.post('/api/tender-dossier-item-action'",
    "app.post('/api/tender-dossier-artifact'",
    "app.post('/api/tender-dossier-artifact-version'",
    "app.post('/api/tender-dossier-artifact-review'",
    "app.post('/api/tender-dossier-seed'",
  ];
  for (const route of routes) assert.ok(server.includes(route), `falta ruta ${route}`);
  for (const eventType of ['dossier_seeded', 'dossier_artifact_approved', 'offer_ready_for_submission']) {
    assert.match(server, new RegExp(`TENDER_BUSINESS_EVENT_TYPES[\\s\\S]*?'${eventType}'`), `${eventType} debe estar visible en el historial comercial`);
  }
})();

console.log('tender dossier adapter + routes passed');
