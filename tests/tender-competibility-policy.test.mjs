// Contrato TDD de la política de competibilidad de procesos (tender-competibility-policy).
// Motivado por EPM CW396234 (renovación ya aceptada que luce abierta) y Pereira
// CTO 08 DE 2025 (publicidad SECOP II de un contrato de régimen especial ya firmado).
//
// Hide automático estrecho (tipo Pereira): modalidad EXACTA `Contratación régimen especial`
// (no "con ofertas") + sin plazo verificable + (proveedor con nombre real O ref CTO/CONTRATO)
// → `no_competible`. Un régimen especial sin esas señales extra es convocatoria viva
// (SINCHI) y permanece `competible`. No se ocultan las ~370 especiales-sin-plazo.
// Texto libre combinado (renovación+adjudicación sin prueba estructurada) sigue
// `por_verificar`. Un registro convertido siempre es `competible`.
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

const regimenEspecialSinPlazo = baseTender({
  id: 'EPM-0002',
  title: 'Suministro de materiales eléctricos para subestaciones',
  description: 'Proceso de abastecimiento rutinario',
  regimen: 'especial',
  deadline_at: null,
});

test('régimen especial sin plazo verificable sin proveedor ni CTO/CONTRATO clasifica como competible', () => {
  const result = evaluateTenderCompetibility(regimenEspecialSinPlazo, { nowIso: NOW });
  assert.equal(result.status, 'competible');
});

const regimenEspecialSoloRawModalidad = {
  raw: { modalidad_de_contratacion: 'Contratación régimen especial' },
  deadline_at: null,
};

test('régimen especial detectado sólo vía raw.modalidad_de_contratacion sin plazo ni CTO/proveedor clasifica como competible', () => {
  const result = evaluateTenderCompetibility(regimenEspecialSoloRawModalidad, { nowIso: NOW });
  assert.equal(result.status, 'competible');
});

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

const convertedRecord = { ...epmCw396234, id: 'CW396234-CONVERTIDO', converted: true };

test('un registro convertido manualmente siempre clasifica como competible', () => {
  const result = evaluateTenderCompetibility(convertedRecord, { nowIso: NOW });
  assert.equal(result.status, 'competible');
});

test('filterActiveTenderCompetibilityRows oculta no_competible/por_verificar no convertidos y conserva competible/convertido', () => {
  const rows = [epmCw396234, regimenEspecialSinPlazo, loneProrroga, convertedRecord];
  const active = filterActiveTenderCompetibilityRows(rows, { nowIso: NOW });
  assert.deepEqual(
    active.map(row => row.id).sort(),
    [regimenEspecialSinPlazo.id, loneProrroga.id, convertedRecord.id].sort(),
  );
});

test('requireTenderCompetibleForConversion lanza TENDER_COMPETIBILITY_BLOCKED/409 para no_competible', () => {
  assert.throws(
    () => requireTenderCompetibleForConversion(epmCw396234, { nowIso: NOW }),
    err => err.code === 'TENDER_COMPETIBILITY_BLOCKED' && err.status === 409,
  );
});

test('requireTenderCompetibleForConversion lanza TENDER_COMPETIBILITY_BLOCKED/409 para por_verificar', () => {
  assert.throws(
    () => requireTenderCompetibleForConversion(combinedFreeTextSignals, { nowIso: NOW }),
    err => err.code === 'TENDER_COMPETIBILITY_BLOCKED' && err.status === 409,
  );
});

test('requireTenderCompetibleForConversion no lanza para competible', () => {
  assert.doesNotThrow(() => requireTenderCompetibleForConversion(loneProrroga, { nowIso: NOW }));
});

const statusCollisionBlocked = {
  ...epmCw396234,
  id: 'STATUS-COLLISION-BLOCKED',
  status: 'competible',
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
  status: 'por_verificar',
};

test('requireTenderCompetibleForConversion permite pese a row.status="por_verificar" si no hay riesgo real', () => {
  assert.doesNotThrow(() => requireTenderCompetibleForConversion(statusCollisionAllowed, { nowIso: NOW }));
});

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

