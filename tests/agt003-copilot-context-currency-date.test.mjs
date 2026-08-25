import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGT003_CRM_DEFAULT_CURRENCY,
  agt003PreparationDate,
  buildAgt003CopilotRequest,
} from '../agt003-copilot-input.js';
import { AGT003_COPILOT_POLICY } from '../agt003-copilot-engine.js';

// AGT-003 — calidad del contexto entregado a VIG-IA Comercial.
//
// Conducta exigida (RED antes de producción):
//  - Convención monetaria del CRM: los valores se interpretan en COP salvo moneda explícita
//    distinta. El contexto lo dice, así que el modelo no puede mostrar COP y a la vez pedir la
//    `moneda exacta` como dato faltante.
//  - Fecha actual: cada preparación viaja con la fecha real de ejecución, inyectable para prueba,
//    nunca la de creación de la oportunidad ni la de un run anterior.
//  - La política declara ambas reglas más el alcance de missing_information / warnings.
//  - El contrato público de la solicitud (claves de primer nivel) no cambia.

const base = {
  id: 'opp-001',
  title: 'Modernización de seguridad',
  company_name: 'Coats Cadena Andina S.A.',
  stage: 'Propuesta',
  service: 'Seguridad electrónica',
  owner_name: 'Comercial de Prueba',
  offer_value: 125000000,
  expected_close_date: '2026-09-30',
};
const build = (opportunity, options = {}) => buildAgt003CopilotRequest({
  opportunity, interactions: [], approvedAssets: [],
  correlationId: 'corr-001', snapshotId: 'snapshot-001', ...options,
});
const factValue = (request, field) => request.opportunity.facts.find(item => item.field === field)?.value ?? null;

// --- fecha de preparación ---------------------------------------------------------------------
assert.equal(AGT003_CRM_DEFAULT_CURRENCY, 'COP');
assert.equal(agt003PreparationDate(() => new Date('2026-08-25T09:00:00.000Z')), '2026-08-25');
assert.equal(agt003PreparationDate(() => new Date('2026-08-25T23:59:59.000Z')), '2026-08-25');

const today = build(base, { now: () => new Date('2026-08-25T09:00:00.000Z') });
assert.equal(factValue(today, 'preparation_date'), '2026-08-25', 'la preparación viaja con la fecha real de ejecución');
const tomorrow = build(base, { now: () => new Date('2026-08-26T09:00:00.000Z') });
assert.equal(factValue(tomorrow, 'preparation_date'), '2026-08-26', 'una preparación posterior no reutiliza la fecha anterior');
assert.notEqual(factValue(today, 'preparation_date'), factValue(tomorrow, 'preparation_date'));

// La fecha de creación de la oportunidad nunca sustituye a la fecha de ejecución.
const oldOpportunity = build({ ...base, created_at: '2024-01-05T00:00:00.000Z' }, { now: () => new Date('2026-08-25T09:00:00.000Z') });
assert.equal(factValue(oldOpportunity, 'preparation_date'), '2026-08-25');

// El backend puede fijarla (misma fuente que el hash del snapshot) y entonces manda esa.
const pinned = build({ ...base, preparation_date: '2026-08-25' }, { now: () => new Date('2030-01-01T00:00:00.000Z') });
assert.equal(factValue(pinned, 'preparation_date'), '2026-08-25', 'la fecha fijada por el contexto del backend es la que gobierna');

// --- moneda -------------------------------------------------------------------------------------
assert.equal(factValue(today, 'offer_value'), '125000000', 'el valor fuente no se altera');
assert.equal(factValue(today, 'offer_currency'), 'COP', 'la convención del CRM entra al contexto de forma explícita');
assert.equal(factValue(build({ ...base, currency: 'USD' }), 'offer_currency'), 'USD', 'una moneda explícita distinta se respeta');
assert.equal(factValue(build({ ...base, currency: '   ' }), 'offer_currency'), 'COP');
const noValue = build({ ...base, offer_value: null });
assert.equal(factValue(noValue, 'offer_value'), null);
assert.equal(factValue(noValue, 'offer_currency'), null, 'sin valor monetario no se inventa moneda');

// --- C1: offer_value con forma de teléfono colombiano no debe redactarse -------------------------
// 3500000000 (o "3500000000.00") coincide con el regex de teléfono CO (3XX XXX XXXX) y antes se
// convertía en [REDACTED_PHONE] mientras offer_currency=COP sí viajaba: contradicción visible.
const bigNumeric = build({ ...base, offer_value: 3500000000 });
assert.equal(factValue(bigNumeric, 'offer_value'), '3500000000', 'el valor monetario numérico viaja intacto, no como [REDACTED_PHONE]');
assert.equal(factValue(bigNumeric, 'offer_currency'), 'COP');
assert.doesNotMatch(JSON.stringify(bigNumeric), /REDACTED_PHONE/);

