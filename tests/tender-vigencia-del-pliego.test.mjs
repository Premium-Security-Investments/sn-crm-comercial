import assert from 'node:assert/strict';
import test from 'node:test';

import { diasHabilesEntre, evaluarVigencia, festivosDeColombia, reglaDeVigencia, reglasPorDocumento } from '../verticales/licitaciones/tender-vigencia-del-pliego.js';
import { buildTenderComplianceMatrix, matchCompanyDocumentClasses } from '../verticales/licitaciones/tender-compliance-matrix.js';

// Mejora 4 (encargo desde Terminal). TT-SPO-07 cerró el 4-nov-2026.
const CIERRE = '2026-11-04';

test('los festivos de Colombia 2026 son los de la Ley Emiliani', () => {
  assert.deepEqual([...festivosDeColombia(2026)].sort(), [
    '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-18', '2026-06-08', '2026-06-15',
    '2026-06-29', '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02', '2026-11-16', '2026-12-08', '2026-12-25',
  ]);
  assert.equal(diasHabilesEntre('2026-10-30', '2026-11-04'), 2, 'sábado, domingo y el festivo del 2-nov no cuentan');
});

test('caso Terminal 1: el RUP del 28-sep queda fuera de los 30 días calendario del pliego, en rojo', () => {
  const regla = reglaDeVigencia('El RUP deberá tener fecha de expedición no mayor a treinta (30) días calendario anteriores a la fecha de cierre.');
  assert.deepEqual({ ...regla, cita: undefined }, { tipo: 'antiguedad', cantidad: 30, unidad: 'dias', habiles: false, cita: undefined });
  const resultado = evaluarVigencia({ regla, issuedAt: '2026-09-28', closeDate: CIERRE });
  assert.equal(resultado.estado, 'no_alcanza');
  assert.match(resultado.detalle, /37 días al cierre.*pasa de los 30 días calendario.*Sirve uno expedido el 2026-10-05 o después/);
});

test('caso Terminal 2: multas y sanciones del 18-jun pasan de los 90 días hábiles', () => {
  const regla = reglaDeVigencia('certificado de multas y sanciones con expedición no mayor a 90 días hábiles');
  const resultado = evaluarVigencia({ regla, issuedAt: '2026-06-18', closeDate: CIERRE });
  assert.equal(resultado.estado, 'no_alcanza');
  assert.match(resultado.detalle, /días hábiles al cierre\): pasa de los 90 días hábiles/);
});

test('caso Terminal 3: el REDAM «válido hasta 01-12-2026» sirve si el pliego lo pide vigente al cierre: no se reexpide', () => {
  const regla = reglaDeVigencia('El certificado del REDAM debe estar vigente a la fecha de cierre.');
  assert.equal(regla.tipo, 'vigente_al_cierre');
  assert.equal(evaluarVigencia({ regla, expiresAt: '2026-12-01', closeDate: CIERRE }).estado, 'cumple');
});

test('sin regla clara en el pliego, «por confirmar»; nunca una fecha adivinada', () => {
  const resultado = evaluarVigencia({ regla: reglaDeVigencia('Aportar el certificado de existencia y representación legal.'), issuedAt: '2026-01-01', closeDate: CIERRE });
  assert.equal(resultado.estado, 'por_confirmar');
  assert.equal(resultado.expedir_desde, undefined);
});

test('caso Supersalud: un requisito con dos reglas da una a cada documento', () => {
  const texto = 'Documentos técnicos: certificado de multas y sanciones con expedición no mayor a 90 días hábiles; certificado de armamento del Ministerio de Defensa no mayor a 60 días calendario; póliza de responsabilidad civil.';
  const reglas = reglasPorDocumento(texto, matchCompanyDocumentClasses);
  assert.deepEqual(reglas.get('no_fines_sanctions_certificate') && [reglas.get('no_fines_sanctions_certificate').cantidad, reglas.get('no_fines_sanctions_certificate').habiles], [90, true]);
  assert.deepEqual(reglas.get('authorized_weapons_list') && [reglas.get('authorized_weapons_list').cantidad, reglas.get('authorized_weapons_list').habiles], [60, false]);
});

test('la matriz lleva la vigencia de cada soporte y cuenta lo que no alcanza', () => {
  const matrix = buildTenderComplianceMatrix({
    requirementRows: [{ key: 'r1', area: 'Jurídico', title: 'RUP', demand: 'RUP con expedición no mayor a 30 días calendario.', status: 'por_confirmar', actions: [], sources: [] }],
    bridge: { close_date: CIERRE, rows: [{ key: 'rup', state: 'listo_al_cierre', document: { issued_at: '2026-09-28', display_name: 'RUP.pdf' }, expires_at: null, age_at_close_days: 37 }] },
  });
  const rup = matrix.rows[0].company_support.find(item => item.key === 'rup');
  assert.equal(rup.vigencia_al_cierre.estado, 'no_alcanza');
  assert.match(rup.regla_del_pliego, /no mayor a 30 días calendario/);
  assert.equal(matrix.summary.vigencias_que_no_alcanzan, 1);
});
