// Estudios de Seguridad Física: calificación según IEC 31010 (Juan, 2026-11-11: "vamos a regirnos por la norma").
//
// 1. Con impacto 5 el nivel mínimo es tolerable y se exige plan de contingencia.
// 2. La plataforma sugiere la probabilidad con los datos (estadística de la zona y SecurityOps); si el analista se aparta,
//    explica por qué. Sin datos, la calificación queda como juicio sin dato.
// 3. Cada riesgo declara su confianza y sus supuestos; el informe lo dice y cita las normas sin afirmar certificación.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addAction, addRisk, createStudy, getStudy, updateRisk } from '../verticales/estudios-seguridad/estudios.js';
import { addCharacterizationRow } from '../verticales/estudios-seguridad/caracterizacion.js';
import { buildSnapshot, readinessIssues } from '../verticales/estudios-seguridad/flujo.js';
import { buildStudyReport } from '../verticales/estudios-seguridad/informe.js';
import { confirmFieldNote } from '../verticales/estudios-seguridad/agente.js';
import { reviewStudy } from '../verticales/estudios-seguridad/revisor.js';
import { PLANTILLA_INSTALACIONES_FISICAS_V1 } from '../verticales/estudios-seguridad/plantilla.js';
import { suggestProbability } from '../verticales/estudios-seguridad/sugerencia.js';
import { PREPARER, database, supabaseOver } from './helpers/estudios-seguridad-db.mjs';

const STUDY = {
  title: 'Estudio con datos', client_source: 'avancys', client_ref: '900123456', client_name: 'Cliente de prueba S.A.S.',
  site_source: 'manual', site_name: 'Bodega', site_city: 'Pereira', scope: 'Bodega y perímetro.', visit_date: '2026-11-10',
};
const catalog = PLANTILLA_INSTALACIONES_FISICAS_V1;
const ops = porTipo => ({ data: { status: 'ok', summary: { novedades: { por_tipo: porTipo }, fallas: { total: 2 } } } });

test('la sugerencia: escala anclada, datos por categoría y sin datos no hay sugerencia', () => {
  assert.equal(suggestProbability({ catalogCode: 'RB-01', catalog }), null, 'sin datos: juicio sin dato');
  assert.equal(suggestProbability({ catalogCode: 'RB-01', catalog, crimeStats: [{}] }).probabilidad, 2, 'sólo antecedentes en la zona');
  const one = suggestProbability({ catalogCode: 'RB-05', catalog, securityops: ops({ seguridad: 1, general: 40 }) });
  assert.deepEqual([one.probabilidad, one.significado], [3, 'ocurrió en la sede una vez en el último año']);
  assert.match(one.fuente, /1 novedad de seguridad/);
  assert.equal(suggestProbability({ catalogCode: 'RB-05', catalog, securityops: ops({ seguridad: 2, judicializacion: 1 }) }).probabilidad, 4);
  assert.equal(suggestProbability({ catalogCode: 'RB-05', catalog, securityops: ops({ seguridad: 7 }) }).probabilidad, 5);
  assert.equal(suggestProbability({ catalogCode: 'RB-05', catalog, securityops: ops({ general: 30 }) }).probabilidad, 1, 'las novedades generales no cuentan como hurto');
  // Medios técnicos: novedades de tecnología y fallas; la estadística de delitos no aplica.
  const tech = suggestProbability({ catalogCode: 'RB-23', catalog, securityops: ops({ tecnologia: 1 }), crimeStats: [{}] });
  assert.deepEqual([tech.probabilidad, /2 fallas/.test(tech.fuente)], [4, true]);
  assert.equal(suggestProbability({ catalogCode: 'RB-20', catalog, securityops: ops({ seguridad: 9 }) }), null, 'información: no hay datos que la midan');
  assert.equal(suggestProbability({ catalogCode: 'RB-13', catalog, securityops: ops({ seguridad: 9 }) }), null, 'accidentes: tampoco');
});

test('si el analista se aparta de la sugerida, explica por qué; editar un texto no lo obliga de nuevo', async () => {
  const pg = await database();
  const db = supabaseOver(pg);
  const study = await createStudy(db, STUDY, PREPARER);
  await addCharacterizationRow(db, study.id, 'estadisticas', { crime: 'Hurto a comercio', count: 616, source: 'Policía Nacional', cutoff_date: '2026-10-20' });
  const base = { catalog_risk_code: 'RB-05', title: 'Hurto de mercancía', impact_company: 4 };
  await assert.rejects(addRisk(db, study.id, { ...base, probability: 4 }, PREPARER), /los datos sugieren 2 .*explique por qué/);
  const justified = await addRisk(db, study.id, { ...base, probability: 4, probability_basis: 'Dos hurtos reportados por el cliente en octubre.', confidence: 'media', assumptions: 'El cliente reporta todos los hurtos.' }, PREPARER);
  assert.deepEqual([justified.suggested_probability, justified.probability, justified.confidence], [2, 4, 'media']);
  const matching = await addRisk(db, study.id, { ...base, title: 'Hurto a personas', catalog_risk_code: 'RB-06', probability: 2 }, PREPARER);
  assert.equal(matching.suggested_probability, 2, 'coincide: no pide justificación');
  await assert.rejects(addRisk(db, study.id, { ...base, probability: 3, confidence: 'regular', probability_basis: 'xxxxxxxxxxxx' }, PREPARER), /Confianza/);
  // Cambia la estadística: editar el título no exige justificar de nuevo; cambiar la probabilidad sí.
  await pg.query('delete from public.psi_security_study_crime_stats');
  await updateRisk(db, study.id, matching.id, { ...matching, title: 'Hurto a personas en la portería' }, PREPARER);
  const own = await addRisk(db, study.id, { title: 'Riesgo propio sin datos', probability: 5, impact_company: 2 }, PREPARER);
  assert.equal(own.suggested_probability, null, 'sin datos: juicio sin dato');
});