const bigDecimalString = build({ ...base, offer_value: '3500000000.00' });
assert.equal(factValue(bigDecimalString, 'offer_value'), '3500000000.00', 'el valor monetario decimal en string viaja intacto');
assert.equal(factValue(bigDecimalString, 'offer_currency'), 'COP');
assert.doesNotMatch(JSON.stringify(bigDecimalString), /REDACTED_PHONE/);

// Un string arbitrario en offer_value no debe evadir la redacción normal.
const arbitraryOfferValue = build({ ...base, offer_value: 'Llamar al 300 123 4567 antes de confirmar' });
assert.match(factValue(arbitraryOfferValue, 'offer_value') || '', /\[REDACTED_PHONE\]/, 'un string no numérico en offer_value sigue protegido por la redacción');

// NaN/Infinity nunca deben viajar como hecho monetario.
assert.equal(factValue(build({ ...base, offer_value: NaN }), 'offer_value'), null, 'NaN no se expone como hecho monetario');
assert.equal(factValue(build({ ...base, offer_value: NaN }), 'offer_currency'), null);
assert.equal(factValue(build({ ...base, offer_value: Infinity }), 'offer_value'), null, 'Infinity no se expone como hecho monetario');
assert.equal(factValue(build({ ...base, offer_value: Infinity }), 'offer_currency'), null);

// --- contrato público intacto --------------------------------------------------------------------
assert.deepEqual(
  Object.keys(today).sort(),
  ['approved_assets', 'authority', 'capability_id', 'contract_version', 'correlation_id', 'interactions', 'opportunity', 'snapshot_id'],
  'la corrección es aditiva dentro de facts: las claves del contrato no cambian',
);
assert.deepEqual(Object.keys(today.opportunity).sort(), ['company_name', 'facts', 'opportunity_id', 'owner_name', 'service', 'stage', 'title']);
assert.ok(today.opportunity.facts.every(item => item.source === 'SIIO'));
assert.ok(Object.isFrozen(today));

// Determinismo: mismo `now`, mismo request.
assert.deepEqual(
  build(base, { now: () => new Date('2026-08-25T09:00:00.000Z') }),
  build({ ...base }, { now: () => new Date('2026-08-25T09:00:00.000Z') }),
);

// --- política -------------------------------------------------------------------------------------
assert.match(AGT003_COPILOT_POLICY, /COP/, 'la política declara la convención monetaria del CRM');
assert.match(AGT003_COPILOT_POLICY, /nunca (la )?(pidas|solicites) la moneda/i);
assert.match(AGT003_COPILOT_POLICY, /preparation_date/, 'la política ancla el cálculo temporal a la fecha de preparación');
assert.match(AGT003_COPILOT_POLICY, /missing_information/);
assert.match(AGT003_COPILOT_POLICY, /warnings/);
assert.match(AGT003_COPILOT_POLICY, /contacto decisor/i);
assert.match(AGT003_COPILOT_POLICY, /verificarlo antes/i);
assert.match(AGT003_COPILOT_POLICY, /breve/i);
assert.match(AGT003_COPILOT_POLICY, /revisión humana/i);
// Las protecciones previas siguen vigentes.
assert.match(AGT003_COPILOT_POLICY, /no confiable/i);
assert.match(AGT003_COPILOT_POLICY, /No envíes/i);

// --- el contexto del backend fija la fecha real de ejecución --------------------------------------
for (const path of ['../server/index.js', '../api/[...path].js']) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const context = source.slice(source.indexOf('async function loadAgt003OpportunityContext'), source.indexOf('function createBackendAgt003CopilotApi'));
  assert.ok(context, `${path} debe conservar loadAgt003OpportunityContext`);
  assert.match(context, /loadAgt003OpportunityContext\(database, opportunityId, now = \(\) => new Date\(\)\)/, `${path}: la fecha de ejecución es inyectable`);
  assert.match(context, /preparation_date: agt003PreparationDate\(now\)/, `${path}: el contexto sella la fecha real de ejecución`);
  assert.match(context, /computeAgt003CopilotHash\(\{ opportunity, interactions \}\)/, `${path}: la fecha entra al snapshot para que un run reutilizado no arrastre una fecha vieja`);
  assert.match(source, /import \{ agt003PreparationDate \} from '\.\.\/agt003-copilot-input\.js';/, `${path}: importa el helper compartido`);
}

console.log('AGT-003 copilot context currency/date checks passed');
