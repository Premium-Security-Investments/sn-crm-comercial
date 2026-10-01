// Contrato RED (TDD) de la política de competibilidad de procesos (tender-competibility-policy).
// Motivado por el caso EPM CW396234: un proceso que luce abierto pero que, por evidencia
// conjunta estructurada (continuidad/renovación + aceptación/adjudicación/ejecución +
// incumbente + URL de evidencia verificable), es en realidad la continuidad de un contrato
// vigente con el incumbente y por tanto NO es competible. Cuando la evidencia es solo texto
// libre (sin prueba estructurada) o el régimen es especial sin plazo verificable, el estado
// correcto es "por_verificar" (incierto, no bloqueante de forma definitiva pero tampoco
// aprobado). Un registro "convertido" (confirmado manualmente) siempre se trata como
// competible, sin importar las demás señales.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

import {
  evaluateTenderCompetibility,
  filterActiveTenderCompetibilityRows,
  requireTenderCompetibleForConversion,
} from '../tender-competibility-policy.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function secopIiSelectFrom(sourceText) {
  const match = sourceText.match(/'SECOP II':\s*\{[^}]*select:\s*'([^']+)'/);
  return match ? match[1] : null;
}

const NOW = '2026-10-01T12:00:00.000Z';

function baseTender(o = {}) {
  return {
    id: 'BASE-0000',
    title: 'Proceso de selección de prueba',
    description: '',
    regimen: 'ordinario',
    deadline_at: '2026-12-15T17:00:00.000Z',
    ...o,
  };
}

// 1. Caso EPM CW396234: evidencia conjunta ESTRUCTURADA (continuidad/renovación +
//    aceptación/adjudicación/ejecución + incumbente + URL de evidencia) -> no_competible.
const epmCw396234 = baseTender({
  id: 'CW396234',
  title: 'Prórroga del contrato de interventoría integral de subestaciones',
  description: 'Proceso bajo régimen especial de contratación de EPM',
  regimen: 'especial',
  deadline_at: '2026-11-15T17:00:00.000Z',
  competibility_evidence: {
    continuity_or_renewal: true,
    acceptance_award_or_execution: true,
    incumbent: 'Interventora Actual S.A.S.',
    evidence_url: 'https://www.epm.com.co/contratacion/CW396234/acta-aceptacion.pdf',
  },
});

test('evidencia conjunta estructurada tipo EPM CW396234 clasifica como no_competible', () => {
  const result = evaluateTenderCompetibility(epmCw396234, { nowIso: NOW });
  assert.equal(result.status, 'no_competible');
});

// 2. Régimen especial sin plazo verificable (sin evidencia estructurada, sin señales de
//    texto libre) -> por_verificar.
const regimenEspecialSinPlazo = baseTender({
  id: 'EPM-0002',
  title: 'Suministro de materiales eléctricos para subestaciones',
  description: 'Proceso de abastecimiento rutinario',
  regimen: 'especial',
  deadline_at: null,
});

test('régimen especial sin plazo verificable clasifica como por_verificar', () => {
  const result = evaluateTenderCompetibility(regimenEspecialSinPlazo, { nowIso: NOW });
  assert.equal(result.status, 'por_verificar');
});

// 2b. Caso SECOP/EPM: el régimen especial sólo se indica en el campo crudo
//     `raw.modalidad_de_contratacion` (sin row.regimen), y sin plazo verificable
//     -> por_verificar.
const regimenEspecialSoloRawModalidad = {
  raw: { modalidad_de_contratacion: 'Contratación régimen especial' },
  deadline_at: null,
};

test('régimen especial detectado sólo vía raw.modalidad_de_contratacion sin plazo verificable clasifica como por_verificar', () => {
  const result = evaluateTenderCompetibility(regimenEspecialSoloRawModalidad, { nowIso: NOW });
  assert.equal(result.status, 'por_verificar');
});

// 2c. Ambos backends (server/index.js y api/[...path].js) deben solicitar
//     `modalidad_de_contratacion` en el `select` de SECOP II: es la fuente real del
//     `raw.modalidad_de_contratacion` que el caso 2b depende de que exista en la fila.
test('el select de SECOP II en server/index.js y api/[...path].js incluye modalidad_de_contratacion', () => {
  const serverSelect = secopIiSelectFrom(readFileSync(resolve(projectRoot, 'server/index.js'), 'utf8'));
  const apiSelect = secopIiSelectFrom(readFileSync(resolve(projectRoot, 'api/[...path].js'), 'utf8'));
  assert.ok(serverSelect, 'no se encontró el select de SECOP II en server/index.js');
  assert.ok(apiSelect, 'no se encontró el select de SECOP II en api/[...path].js');
  assert.ok(
    serverSelect.split(',').includes('modalidad_de_contratacion'),
    'el select de SECOP II en server/index.js debe incluir modalidad_de_contratacion',
  );
  assert.ok(
    apiSelect.split(',').includes('modalidad_de_contratacion'),
    'el select de SECOP II en api/[...path].js debe incluir modalidad_de_contratacion',
  );
});

