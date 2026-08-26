import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

const entry = new URL('../src/vigia/opportunity-preflight-presentation.ts', import.meta.url).pathname;
assert.equal(
  readFileSync(entry, 'utf8').includes('action_text'),
  false,
  'the presentation source module must not define or emit an action_text field at all',
);
const bundle = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const {
  COMMERCIAL_PREFLIGHT_EXPLANATION,
  KNOWN_PREFLIGHT_ISSUE_CODES,
  buildCommercialAlerts,
  consolidatePreflightActions,
  mergeCommercialAlertsWithPreflight,
} = await import(moduleUrl);

const state = (code, detail, tone) => Object.freeze({ code, label: code, detail, tone, className: `is-${tone}` });
const okNext = state('scheduled', 'En 10 días', 'ok');
const okClose = state('scheduled', 'En 30 días', 'ok');
const okDecision = state('complete', 'Contacto verificado', 'ok');

const cases = [
  ['nextAction', state('missing', 'Programe la próxima gestión', 'critical'), 'next_action:missing', 'No hay una próxima gestión agendada.'],
  ['nextAction', state('overdue', 'Vencida hace 4 días', 'critical'), 'next_action:overdue', 'La próxima gestión está vencida hace 4 días.'],
  ['nextAction', state('today', 'Gestionar hoy', 'attention'), 'next_action:today', 'La próxima gestión está programada para hoy.'],
  ['nextAction', state('soon', 'En 2 días', 'attention'), 'next_action:soon', 'La próxima gestión es en 2 días.'],
  ['expectedClose', state('missing', 'Sin fecha de cierre', 'attention'), 'close_date:missing', 'No hay fecha de cierre estimada registrada.'],
  ['expectedClose', state('overdue', 'Vencido hace 3 días', 'critical'), 'close_date:overdue', 'La fecha de cierre estimada ya venció.'],
  ['expectedClose', state('today', 'Cierra hoy', 'attention'), 'close_date:today', 'La fecha de cierre estimada es hoy.'],
  ['decisionMaker', state('pending', 'Complete el contacto decisor', 'attention'), 'decision_maker:pending', 'No hay datos de contacto del decisor registrados.'],
  ['decisionMaker', state('partial', 'Falta correo', 'attention'), 'decision_maker:partial', 'El contacto del decisor está incompleto (falta correo).'],
];

const FORBIDDEN_ACTION_STRINGS = ['antes de generar', 'Actualice', 'Agende', 'Registre', 'Complete'];

for (const [field, candidate, key, riskText] of cases) {
  const input = Object.freeze({ nextAction: okNext, expectedClose: okClose, decisionMaker: okDecision, [field]: candidate });
  const before = JSON.stringify(input);
  const result = buildCommercialAlerts(input);
  assert.deepEqual(result, [{
    key,
    category: key.split(':')[0],
    risk_text: riskText,
  }], key);
  assert.equal(Object.prototype.hasOwnProperty.call(result[0], 'action_text'), false, `${key} base alert must not have an own action_text property`);
  const serialized = JSON.stringify(result);
  for (const forbidden of FORBIDDEN_ACTION_STRINGS) {
    assert.equal(serialized.includes(forbidden), false, `${key} serialized alert must not contain mandatory-instruction string "${forbidden}"`);
  }
  assert.equal(JSON.stringify(input), before, `${key} does not mutate its input`);
}

for (const [field, candidate] of [
  ['nextAction', state('scheduled', 'En 10 días', 'ok')],
  ['nextAction', state('closed', 'No requiere próxima gestión', 'ok')],
  ['expectedClose', state('scheduled', 'En 30 días', 'ok')],
  ['decisionMaker', state('complete', 'Contacto verificado', 'ok')],
  ['nextAction', state('future-code', 'No mapeado', 'attention')],
]) {
  assert.deepEqual(buildCommercialAlerts({ nextAction: okNext, expectedClose: okClose, decisionMaker: okDecision, [field]: candidate }), []);
}

