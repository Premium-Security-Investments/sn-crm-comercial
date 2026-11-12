// Estudios de Seguridad Física: indicador por riesgo (Juan, 2026-11-12: "vamos con A"). Después de aprobar, si las
// novedades de SecurityOps de la sede superan la probabilidad calificada, el tablero pide revalorar ese riesgo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addRisk, createStudy, getStudy, listStudies } from '../verticales/estudios-seguridad/estudios.js';
import { transitionStudy } from '../verticales/estudios-seguridad/flujo.js';
import { PLANTILLA_INSTALACIONES_FISICAS_V1 } from '../verticales/estudios-seguridad/plantilla.js';
import { riskIndicators } from '../verticales/estudios-seguridad/sugerencia.js';
import { APPROVER, PREPARER, REVIEWER, database, supabaseOver } from './helpers/estudios-seguridad-db.mjs';

const ops = seguridad => ({ data: { status: 'ok', summary: { novedades: { por_tipo: { seguridad }, altas_fechas: [] } } } });
const catalog = PLANTILLA_INSTALACIONES_FISICAS_V1;
const hurto = catalog.riesgos.find(item => item.categoria === 'Bienes, carga e instalaciones').codigo;

test('avisa sólo si los hechos superan lo calificado y lo que sugerían los datos al calificar', () => {
  const risk = { number: 3, title: 'Hurto en bodega', catalog_risk_code: hurto, probability: 2, suggested_probability: 2 };
  const [alert] = riskIndicators({ risks: [risk], catalog, securityops: ops(4) });
  assert.deepEqual([alert.riesgo, alert.calificada, alert.hechos], [3, 2, 4]);
  assert.match(alert.detalle, /^R3 Hurto en bodega se calificó con probabilidad 2, pero los hechos ya corresponden a 4/);
  assert.deepEqual(riskIndicators({ risks: [{ ...risk, probability: 4 }], catalog, securityops: ops(4) }), [], 'calificada igual a los hechos');
  assert.deepEqual(riskIndicators({ risks: [{ ...risk, suggested_probability: 4 }], catalog, securityops: ops(4) }), [], 'el analista ya vio ese dato y justificó apartarse');
  assert.deepEqual(riskIndicators({ risks: [risk], catalog, securityops: ops(0) }), [], 'sin novedades en la sede no hay hecho nuevo');
  assert.deepEqual(riskIndicators({ risks: [risk], catalog, securityops: null }), [], 'sin SecurityOps, nada');
});

test('en el tablero: sólo estudios aprobados, como motivo de revaloración', async () => {
  const pg = await database();
  const db = supabaseOver(pg);
  const study = await createStudy(db, {
    title: 'Estudio con indicador', client_source: 'avancys', client_ref: '900123456', client_name: 'Cliente de prueba S.A.S.',
    site_source: 'manual', site_name: 'Bodega', site_city: 'Pereira', scope: 'Bodega.', visit_date: '2026-11-01',
  }, PREPARER);
  await addRisk(db, study.id, { catalog_risk_code: hurto, title: 'Hurto en bodega', probability: 2, impact_company: 3 }, PREPARER);
  const sync = async count => pg.query(`insert into public.psi_security_study_securityops (study_id, puesto_id, status, summary, synced_at)
    values ($1, 'P-1', 'ok', $2, now()) on conflict (study_id) do update set summary = excluded.summary`, [study.id, JSON.stringify(ops(count).data.summary)]);
  await pg.query(`update public.psi_security_studies set securityops_puesto_id = 'P-1' where id = $1`, [study.id]);
  await sync(0);
  for (const [action, who] of [['enviar', PREPARER], ['marcar_revisado', REVIEWER], ['aprobar', APPROVER]]) await transitionStudy(db, study.id, { action }, who);
  const row = async () => (await listStudies(db)).find(item => item.id === study.id);
  assert.deepEqual((await row()).validity.revalorar, []);
  await sync(4);
  const [alert] = (await row()).validity.revalorar;
  assert.equal(alert.motivo, 'indicador');
  assert.equal(alert.riesgo, 1);
  assert.equal((await getStudy(db, study.id)).validity.revalorar[0].motivo, 'indicador', 'también en la ficha');
});
