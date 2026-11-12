// Estudios de Seguridad Física: comparación con el estudio anterior (migración 212; Juan, 2026-11-12: "vamos adelante").
// Héctor: quien revisa compara qué riesgos hay y cómo se movieron frente al estudio anterior de la sede, y si el cliente
// aplicó lo recomendado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addAction, addRisk, createStudy, getStudy, updateStudy } from '../verticales/estudios-seguridad/estudios.js';
import { buildSnapshot, transitionStudy } from '../verticales/estudios-seguridad/flujo.js';
import { buildStudyReport } from '../verticales/estudios-seguridad/informe.js';
import { reviewStudy } from '../verticales/estudios-seguridad/revisor.js';
import { compareRisks } from '../verticales/estudios-seguridad/comparacion.js';
import { APPROVER, PREPARER, REVIEWER, database, supabaseOver } from './helpers/estudios-seguridad-db.mjs';

const STUDY = {
  title: 'Estudio 2026', client_source: 'avancys', client_ref: '900123456', client_name: 'Cliente de prueba S.A.S.',
  site_source: 'avancys_puesto', site_ref: 'PU-0001', site_name: 'Bodega principal', site_city: 'Pereira', scope: 'Bodega y perímetro.', visit_date: '2026-03-01',
};
const go = async (db, id) => { for (const [action, who] of [['enviar', PREPARER], ['marcar_revisado', REVIEWER], ['aprobar', APPROVER]]) await transitionStudy(db, id, { action }, who); };

test('emparejar y clasificar: por código o por nombre; con otra metodología se compara el nivel', () => {
  const r = (numero, codigo, titulo, magnitud, nivel) => ({ numero, codigo, titulo, magnitud, nivel, residual: nivel });
  const before = [r(1, 'RB-01', 'Acceso no autorizado', 9, 'tolerable'), r(2, 'RB-05', 'Hurto', 12, 'tolerable'), r(3, null, 'Robo de cable', 6, 'aceptable'), r(4, 'RB-27', 'Incendio', 4, 'aceptable')];
  const after = [r(1, 'RB-01', 'Ingreso de personas sin carné', 16, 'inaceptable'), r(2, 'RB-05', 'Hurto de mercancía', 8, 'tolerable'), r(3, 'RB-23', 'Falla de CCTV', 6, 'aceptable'), r(4, null, 'Robo  de cable ', 6, 'aceptable')];
  const result = compareRisks(before, after);
  assert.deepEqual(result.rows.map(row => [row.estado, row.actual?.numero ?? null, row.anterior?.numero ?? null]), [['sube', 1, 1], ['nuevo', 3, null], ['ya_no_esta', null, 4], ['igual', 4, 3], ['baja', 2, 2]]);
  assert.deepEqual(result.resumen, { sube: 1, baja: 1, igual: 1, nuevo: 1, ya_no_esta: 1 });
  // Metodología distinta: 9 → 16 no se compara por magnitud sino por nivel (tolerable → inaceptable sube; 12 → 8, ambos tolerable: igual).
  const other = compareRisks(before, after, { sameMethodology: false });
  assert.deepEqual(other.rows.filter(row => row.actual && row.anterior).map(row => [row.actual.numero, row.estado]), [[1, 'sube'], [2, 'igual'], [4, 'igual']]);
});

