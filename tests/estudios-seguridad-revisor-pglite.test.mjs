// Estudios de Seguridad Física, tramo 9 — el revisor de inconsistencias (Juan, 2026-11-06: "vamos con el 9").
//
// Reglas fijas que señalan lo que en los estudios reales se coló (§2.3 del plan). El revisor sólo lee: la prueba de
// servidor comprueba que no escribe nada y que el estudio queda idéntico.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addAction, addRisk, createStudy, getStudy } from '../verticales/estudios-seguridad/estudios.js';
import { clientCore, consistencyFindings, reviewStudy } from '../verticales/estudios-seguridad/revisor.js';
import { PREPARER, database, supabaseOver } from './helpers/estudios-seguridad-db.mjs';

const STUDY = {
  title: 'Estudio Planta Norte', client_source: 'avancys', client_ref: '900123456', client_name: 'Jabones del Norte S.A.S.',
  site_source: 'manual', site_name: 'Planta Norte', scope: 'Planta y bodegas.', visit_date: '2026-11-10',
};
const OTHER = { ...STUDY, title: 'Estudio HADA', client_ref: '800999111', client_name: 'Hada International S.A.' };
const SAME = { probability: 3, impact_company: 3, impact_people: 2, current_quality: 3, current_efficacy: 3, current_efficiency: 3 };

async function studyWithProblems() {
  const pg = await database();
  const db = supabaseOver(pg);
  await createStudy(db, OTHER, PREPARER);
  const study = await createStudy(db, STUDY, PREPARER);
  // R1: alto, sin control propuesto, sin foto, con "Hada International" copiado y causas con el número 3 dos veces.
  await addRisk(db, study.id, {
    title: 'Hurto de producto terminado', probability: 5, impact_company: 4, impact_people: 2, current_control: 'Guardas en portería', current_quality: 3, current_efficacy: 4, current_efficiency: 3,
    causes: '1. Bodega sin cámaras\n3. Rotación de personal\n3. Rotación de personal en Hada International',
  }, PREPARER);
  // R2 a R4: las mismas calificaciones, copiadas. R4 repite el nombre de R2.
  await addRisk(db, study.id, { title: 'Acceso indebido', current_control: 'Control de acceso', ...SAME }, PREPARER);
  await addRisk(db, study.id, { title: 'Sabotaje', current_control: 'Rondas', ...SAME }, PREPARER);
  const r4 = await addRisk(db, study.id, { title: 'Acceso  indebido', current_control: 'Rondas', ...SAME, proposed_control: 'Torniquetes' }, PREPARER);
  // R5: control calificado sin describir; propuesto más débil que el existente.
  await addRisk(db, study.id, { title: 'Intrusión nocturna', probability: 2, impact_company: 2, impact_people: 2, current_quality: 4, current_efficacy: 4, current_efficiency: 4, proposed_control: 'Perro', proposed_quality: 2, proposed_efficacy: 2, proposed_efficiency: 2 }, PREPARER);
  await addAction(db, study.id, { risk_id: r4.id, description: 'Instalar torniquetes', owner_label: 'Mantenimiento', due_date: '2026-10-01' }, PREPARER);
  return { pg, db, study };
}

test('el nombre del cliente se compara sin sufijos societarios ni tildes', () => {
  assert.equal(clientCore('Hada International S.A.'), 'hada international');
  assert.equal(clientCore('JABONES DEL NORTE S.A.S'), 'jabones del norte');
  assert.equal(clientCore('Compañía Andina Ltda.'), 'compania andina');
});

