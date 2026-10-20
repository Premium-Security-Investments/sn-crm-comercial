// El acta se redacta en el momento del cierre (Juan, 2026-10-19). Lo que esta
// prueba protege: que un fallo del acta NUNCA rompa el cierre, que con la Mesa
// apagada no se invoque al modelo, y que sólo los cierres de verdad la disparen.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { draftClosureActaAfterClosure, sweepTenderClosureActas } from '../agt002-closure-acta-live.js';

const CALI = '44444444-4444-4444-8444-444444444444';
const VIGIA = 'a0020000-0000-4000-8000-000000000002';

const acta = {
  decision_summary: 'No nos presentamos: es tecnología, no vigilancia.',
  reasons: ['Es de tecnología y no de vigilancia'],
  requirements_unmet: [],
  factors_against: [],
  gaps_to_compete: [],
  recommendation: null,
  system_lesson: null,
};

const pendingRow = {
  opportunity_id: CALI,
  tender_id: '66666666-6666-4666-8666-666666666666',
  closure_kind: 'cerrada_no_go',
  closing_note: 'Es un proceso 100% de tecnología y aún no cumplimos los requisitos.',
  tender_name: 'Cali — Secretaría de Seguridad',
  analysis_result: null,
};

// La Mesa configurada, con los nombres que exige getAgt002WorkbenchRuntimeConfig.
const CONFIGURED = Object.freeze({
  AGT002_WORKBENCH_RUNTIME: 'agt002_workbench_bridge_v1',
  AGT002_WORKBENCH_DRAIN_ENABLED: 'true',
  AGT002_WORKBENCH_MODEL: 'claude-prueba',
  AGT002_HETZNER_BRIDGE_URL: 'https://puente.example.com/run',
  AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'x'.repeat(48),
  AGT002_WORKBENCH_AGENT_ID: VIGIA,
  AGT002_WORKBENCH_WORKER_ID: 'prueba',
});

function fakeDatabase(rows = [pendingRow]) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'psi_list_tender_closure_acta_pending') return { data: rows, error: null };
      if (name === 'psi_upsert_tender_closure_acta') return { data: null, error: null };
      throw new Error(`rpc inesperada: ${name}`);
    },
  };
}
const bridgeClient = (content = acta) => ({ async run() { return { content: JSON.stringify(content), usage: { input_tokens: 1, output_tokens: 2 } }; } });

test('con la Mesa apagada no se invoca al modelo ni se escribe nada', async () => {
  const database = fakeDatabase();
  const result = await draftClosureActaAfterClosure(database, CALI, { environment: { ...CONFIGURED, AGT002_WORKBENCH_DRAIN_ENABLED: 'false' }, log: () => {} });
  assert.deepEqual(result, { status: 'skipped', reason: 'apagada' });
  assert.equal(database.calls.length, 0);
});

test('sin oportunidad no hace nada', async () => {
  const database = fakeDatabase();
  for (const id of [null, undefined, '', '   ']) {
    assert.deepEqual(await draftClosureActaAfterClosure(database, id, { environment: CONFIGURED, log: () => {} }), { status: 'skipped', reason: 'sin_oportunidad' });
  }
  assert.equal(database.calls.length, 0);
});

test('en el cierre se redacta el acta de esa licitación, como Vig-IA y en borrador', async () => {
  const database = fakeDatabase();
  const result = await draftClosureActaAfterClosure(database, CALI, { environment: CONFIGURED, bridgeClient: bridgeClient(), log: () => {} });
  assert.equal(result.status, 'drafted');
  assert.equal(result.drafted, 1);
  const write = database.calls.find(call => call.name === 'psi_upsert_tender_closure_acta');
  assert.equal(write.args.p_opportunity_id, CALI);
  assert.equal(write.args.p_actor_id, VIGIA);
  assert.equal(write.args.p_expected_updated_at, null);
  assert.equal(write.args.p_payload.decision_quote, pendingRow.closing_note, 'la cita es la nota de la persona');
  assert.ok(!database.calls.some(call => call.name.includes('confirm')), 'Vig-IA nunca confirma');
});

test('sólo se redacta la licitación que se acaba de cerrar, no las demás pendientes', async () => {
  const otra = { ...pendingRow, opportunity_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tender_name: 'Otra' };
  const database = fakeDatabase([otra, pendingRow]);
  const result = await draftClosureActaAfterClosure(database, CALI, { environment: CONFIGURED, bridgeClient: bridgeClient(), log: () => {} });
  assert.equal(result.drafted, 1);
  const writes = database.calls.filter(call => call.name === 'psi_upsert_tender_closure_acta');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].args.p_opportunity_id, CALI);
});

test('una licitación que todavía no está en la lista de pendientes no es un error', async () => {
  const database = fakeDatabase([]);
  const result = await draftClosureActaAfterClosure(database, CALI, { environment: CONFIGURED, bridgeClient: bridgeClient(), log: () => {} });
  assert.equal(result.status, 'pending');
  assert.equal(result.drafted, 0);
});