// 3. Una sola señal de prórroga aislada (sin señal de aceptación/adjudicación/ejecución,
//    sin evidencia estructurada), con plazo competitivo futuro válido -> competible.
const loneProrroga = baseTender({
  id: 'ORD-0003',
  title: 'Prórroga del plazo del proceso de selección',
  description: 'Se extiende el cronograma del proceso por ajustes en las fechas de evaluación.',
  regimen: 'ordinario',
  deadline_at: '2026-12-15T17:00:00.000Z',
});

test('prórroga aislada con plazo competitivo futuro válido clasifica como competible', () => {
  const result = evaluateTenderCompetibility(loneProrroga, { nowIso: NOW });
  assert.equal(result.status, 'competible');
});

// 4. Señales combinadas de renovación + aceptación/adjudicación en texto libre, SIN prueba
//    estructurada (sin competibility_evidence) -> por_verificar (no es definitivo como el
//    caso 1 porque no hay prueba estructurada ni incumbente/URL verificables).
const combinedFreeTextSignals = baseTender({
  id: 'ORD-0004',
  title: 'Prórroga y adjudicación directa al contratista actual',
  description: 'El proceso contempla la continuidad del contratista incumbente mediante '
    + 'adjudicación directa, sin acta ni evidencia documental anexa.',
  regimen: 'ordinario',
  deadline_at: '2026-12-15T17:00:00.000Z',
});

test('señales combinadas de renovación/aceptación en texto libre sin prueba estructurada clasifican como por_verificar', () => {
  const result = evaluateTenderCompetibility(combinedFreeTextSignals, { nowIso: NOW });
  assert.equal(result.status, 'por_verificar');
});

// 5. Un registro "convertido" (confirmado manualmente) siempre pasa como competible, incluso
//    con la misma evidencia bloqueante del caso 1.
const convertedRecord = { ...epmCw396234, id: 'CW396234-CONVERTIDO', converted: true };

test('un registro convertido manualmente siempre clasifica como competible', () => {
  const result = evaluateTenderCompetibility(convertedRecord, { nowIso: NOW });
  assert.equal(result.status, 'competible');
});

// 6. Filtrado de filas activas: oculta no_competible/por_verificar no convertidos, pero
//    conserva competible y convertido.
test('filterActiveTenderCompetibilityRows oculta no_competible/por_verificar no convertidos y conserva competible/convertido', () => {
  const rows = [epmCw396234, regimenEspecialSinPlazo, loneProrroga, convertedRecord];
  const active = filterActiveTenderCompetibilityRows(rows, { nowIso: NOW });
  assert.deepEqual(
    active.map(row => row.id).sort(),
    [loneProrroga.id, convertedRecord.id].sort(),
  );
});

// 7. Helper de conversión: bloquea (lanza) para no_competible y por_verificar, con
//    code TENDER_COMPETIBILITY_BLOCKED y status 409; no lanza para competible.
test('requireTenderCompetibleForConversion lanza TENDER_COMPETIBILITY_BLOCKED/409 para no_competible', () => {
  assert.throws(
    () => requireTenderCompetibleForConversion(epmCw396234, { nowIso: NOW }),
    err => err.code === 'TENDER_COMPETIBILITY_BLOCKED' && err.status === 409,
  );
});

test('requireTenderCompetibleForConversion lanza TENDER_COMPETIBILITY_BLOCKED/409 para por_verificar', () => {
  assert.throws(
    () => requireTenderCompetibleForConversion(regimenEspecialSinPlazo, { nowIso: NOW }),
    err => err.code === 'TENDER_COMPETIBILITY_BLOCKED' && err.status === 409,
  );
});

test('requireTenderCompetibleForConversion no lanza para competible', () => {
  assert.doesNotThrow(() => requireTenderCompetibleForConversion(loneProrroga, { nowIso: NOW }));
});

// 8. `requireTenderCompetibleForConversion` es una API SOLO DE FILA: nunca debe tratar un
//    `row.status` ordinario (texto de estado del proceso, no resultado de política) como si
//    fuera el resultado de la política. Siempre debe evaluar la fila completa.
const statusCollisionBlocked = {
  ...epmCw396234,
  id: 'STATUS-COLLISION-BLOCKED',
  status: 'competible', // valor de estado ordinario que coincide por accidente con un status de política
};