const liveEpmNuevaWithOpportunityLink = {
  ...curatedExactMatch,
  id: 'd51b18fc-8d05-4271-a4b8-a5edf9517956',
  ref: 'CW396234',
  process_id: 'CO1.REQ.10871299',
  internal_status: 'nueva',
  converted_opportunity_id: 'b8c0b564-c5d3-4787-9c04-6ed7d6becac5',
};

test('identidad EPM exacta en nueva con converted_opportunity_id sigue no_competible', () => {
  assert.equal(
    evaluateTenderCompetibility(liveEpmNuevaWithOpportunityLink, { nowIso: NOW }).status,
    'no_competible',
  );
});

test('filterActiveTenderCompetibilityRows oculta EPM nueva aunque tenga converted_opportunity_id', () => {
  const active = filterActiveTenderCompetibilityRows(
    [liveEpmNuevaWithOpportunityLink],
    { nowIso: NOW },
  );
  assert.deepEqual(active.map(row => row.id), []);
});

test('internal_status convertida_oportunidad sí clasifica como competible (bypass real)', () => {
  const convertedByStatus = {
    ...curatedExactMatch,
    id: 'CURATED-CONVERTIDA-STATUS',
    internal_status: 'convertida_oportunidad',
    converted_opportunity_id: 'b8c0b564-c5d3-4787-9c04-6ed7d6becac5',
  };
  assert.equal(evaluateTenderCompetibility(convertedByStatus, { nowIso: NOW }).status, 'competible');
});

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
    requireTenderCompetibleForConversion(combinedFreeTextSignals, { nowIso: NOW });
    assert.fail('se esperaba que lanzara');
  } catch (err) {
    assert.equal(err.message.includes('no_competible'), false);
    assert.equal(err.message.includes('por_verificar'), false);
    assert.equal(err.code, 'TENDER_COMPETIBILITY_BLOCKED');
    assert.equal(err.status, 409);
  }
});

const pereiraLive = baseTender({
  id: '19f0ef56-5387-4c75-b08f-8a2850eaeb55',
  ref: 'CTO 08 DE 2025',
  process_id: 'CO1.REQ.10512285',
  entity: 'EMPRESA DE ENERGIA DE PEREIRA SA ESP',
  title: 'Contratar un servicio integral de seguridad privada',
  deadline_at: null,
  raw: {
    modalidad_de_contratacion: 'Contratación régimen especial',
    nombre_del_proveedor: 'No Definido',
    referencia_del_proceso: 'CTO 08 DE 2025',
  },
});

test('Pereira CTO 08 DE 2025 (especial sin plazo, ref CTO, proveedor No Definido) clasifica como no_competible', () => {
  assert.equal(evaluateTenderCompetibility(pereiraLive, { nowIso: NOW }).status, 'no_competible');
});

test('identidad Pereira exacta sin modalidad en raw sigue no_competible vía registro curado', () => {
  const withoutModalidad = {
    ...pereiraLive,
    id: 'PEREIRA-REGISTRY-ONLY',
    raw: {},
  };
  assert.equal(evaluateTenderCompetibility(withoutModalidad, { nowIso: NOW }).status, 'no_competible');
});

test('filterActiveTenderCompetibilityRows oculta Pereira CTO 08 DE 2025', () => {
  const active = filterActiveTenderCompetibilityRows([pereiraLive], { nowIso: NOW });
  assert.deepEqual(active.map(row => row.id), []);
});

const syntheticCtoPublicity = baseTender({
  id: 'SYN-CTO-PUBLICITY',
  ref: 'CTO 99 DE 2099',
  process_id: 'CO1.REQ.NOT-IN-REGISTRY',
  deadline_at: null,
  raw: { modalidad_de_contratacion: 'Contratación régimen especial' },
});

test('especial exacta sin plazo con ref CTO (fuera del registro curado) clasifica como no_competible', () => {
  assert.equal(evaluateTenderCompetibility(syntheticCtoPublicity, { nowIso: NOW }).status, 'no_competible');
});