test('si el acta falla, el cierre no se rompe: devuelve el fallo y lo registra sin contenido', async () => {
  const events = [];
  const roto = { async run() { throw Object.assign(new Error('el puente no responde'), { code: 'BRIDGE_DOWN' }); } };
  const result = await draftClosureActaAfterClosure(fakeDatabase(), CALI, { environment: CONFIGURED, bridgeClient: roto, log: event => events.push(event) });
  assert.equal(result.status, 'failed');
  const failure = events.find(event => event.event === 'agt002_closure_acta_failed' || event.event === 'agt002_closure_acta_live_failed');
  assert.ok(failure, 'la falla queda registrada');
  assert.ok(!JSON.stringify(events).includes('decision_summary'), 'el registro no lleva contenido del acta');

  // La Mesa a medio configurar tampoco tumba el cierre: el interruptor valida la
  // configuración completa, así que ni siquiera se intenta.
  const database = fakeDatabase();
  const sinConfigurar = await draftClosureActaAfterClosure(database, CALI, { environment: { AGT002_WORKBENCH_RUNTIME: 'agt002_workbench_bridge_v1', AGT002_WORKBENCH_DRAIN_ENABLED: 'true' }, log: () => {} });
  assert.deepEqual(sinConfigurar, { status: 'skipped', reason: 'apagada' });
  assert.equal(database.calls.length, 0);
});

test('los tres cierres la disparan y ninguno deja caer el pedido', () => {
  const server = fs.readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
  const mirror = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.equal(server, mirror, 'el servidor espejo debe ser idéntico');

  const archive = server.slice(server.indexOf("app.post('/api/tender-offer-archive'"), server.indexOf("app.get('/api/tender-closure-acta'"));
  assert.match(archive, /draftClosureActaAfterClosure\(database, req\.body\?\.opportunity_id\)/);
  assert.match(archive, /const archived = await callTenderOpportunityArchive/, 'el cierre se guarda antes de intentar el acta');

  const status = server.slice(server.indexOf("app.post('/api/tender-offer-status'"), server.indexOf("app.post('/api/tender-offer-archive'"));
  assert.match(status, /\['adjudicada', 'no_adjudicada'\]\.includes/, 'sólo los estados finales abren acta');
  assert.match(status, /draftClosureActaAfterClosure/);

  const decision = server.slice(server.indexOf("app.post('/api/tender-go-no-go-decision'"), server.indexOf("app.post('/api/tender-dossier-agt002-sync'"));
  assert.match(decision, /tender_offer_status === 'cerrada_no_go'/, 'sólo un NO-GO abre acta');
  assert.match(decision, /draftClosureActaAfterClosure/);
});

test('la red de seguridad corre donde vive la configuración, no en el servidor', async () => {
  // El servidor sólo llama al endpoint con el secreto compartido; redacta el proceso web.
  const script = fs.readFileSync(new URL('../ops/agt002-closure-acta/run-agt002-closure-acta.sh', import.meta.url), 'utf8');
  assert.match(script, /AGT002_CLOSURE_ACTA_WORKER_URL/);
  assert.match(script, /x-agt002-workbench-secret/);
  assert.doesNotMatch(script, /SUPABASE|HMAC|WORKBENCH_MODEL/, 'el servidor no debe conocer la configuración del modelo');

  const unit = fs.readFileSync(new URL('../ops/agt002-closure-acta/agt002-closure-acta.service', import.meta.url), 'utf8');
  assert.match(unit, /User=agt002-workbench-scheduler/, 'misma identidad que el scheduler de la Mesa');
  assert.equal((unit.match(/^EnvironmentFile=/gm) || []).length, 1, 'un solo archivo de entorno: ya no necesita el de la base');

  const server = fs.readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
  assert.match(server, /app\.post\('\/api\/tender-closure-acta\/worker\/run', runAgt002ClosureActaSweepOnce\)/);
  const handler = server.slice(server.indexOf('async function runAgt002ClosureActaSweepOnce'), server.indexOf("app.post('/api/tender-closure-acta/worker/run'"));
  assert.match(handler, /isAgt002WorkbenchDrainEnabled\(process\.env\)[\s\S]*?status = 404/, 'apagada: 404');
  assert.match(handler, /isAgt002WorkbenchWorkerAuthorized\(req\)[\s\S]*?status = 403/, 'sin secreto: 403');
  assert.match(handler, /cause = String\(error\?\.code \|\| ''\)/, 'el 503 debe decir la causa: sin eso el fallo es ciego');
  assert.match(handler, /code: 'AGT002_CLOSURE_ACTA_UNAVAILABLE', cause/);

  // El barrido no redacta nada con la Mesa apagada.
  const database = fakeDatabase();
  assert.deepEqual(await sweepTenderClosureActas(database, { environment: { ...CONFIGURED, AGT002_WORKBENCH_DRAIN_ENABLED: 'false' }, log: () => {} }), { status: 'skipped', reason: 'apagada' });
  assert.equal(database.calls.length, 0);

  // Encendida, redacta todas las pendientes, no sólo una.
  const otra = { ...pendingRow, opportunity_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  const conDos = fakeDatabase([pendingRow, otra]);
  const outcome = await sweepTenderClosureActas(conDos, { environment: CONFIGURED, bridgeClient: bridgeClient(), log: () => {} });
  assert.equal(outcome.status, 'ran');
  assert.equal(outcome.drafted, 2);
});

test('la red de seguridad quedó semanal, no tres veces al día', () => {
  const timer = fs.readFileSync(new URL('../ops/agt002-closure-acta/agt002-closure-acta.timer', import.meta.url), 'utf8');
  const calendars = timer.split('\n').filter(line => line.startsWith('OnCalendar='));
  assert.equal(calendars.length, 1, 'una sola corrida');
  assert.match(calendars[0], /^OnCalendar=Mon /, 'semanal, los lunes');
});