test('requireTenderCompetibleForConversion bloquea pese a row.status="competible" si hay evidencia bloqueante', () => {
  assert.throws(
    () => requireTenderCompetibleForConversion(statusCollisionBlocked, { nowIso: NOW }),
    err => err.code === 'TENDER_COMPETIBILITY_BLOCKED' && err.status === 409,
  );
});

const statusCollisionAllowed = {
  ...loneProrroga,
  id: 'STATUS-COLLISION-ALLOWED',
  status: 'por_verificar', // valor de estado ordinario que coincide por accidente con un status de política
};

test('requireTenderCompetibleForConversion permite pese a row.status="por_verificar" si no hay riesgo real', () => {
  assert.doesNotThrow(() => requireTenderCompetibleForConversion(statusCollisionAllowed, { nowIso: NOW }));
});

// 9. Registro curado de evidencia verificada: caso ya verificado EPM ref CW396234 /
//    process_id CO1.REQ.10871299 (continuidad+aceptación, incumbente ENETEL S.A.S.).
//    Coincidencia EXACTA de ambos identificadores -> no_competible, sin necesidad de evidencia
//    estructurada en la fila. Una coincidencia parcial ("near-match") NO debe activar el registro.
const curatedExactMatch = baseTender({
  id: 'CURATED-EXACT',
  ref: 'CW396234',
  process_id: 'CO1.REQ.10871299',
  title: 'Continuidad de interventoría integral de subestaciones',
});

test('identidad EPM exacta (ref+process_id) en el registro curado clasifica como no_competible sin evidencia en la fila', () => {
  const result = evaluateTenderCompetibility(curatedExactMatch, { nowIso: NOW });
  assert.equal(result.status, 'no_competible');
});

const curatedNearMatchProcessId = baseTender({
  id: 'CURATED-NEAR-PROCESS-ID',
  ref: 'CW396234',
  process_id: 'CO1.REQ.10871300',
});

const curatedNearMatchRef = baseTender({
  id: 'CURATED-NEAR-REF',
  ref: 'CW396234-B',
  process_id: 'CO1.REQ.10871299',
});

test('una coincidencia parcial ("near-match") del identificador EPM NO activa el registro curado', () => {
  assert.notEqual(evaluateTenderCompetibility(curatedNearMatchProcessId, { nowIso: NOW }).status, 'no_competible');
  assert.notEqual(evaluateTenderCompetibility(curatedNearMatchRef, { nowIso: NOW }).status, 'no_competible');
});

test('un registro convertido con la misma identidad EPM del registro curado sigue siendo competible (el bypass de convertidos no cambia)', () => {
  const convertedCurated = { ...curatedExactMatch, id: 'CURATED-EXACT-CONVERTIDO', converted: true };
  assert.equal(evaluateTenderCompetibility(convertedCurated, { nowIso: NOW }).status, 'competible');
});

// 10. Bypass de convertidos: cualquier `converted_opportunity_id` no vacío también cuenta como
//     convertido, además de las señales existentes (`converted === true` / `internal_status`).
test('converted_opportunity_id no vacío clasifica como competible (bypass de convertidos)', () => {
  const convertedViaOpportunityId = { ...epmCw396234, id: 'CONVERTED-VIA-OPP-ID', converted_opportunity_id: 'OPP-0001' };
  assert.equal(evaluateTenderCompetibility(convertedViaOpportunityId, { nowIso: NOW }).status, 'competible');
});

// 11. El mensaje público de bloqueo debe ser genérico: no puede filtrar etiquetas internas de
//     decisión (`no_competible`, `por_verificar`) al cliente HTTP.
test('el mensaje de requireTenderCompetibleForConversion no contiene etiquetas internas de decisión', () => {
  try {
    requireTenderCompetibleForConversion(epmCw396234, { nowIso: NOW });
    assert.fail('se esperaba que lanzara');
  } catch (err) {
    assert.equal(err.message.includes('no_competible'), false);
    assert.equal(err.message.includes('por_verificar'), false);
    assert.equal(err.code, 'TENDER_COMPETIBILITY_BLOCKED');
    assert.equal(err.status, 409);
  }
  try {
    requireTenderCompetibleForConversion(regimenEspecialSinPlazo, { nowIso: NOW });
    assert.fail('se esperaba que lanzara');
  } catch (err) {
    assert.equal(err.message.includes('no_competible'), false);
    assert.equal(err.message.includes('por_verificar'), false);
    assert.equal(err.code, 'TENDER_COMPETIBILITY_BLOCKED');
    assert.equal(err.status, 409);
  }
});