test('impacto 5: mínimo tolerable y plan de contingencia obligatorio; el informe lo dice y cita las normas', async () => {
  const pg = await database();
  const db = supabaseOver(pg);
  const study = await createStudy(db, STUDY, PREPARER);
  const rare = await addRisk(db, study.id, { catalog_risk_code: 'RB-17', title: 'Atentado con explosivos', probability: 1, impact_company: 5, confidence: 'baja' }, PREPARER);
  assert.deepEqual([rare.valuation.actual.magnitud, rare.valuation.actual.nivel], [5, 'tolerable']);
  let detail = await getStudy(db, study.id);
  assert.match(readinessIssues(detail).join(' '), /R1 tiene impacto crítico: necesita un plan de contingencia/);
  await addAction(db, study.id, { risk_id: rare.id, description: 'Protocolo de amenaza de bomba y evacuación', owner_label: 'Seguridad', due_date: '2026-12-15' }, PREPARER);
  detail = await getStudy(db, study.id);
  assert.deepEqual(readinessIssues(detail), []);

  const { snapshot } = buildSnapshot(detail);
  assert.equal(snapshot.riesgos[0].confianza, 'baja');
  const text = JSON.stringify(buildStudyReport(snapshot, { version: 1, sha256: 'a'.repeat(64), approvedAt: '2026-11-12T15:00:00Z', approverName: 'Alba', preparerName: 'Ana' }).blocks);
  assert.match(text, /NTC-IEC\/ISO 31010 \(adopción de IEC 31010:2019\)/);
  assert.match(text, /no constituye una certificación/);
  assert.match(text, /5 · Tolerable \(mínimo por impacto crítico\)/);
  assert.match(text, /Sin dato de respaldo: juicio del analista/);
  assert.match(text, /ocurrió en la sede una vez en el último año/, 'la escala anclada en la metodología');
});

test('la nota de campo no deja nada a medias si un riesgo no justifica su probabilidad', async () => {
  const pg = await database();
  const db = supabaseOver(pg);
  const study = await createStudy(db, STUDY, PREPARER);
  await addCharacterizationRow(db, study.id, 'estadisticas', { crime: 'Hurto a comercio', count: 616, source: 'Policía Nacional', cutoff_date: '2026-10-20' });
  const risk = (title, probability, extra = {}) => ({ zone_id: null, zone_ref: null, catalog_risk_code: 'RB-05', process_code: null, title, probability, impact_company: 3, impact_people: 3, ...extra });
  await assert.rejects(confirmFieldNote(db, study.id, { zonas_nuevas: [], riesgos: [risk('Hurto en bodega', 2), risk('Hurto en patio', 4)] }, PREPARER), /Riesgo 2 .*explique por qué/);
  assert.equal((await getStudy(db, study.id)).risks.length, 0, 'nada a medias');
  const created = await confirmFieldNote(db, study.id, { zonas_nuevas: [], riesgos: [risk('Hurto en bodega', 2), risk('Hurto en patio', 4, { probability_basis: 'El patio no tiene iluminación y ya hubo un intento.' })] }, PREPARER);
  assert.equal(created.riesgos.length, 2);
});

test('el revisor señala juicio sin dato y confianza baja en riesgos graves', async () => {
  const pg = await database();
  const db = supabaseOver(pg);
  const study = await createStudy(db, STUDY, PREPARER);
  await addRisk(db, study.id, { title: 'Intrusión nocturna', probability: 5, impact_company: 4, confidence: 'baja' }, PREPARER);
  const review = await reviewStudy(db, await getStudy(db, study.id));
  const codes = review.findings.map(item => item.code);
  assert.ok(codes.includes('juicio_sin_dato'));
  assert.ok(codes.includes('confianza_baja'));
});

test('migración 208: columnas opcionales con sus valores válidos, y reversa', async () => {
  const pg = await database();
  const study = await createStudy(supabaseOver(pg), STUDY, PREPARER);
  const insert = confidence => pg.query(`insert into public.psi_security_study_risks (study_id, number, title, probability, impact_company, impact_people, created_by, confidence) values ($1, $2, 'xxx', 1, 1, 1, $3, $4)`, [study.id, confidence === 'alta' ? 1 : 2, PREPARER.id, confidence]);
  await insert('alta');
  await assert.rejects(insert('regular'), /confidence/);
  await pg.exec(readFileSync(new URL('../supabase/rollbacks/208_estudios_seguridad_norma_31010_rollback.sql', import.meta.url), 'utf8'));
  const columns = await pg.query(`select column_name from information_schema.columns where table_name = 'psi_security_study_risks' and column_name in ('suggested_probability', 'probability_basis', 'confidence', 'assumptions')`);
  assert.equal(columns.rows.length, 0);
});