const namedProveedorPublicity = baseTender({
  id: 'SYN-NAMED-PROVEEDOR',
  ref: 'CP-XX-2099',
  process_id: 'CO1.REQ.NAMED-PROVEEDOR',
  deadline_at: null,
  raw: {
    modalidad_de_contratacion: 'Contratación régimen especial',
    nombre_del_proveedor: 'ESTATAL DE SEGURIDAD LTDA',
  },
});

test('especial exacta sin plazo con proveedor nombrado clasifica como no_competible', () => {
  assert.equal(evaluateTenderCompetibility(namedProveedorPublicity, { nowIso: NOW }).status, 'no_competible');
});

const noDefinidoWithoutCto = baseTender({
  id: 'SYN-NO-DEFINIDO',
  ref: 'CP-YY-2099',
  process_id: 'CO1.REQ.NO-DEFINIDO',
  deadline_at: null,
  raw: {
    modalidad_de_contratacion: 'Contratación régimen especial',
    nombre_del_proveedor: 'No Definido',
  },
});

test('especial exacta sin plazo con proveedor No Definido y sin CTO/CONTRATO clasifica como competible', () => {
  assert.equal(evaluateTenderCompetibility(noDefinidoWithoutCto, { nowIso: NOW }).status, 'competible');
});

const contratoRefPublicity = baseTender({
  id: 'SYN-CONTRATO-REF',
  ref: 'CONTRATO 12 DE 2025',
  process_id: 'CO1.REQ.CONTRATO-REF',
  deadline_at: null,
  raw: { modalidad_de_contratacion: 'Contratación régimen especial' },
});

test('especial exacta sin plazo con ref CONTRATO clasifica como no_competible', () => {
  assert.equal(evaluateTenderCompetibility(contratoRefPublicity, { nowIso: NOW }).status, 'no_competible');
});

const sinchiConvocatoria = baseTender({
  id: 'SINCHI-008-2026',
  ref: 'CONVOCATORIA PUBLICA 008 DE 2026',
  process_id: 'CO1.REQ.SINCHI-008',
  deadline_at: null,
  raw: { modalidad_de_contratacion: 'Contratación régimen especial' },
});

test('SINCHI CONVOCATORIA PUBLICA 008 DE 2026 (especial sin plazo, sin proveedor ni CTO) clasifica como competible', () => {
  assert.equal(evaluateTenderCompetibility(sinchiConvocatoria, { nowIso: NOW }).status, 'competible');
});

test('filterActiveTenderCompetibilityRows conserva SINCHI CONVOCATORIA PUBLICA 008 DE 2026', () => {
  const active = filterActiveTenderCompetibilityRows([sinchiConvocatoria], { nowIso: NOW });
  assert.deepEqual(active.map(row => row.id), [sinchiConvocatoria.id]);
});

const especialConOfertasConPlazo = baseTender({
  id: 'ESP-CON-OFERTAS-PLAZO',
  ref: 'LP-260007',
  process_id: 'CO1.REQ.CON-OFERTAS-PLAZO',
  deadline_at: '2026-12-15T17:00:00.000Z',
  raw: { modalidad_de_contratacion: 'Contratación régimen especial con ofertas' },
});

test('régimen especial con ofertas y plazo futuro clasifica como competible', () => {
  assert.equal(evaluateTenderCompetibility(especialConOfertasConPlazo, { nowIso: NOW }).status, 'competible');
});

const especialConOfertasSinPlazo = baseTender({
  id: 'ESP-CON-OFERTAS-SIN-PLAZO',
  ref: 'CP-08-2026',
  process_id: 'CO1.REQ.CON-OFERTAS-SIN',
  deadline_at: null,
  raw: { modalidad_de_contratacion: 'Contratación régimen especial con ofertas' },
});

test('régimen especial con ofertas sin plazo ni CTO/proveedor clasifica como competible', () => {
  assert.equal(evaluateTenderCompetibility(especialConOfertasSinPlazo, { nowIso: NOW }).status, 'competible');
});