test('señala lo que se coló en los estudios reales', async () => {
  const { db, study } = await studyWithProblems();
  const review = await reviewStudy(db, await getStudy(db, study.id));
  const codes = review.findings.map(item => item.code);
  const said = code => review.findings.filter(item => item.code === code).map(item => item.message);

  assert.equal(review.blocking, 1);
  assert.match(said('incompleto')[0], /R1 está en nivel inaceptable y no tiene una acción con responsable y fecha/);
  assert.deepEqual(said('otro_cliente'), ['Aparece el nombre de otro cliente («Hada International S.A.») en R1. ¿Se copió de otro estudio?']);
  assert.deepEqual(said('calificaciones_identicas'), ['R2, R3 y R4 tienen exactamente las mismas calificaciones (probabilidad, impactos y controles). ¿Se valoró cada uno o se copiaron?']);
  assert.deepEqual(said('sin_control_propuesto'), ['R1 está en nivel inaceptable y no tiene control propuesto: el residual queda igual al actual.']);
  assert.deepEqual(said('sin_foto'), ['R1 está en nivel inaceptable y no tiene ninguna foto que lo respalde.']);
  assert.deepEqual(said('causas_numeracion'), ['R1: hay dos causas con el número 3.']);
  assert.deepEqual(said('riesgo_repetido'), ['R2 y R4 tienen el mismo nombre.']);
  assert.deepEqual(said('control_sin_calificar'), ['R4: el control propuesto está descrito pero no calificado, así que no cuenta en la valoración.']);
  assert.deepEqual(said('calificacion_sin_control'), ['R5: el control existente está calificado pero no dice cuál es.']);
  assert.deepEqual(said('propuesto_mas_debil'), ['R5: el control propuesto califica peor que el existente.']);
  assert.deepEqual(said('fecha_accion'), ['Una acción de R4 vence (2026-10-01) antes de la visita (2026-11-10).']);
  assert.ok(!codes.includes('causas_repetidas'), 'las dos causas 3 dicen cosas distintas');
});

test('un estudio limpio no tiene hallazgos, y el mismo cliente no cuenta como otro', async () => {
  const pg = await database();
  const db = supabaseOver(pg);
  await createStudy(db, { ...STUDY, title: 'Otra sede del mismo cliente', client_name: 'JABONES DEL NORTE SAS' }, PREPARER);
  const study = await createStudy(db, STUDY, PREPARER);
  await addRisk(db, study.id, { title: 'Hurto menor de Jabones del Norte', probability: 2, impact_company: 2, impact_people: 1, current_control: 'Rondas', current_quality: 3, current_efficacy: 3, current_efficiency: 3 }, PREPARER);
  const review = await reviewStudy(db, await getStudy(db, study.id));
  // Sin el recorrido guiado (migración 214) queda sólo ese aviso: lo demás está limpio.
  assert.deepEqual(review.findings.map(item => item.code), ['recorrido_sin_hacer']);
  assert.equal(review.blocking, 0);
});

test('el revisor no cambia estados, calificaciones ni textos: sólo lee (prueba de servidor)', async () => {
  const { pg, db, study } = await studyWithProblems();
  const dump = async () => JSON.stringify((await pg.query(`
    select (select json_agg(s order by s.id) from public.psi_security_studies s) as studies,
           (select json_agg(r order by r.id) from public.psi_security_study_risks r) as risks,
           (select json_agg(a order by a.id) from public.psi_security_study_actions a) as actions,
           (select count(*) from public.psi_security_study_events) as events,
           (select count(*) from public.siio_followups) as followups`)).rows[0]);
  const before = await dump();
  const operations = [];
  const spy = {
    ...db,
    rpc: (...args) => { operations.push(`rpc:${args[0]}`); return db.rpc(...args); },
    from: table => {
      const real = db.from(table);
      for (const write of ['insert', 'update', 'delete', 'upsert']) real[write] = () => { operations.push(`${write}:${table}`); throw new Error('el revisor no escribe'); };
      return real;
    },
  };
  const detail = await getStudy(db, study.id);
  const review = await reviewStudy(spy, detail);
  assert.ok(review.total > 0);
  assert.deepEqual(operations, [], 'ni escrituras ni funciones');
  assert.equal(await dump(), before, 'el estudio queda idéntico');
  // Y es puro sobre el detalle: no lo modifica.
  const frozen = JSON.stringify(detail);
  consistencyFindings(detail, { otherClients: ['Hada International S.A.'] });
  assert.equal(JSON.stringify(detail), frozen);
});