test('el estudio nuevo de la misma sede toma solo el anterior aprobado, y la ficha, el revisor, la versión y el informe lo usan', async () => {
  const pg = await database();
  const db = supabaseOver(pg);
  const first = await createStudy(db, STUDY, PREPARER);
  const a1 = await addRisk(db, first.id, { catalog_risk_code: 'RB-01', title: 'Acceso no autorizado', probability: 3, impact_company: 3 }, PREPARER);
  const a2 = await addRisk(db, first.id, { catalog_risk_code: 'RB-05', title: 'Hurto de mercancía', probability: 4, impact_company: 3, probability_basis: 'Hurtos reportados por el cliente en 2025.' }, PREPARER);
  await addRisk(db, first.id, { title: 'Robo de cable', probability: 2, impact_company: 2 }, PREPARER);
  await addAction(db, first.id, { risk_id: a1.id, description: 'Torniquetes en portería', owner_label: 'Seguridad', due_date: '2026-06-30' }, PREPARER);
  const malla = await addAction(db, first.id, { risk_id: a2.id, description: 'Reparar la malla norte', owner_label: 'Cliente', due_date: '2026-05-30', responsible_party: 'cliente' }, PREPARER);
  assert.equal((await createStudy(db, { ...STUDY, title: 'Antes de aprobar' }, PREPARER)).previous_study_id ?? null, null, 'un borrador no sirve de anterior');
  await go(db, first.id);
  await pg.query(`update public.psi_security_study_actions set status = 'cumplida' where description = 'Torniquetes en portería'`);

  const other = await createStudy(db, { ...STUDY, title: 'Otra sede', site_ref: 'PU-0002', site_name: 'Planta sur' }, PREPARER);
  assert.equal(other.previous_study_id ?? null, null, 'otra sede: sin anterior');
  const second = await createStudy(db, { ...STUDY, title: 'Estudio 2027', visit_date: '2027-03-01' }, PREPARER);
  assert.equal(second.previous_study_id, first.id);

  await addRisk(db, second.id, { catalog_risk_code: 'RB-01', title: 'Ingreso de personas sin carné', probability: 5, impact_company: 3, probability_basis: 'Tres ingresos sin carné en el último año.' }, PREPARER);
  await addRisk(db, second.id, { catalog_risk_code: 'RB-05', title: 'Hurto de mercancía', probability: 2, impact_company: 3 }, PREPARER);
  await addRisk(db, second.id, { catalog_risk_code: 'RB-23', title: 'Falla de CCTV', probability: 2, impact_company: 3 }, PREPARER);
  const detail = await getStudy(db, second.id);
  const c = detail.comparison;
  assert.equal(c.estudio.codigo, first.code);
  assert.deepEqual(c.resumen, { sube: 1, baja: 1, igual: 0, nuevo: 1, ya_no_esta: 1 });
  assert.deepEqual(c.recomendaciones.map(item => [item.accion, item.estado]), [['Torniquetes en portería', 'cumplida'], ['Reparar la malla norte', 'pendiente']]);

  const review = await reviewStudy(db, detail);
  assert.ok(review.findings.some(item => item.code === 'riesgo_anterior_ausente' && /«Robo de cable» estaba en el estudio anterior/.test(item.message)));
  assert.ok(review.findings.some(item => item.code === 'recomendaciones_anteriores_pendientes' && /1 recomendación del estudio anterior/.test(item.message)));

  const { snapshot } = buildSnapshot(detail);
  assert.deepEqual(snapshot.comparacion.resumen, c.resumen);
  const text = JSON.stringify(buildStudyReport(snapshot, { version: 1, sha256: 'a'.repeat(64), approvedAt: '2027-03-10T15:00:00Z', approverName: 'Alba', preparerName: 'Ana' }).blocks);
  assert.match(text, /Comparación con el estudio anterior/);
  assert.match(text, /1 riesgos suben, 1 bajan, 0 siguen igual, 1 son nuevos y 1 ya no están/);
  assert.match(text, /Reparar la malla norte — a cargo del cliente, para el 30 de mayo de 2026; hoy pendiente/);
  assert.ok(malla.id);

  await assert.rejects(updateStudy(db, second.id, { previous_study_id: other.id }, PREPARER), /aprobado/);
  await assert.rejects(updateStudy(db, second.id, { previous_study_id: second.id }, PREPARER), /propio/);
  await updateStudy(db, second.id, { previous_study_id: null }, PREPARER);
  assert.equal((await getStudy(db, second.id)).comparison, null, '"No comparar"');
});

test('migración 212: no puede apuntarse a sí mismo, y reversa', async () => {
  const pg = await database();
  const study = await createStudy(supabaseOver(pg), STUDY, PREPARER);
  await assert.rejects(pg.query('update public.psi_security_studies set previous_study_id = id where id = $1', [study.id]), /previous_not_self/);
  await pg.exec(readFileSync(new URL('../supabase/rollbacks/212_estudios_seguridad_estudio_anterior_rollback.sql', import.meta.url), 'utf8'));
  const columns = await pg.query(`select column_name from information_schema.columns where table_name = 'psi_security_studies' and column_name = 'previous_study_id'`);
  assert.equal(columns.rows.length, 0);
  assert.equal((await getStudy(supabaseOver(pg), study.id)).comparison, null, 'sin la columna, la ficha se sigue viendo');
});