const ordered = buildCommercialAlerts({
  decisionMaker: state('pending', 'Complete el contacto decisor', 'attention'),
  expectedClose: state('overdue', 'Vencido hace 1 día', 'critical'),
  nextAction: state('missing', 'Programe la próxima gestión', 'critical'),
});
assert.deepEqual(ordered.map(item => item.category), ['next_action', 'close_date', 'decision_maker']);
assert.equal(new Set(ordered.map(item => item.key)).size, ordered.length, 'at most one key per category');
assert.deepEqual(KNOWN_PREFLIGHT_ISSUE_CODES, ['next_action', 'close_date', 'decision_maker']);
assert.equal(COMMERCIAL_PREFLIGHT_EXPLANATION, 'Señales para tener en cuenta durante el seguimiento. No impiden continuar.');
assert.equal(COMMERCIAL_PREFLIGHT_EXPLANATION.includes('requieren actualización'), false, 'las alertas no son instrucciones obligatorias');
assert.equal(COMMERCIAL_PREFLIGHT_EXPLANATION.includes('antes de generar'), false, 'las alertas no son prerrequisitos para generar la propuesta');

const actions = Object.freeze([
  Object.freeze({ issue_code: 'next_action', title: 'Primera acción', description: 'Defina la fecha.', evidence_refs: Object.freeze(['e1', 'e2']) }),
  Object.freeze({ issue_code: 'stalled_conversation', title: 'Retomar', description: 'Confirme interés.', evidence_refs: Object.freeze(['e3']) }),
  Object.freeze({ issue_code: 'next_action', title: 'Título posterior', description: 'Defina el responsable.', evidence_refs: Object.freeze(['e2', 'e4']) }),
  Object.freeze({ issue_code: 'next_action', title: 'Otro título', description: 'Defina la fecha.', evidence_refs: Object.freeze(['e5']) }),
  Object.freeze({ issue_code: 'pending_terms', title: 'Aclarar términos', description: 'Valide alcance.', evidence_refs: Object.freeze(['e6']) }),
  Object.freeze({ issue_code: 'stalled_conversation', title: 'Título ignorado', description: 'Confirme interés.', evidence_refs: Object.freeze(['e7']) }),
]);
const actionsBefore = JSON.stringify(actions);
const consolidated = consolidatePreflightActions(actions);
assert.deepEqual(consolidated, [
  { issue_code: 'next_action', title: 'Primera acción', description: 'Defina la fecha.\nDefina el responsable.', evidence_refs: ['e1', 'e2', 'e4', 'e5'] },
  { issue_code: 'stalled_conversation', title: 'Retomar', description: 'Confirme interés.', evidence_refs: ['e3', 'e7'] },
  { issue_code: 'pending_terms', title: 'Aclarar términos', description: 'Valide alcance.', evidence_refs: ['e6'] },
]);
assert.equal(JSON.stringify(actions), actionsBefore, 'consolidation does not mutate actions or evidence arrays');

const activeAlerts = buildCommercialAlerts({
  nextAction: state('missing', 'Programe la próxima gestión', 'critical'),
  expectedClose: state('overdue', 'Vencido hace 1 día', 'critical'),
  decisionMaker: okDecision,
});
const merged = mergeCommercialAlertsWithPreflight(activeAlerts, [
  ...actions,
  { issue_code: 'decision_maker', title: 'Contradicción obsoleta', description: 'Complete el decisor.', evidence_refs: ['e8'] },
]);
assert.equal(merged.alerts.length, 2, 'preflight never creates duplicate deterministic alerts');
assert.equal(merged.alerts[0].contextualAction.issue_code, 'next_action', 'active exact category receives one contextual action');
assert.equal(merged.alerts[1].contextualAction, null, 'uncovered category keeps its deterministic default');
assert.deepEqual(merged.standaloneActions.map(item => item.issue_code), ['stalled_conversation', 'pending_terms']);
assert.equal(JSON.stringify(merged).includes('Contradicción obsoleta'), false, 'known category without an active deterministic alert is discarded');
assert.equal(merged.alerts[0].risk_text, activeAlerts[0].risk_text, 'contextual action enriches instead of replacing the risk');
assert.equal('contextualAction' in activeAlerts[0], false, 'merge does not mutate deterministic alerts');

assert.deepEqual(mergeCommercialAlertsWithPreflight(activeAlerts, []), {
  alerts: activeAlerts.map(alert => ({ ...alert, contextualAction: null })),
  standaloneActions: [],
});
assert.deepEqual(consolidatePreflightActions([]), []);

console.log('AGT-003 preflight alert presentation checks passed');
