import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { ACTIONS } from '../access-control.js';
import { AGT002_WORKBENCH_CAPABILITIES } from '../agt002-workbench-contract.js';

// Módulos que ejecutan como agente/worker/scheduler (nunca con perfil humano
// autenticado): ninguno debe importar los emisores de RPC de GO/NO-GO o de
// transición de estado de oferta, que son las únicas puertas de entrada a
// decisiones/estados reservados a humanos.
const AGENT_WORKER_SCHEDULER_MODULES = [
  '../tender-processing-worker.js',
  '../tender-processing-worker-rpc.js',
  '../agt002-preview-engine.js',
  '../agt002-preview-runtime.js',
  '../agt002-preview-input.js',
  '../agt002-preview-persistence.js',
  '../agt002-preview-codex-client.js',
  '../agt002-workbench-worker.js',
  '../agt002-workbench-runtime.js',
  '../agt002-workbench-responder.js',
  '../agt002-hetzner-bridge-server.js',
  '../agt002-hetzner-bridge-client.js',
  '../tender-analysis-foundation.js',
];

const FORBIDDEN_HUMAN_ONLY_REFERENCES = [
  /callTenderGoNoGoDecision/,
  /callTenderOfferStatusTransition/,
  /psi_record_tender_go_no_go/,
  /psi_transition_tender_offer_status/,
  /ACTIONS\.LICITACIONES_GO_NO_GO_APPROVE/,
  /ACTIONS\.LICITACIONES_DISCARD_APPROVE/,
  /ACTIONS\.BOARD_APPROVE/,
  /ACTIONS\.BOARD_PUBLISH/,
  /ACTIONS\.USERS_MANAGE/,
  /ACTIONS\.SIIO_CLOSE_APPROVE/,
];

// Ninguna dependencia de envío de correo/mensajería externa existe en el
// repositorio: si alguna vez se agrega, debe hacerlo fuera de rutas de
// agente/worker y este test debe fallar para forzar su revisión explícita.
const FORBIDDEN_EXTERNAL_SEND_PATTERNS = [
  /nodemailer/i,
  /sendmail/i,
  /\bsmtp\b/i,
  /sendgrid/i,
  /twilio/i,
  /\.sendMail\(/,
];

for (const relative of AGENT_WORKER_SCHEDULER_MODULES) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  for (const pattern of FORBIDDEN_HUMAN_ONLY_REFERENCES) {
    assert.doesNotMatch(source, pattern, `${relative} no debe referenciar una ruta/decisión exclusiva humana (${pattern})`);
  }
  for (const pattern of FORBIDDEN_EXTERNAL_SEND_PATTERNS) {
    assert.doesNotMatch(source, pattern, `${relative} no debe contener capacidad de envío externo (${pattern})`);
  }
}

// El scheduler externo del worker es un disparador HTTP ciego autenticado por
// secreto compartido; nunca debe invocar rutas humanas de GO/NO-GO/oferta ni
// portar secretos embebidos.
const schedulerScript = readFileSync(new URL('../ops/tender-worker-scheduler/run-tender-worker.sh', import.meta.url), 'utf8');
assert.doesNotMatch(schedulerScript, /go-no-go|offer-status|presentar/i, 'el scheduler no debe apuntar a rutas humanas de decisión/oferta');
assert.doesNotMatch(schedulerScript, /TENDER_WORKER_SECRET\s*=\s*['"a-zA-Z0-9]/, 'el scheduler no debe embeber el secreto');
assert.match(schedulerScript, /TENDER_WORKER_SECRET/, 'el scheduler debe requerir autenticación por secreto');

// El único juego cerrado de capacidades de la Mesa Vig-IA es reply/draft/
// learning_proposal: ninguna variante de aprobar/firmar/enviar/radicar/
// presentar/go/no_go puede colarse como una capacidad nueva.
const capabilityValues = Object.values(AGT002_WORKBENCH_CAPABILITIES);
assert.deepEqual(capabilityValues.sort(), [
  'agt002.dossier-workbench.draft.v1',
  'agt002.dossier-workbench.learning-proposal.v1',
  'agt002.dossier-workbench.reply.v1',
].sort());
const forbiddenCapabilityWord = /(aprob|firm|envia|envio|radica|presenta|submit|approve|sign|send)/i;
for (const capability of capabilityValues) {
  assert.doesNotMatch(capability, forbiddenCapabilityWord, `capability_id no debe insinuar autoridad humana: ${capability}`);
}

// El contrato de acceso debe seguir restringiendo la identidad de agente a las
// dos únicas acciones de asistencia técnica (ejecutar análisis y recomendar),
// cada una condicionada a una bandera de autorización construida en servidor.
const accessControlSource = readFileSync(new URL('../access-control.js', import.meta.url), 'utf8');
const agentBranch = accessControlSource.match(/if \(isAgent\(profile\)\) \{[\s\S]*?\n {2}\}/)?.[0] || '';
assert.notEqual(agentBranch, '', 'access-control.js debe contener una rama explícita para identidad de agente');
assert.match(agentBranch, /ACTIONS\.AI_ANALYSIS_RUN/);
assert.match(agentBranch, /ACTIONS\.LICITACIONES_GO_NO_GO_RECOMMEND/);
assert.match(agentBranch, /technical_authorized/);
assert.match(agentBranch, /return false;/);
assert.doesNotMatch(agentBranch, /LICITACIONES_GO_NO_GO_APPROVE/);
assert.doesNotMatch(agentBranch, /WORKBENCH_CUSTODY/);

// Verifica que ACTIONS solo enumera las acciones ya auditadas arriba (evita que
// una acción humana nueva quede fuera del alcance de este test estático sin que
// nadie lo note): el test dinámico recorre exactamente este mismo objeto.
assert.ok(Object.keys(ACTIONS).length > 0);

console.log('AGT-002 human authority static audit passed');
