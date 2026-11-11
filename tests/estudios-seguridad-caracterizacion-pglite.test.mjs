// Estudios de Seguridad Física, tramo 5 — lo que faltaba capturar (Juan, 2026-11-05), tomado del informe real de HADA:
// proceso del cliente y factor de riesgo, caracterización de la sede, estadística de delitos, contactos, dispositivo
// (sembrable desde Avancys), mapa y logo, escalas con los nombres de la casa y calificaciones en palabras.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addAction, addRisk, createStudy, getStudy, updateStudy } from '../verticales/estudios-seguridad/estudios.js';
import { addCharacterizationRow, deleteCharacterizationRow, seedPostsFromAvancys, updateCharacterizationRow } from '../verticales/estudios-seguridad/caracterizacion.js';
import { completeEvidenceUpload, requestEvidenceUpload } from '../verticales/estudios-seguridad/evidencias.js';
import { buildSnapshot } from '../verticales/estudios-seguridad/flujo.js';
import { buildStudyReport } from '../verticales/estudios-seguridad/informe.js';
import { ESCALAS, controlWord } from '../verticales/estudios-seguridad/plantilla.js';
import { AGT002_DOCUMENT_TEMPLATE_PATH } from '../verticales/licitaciones/agt002-document-render.js';
import { buildStudyReportFodt } from '../verticales/estudios-seguridad/render-informe.js';
import { PREPARER, database, supabaseOver } from './helpers/estudios-seguridad-db.mjs';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const PDF = new TextEncoder().encode('%PDF-1.7 mapa');
const STUDY = {
  title: 'Plan estratégico HADA', client_source: 'avancys', client_ref: '900111222', client_name: 'Cliente de prueba S.A.S.', client_nit: '900111222',
  site_source: 'manual', site_name: 'Zona Franca La Cayena', site_city: 'Barranquilla', scope: 'Planta y bodegas.', visit_date: '2026-10-25',
};

async function setup() {
  const pg = await database();
  const db = supabaseOver(pg);
  const study = await createStudy(db, STUDY, PREPARER);
  return { pg, db, study };
}

test('migración 187: tablas sólo del servidor, columnas opcionales y reversa', async () => {
  const { pg } = await setup();
  for (const table of ['psi_security_study_crime_stats', 'psi_security_study_contacts', 'psi_security_study_posts']) {
    const grants = await pg.query(`select grantee, privilege_type from information_schema.role_table_grants where table_name = $1 order by 1, 2`, [table]);
    assert.deepEqual(grants.rows.map(row => `${row.grantee}:${row.privilege_type}`).filter(item => !item.startsWith('postgres')),
      ['service_role:DELETE', 'service_role:INSERT', 'service_role:SELECT', 'service_role:UPDATE'], table);
    assert.equal((await pg.query(`select relrowsecurity from pg_class where relname = $1`, [table])).rows[0].relrowsecurity, true);
  }
  await pg.exec(readFileSync(new URL('../supabase/rollbacks/187_estudios_seguridad_caracterizacion_rollback.sql', import.meta.url), 'utf8'));
  assert.equal((await pg.query(`select to_regclass('public.psi_security_study_posts') as t`)).rows[0].t, null);
  const columns = await pg.query(`select column_name from information_schema.columns where table_name = 'psi_security_study_risks' and column_name in ('client_process', 'risk_factor')`);
  assert.equal(columns.rows.length, 0);
});

test('la caracterización se guarda en el estudio y las tablas validan lo que reciben', async () => {
  const { db, study } = await setup();
  const updated = await updateStudy(db, study.id, {
    client_description: 'Grupo de empresas de manufactura de jabones y cuidado personal.',
    location_description: 'Zona Franca La Cayena, km 8 vía a Tubará. A 25 km del puerto de Barranquilla.',
    latitude: '10.951667', longitude: -74.906667,
    external_context: 'Corredor industrial con hurtos a gran escala y extorsión.',
    criminal_groups: 'Los Costeños y Los Pepes.',
    context_sources: [{ nombre: 'Defensoría del Pueblo — alerta temprana', url: 'https://www.defensoria.gov.co', fecha: '2026-10-01' }],
  }, PREPARER);
  assert.equal(Number(updated.latitude), 10.951667);
  assert.equal(updated.context_sources[0].nombre, 'Defensoría del Pueblo — alerta temprana');
  await assert.rejects(updateStudy(db, study.id, { latitude: 120 }, PREPARER), /Latitud/);
  await assert.rejects(updateStudy(db, study.id, { context_sources: [{ nombre: 'X', url: 'ftp://x' }] }, PREPARER), /Fuente 1/);

  const stat = await addCharacterizationRow(db, study.id, 'estadisticas', { crime: 'Hurto a personas', count: '10088', source: 'Policía Nacional', cutoff_date: '2026-10-20' });
  assert.equal(stat.count, 10088);
  await assert.rejects(addCharacterizationRow(db, study.id, 'estadisticas', { crime: 'Hurto', count: -1, source: 'Policía' }), /Cantidad/);
  const contact = await addCharacterizationRow(db, study.id, 'contactos', { kind: 'apoyo', entity: 'Gaula de la Policía', phone: '165' });
  await updateCharacterizationRow(db, study.id, 'contactos', contact.id, { detail: 'Antisecuestro y antiextorsión' });
  await assert.rejects(addCharacterizationRow(db, study.id, 'contactos', { kind: 'vecino', entity: 'X' }), /Tipo de contacto/);
  await assert.rejects(addCharacterizationRow(db, study.id, 'clientes', {}), error => error.status === 404);
  const post = await addCharacterizationRow(db, study.id, 'dispositivo', { name: 'Fase 4', schedule: '24 horas', armed: false, modality: 'vigilancia' });
  await deleteCharacterizationRow(db, study.id, 'dispositivo', post.id);

  const detail = await getStudy(db, study.id);
  assert.equal(detail.characterization.available, true);
  assert.deepEqual(detail.characterization.contactos.map(row => [row.entity, row.detail]), [['Gaula de la Policía', 'Antisecuestro y antiextorsión']]);
  assert.equal(detail.characterization.dispositivo.length, 0);
});

test('el dispositivo se siembra con los puestos del contrato en Avancys, sin duplicar', async () => {
  const { db, study } = await setup();
  const lector = { async puestosDelCliente({ identificacion }) {
    assert.equal(identificacion, '900111222');
    return { contratos: [{ nombre: 'Contrato 2026-01', puestos: [{ codigo: 'P-04', nombre: 'Fase 4' }, { codigo: 'P-07', nombre: 'Fase 7' }] }, { nombre: 'Canino', puestos: [{ codigo: 'K-1', nombre: 'Guía canino' }] }] };
  } };
  assert.deepEqual(await seedPostsFromAvancys(db, study.id, lector), { added: 3, already: 0, found: 3, total_contratos: 2 });
  assert.deepEqual(await seedPostsFromAvancys(db, study.id, lector), { added: 0, already: 3, found: 3, total_contratos: 2 });
  const { characterization } = await getStudy(db, study.id);
  assert.deepEqual(characterization.dispositivo.map(row => [row.source, row.source_ref, row.name]), [['avancys', 'P-04', 'Fase 4'], ['avancys', 'P-07', 'Fase 7'], ['avancys', 'K-1', 'Guía canino']]);
  const crm = await createStudy(db, { ...STUDY, client_source: 'crm', client_ref: 'c1', client_nit: null }, PREPARER);
  await assert.rejects(seedPostsFromAvancys(db, crm.id, lector), /no viene de Avancys/);
});

test('mapa y logo: imágenes imprimibles y del estudio, no de un riesgo', async () => {
  const { db, study } = await setup();
  const risk = await addRisk(db, study.id, { title: 'Intrusión perimetral', probability: 3, impact_company: 4, impact_people: 2 }, PREPARER);
  await assert.rejects(requestEvidenceUpload(db, study.id, { file_name: 'mapa.pdf', mime_type: 'application/pdf', size_bytes: 10, purpose: 'mapa' }), /JPG o PNG/);
  await assert.rejects(requestEvidenceUpload(db, study.id, { file_name: 'logo.png', mime_type: 'image/png', size_bytes: 10, purpose: 'logo', risk_id: risk.id }), /no de un riesgo/);
  await assert.rejects(requestEvidenceUpload(db, study.id, { file_name: 'x.png', mime_type: 'image/png', size_bytes: 10, purpose: 'portada' }), /Propósito/);
  const ticket = await requestEvidenceUpload(db, study.id, { file_name: 'logo.png', mime_type: 'image/png', size_bytes: PNG.length, purpose: 'logo' });
  db.objects.set(`${ticket.bucket}/${ticket.path}`, PNG);
  const logo = await completeEvidenceUpload(db, study.id, { path: ticket.path, file_name: 'logo.png', purpose: 'logo' }, PREPARER);
  assert.equal(logo.purpose, 'logo');
  // Un PDF que dice ser PNG y quiere ser mapa: se reconoce por los bytes y se rechaza.
  const fake = await requestEvidenceUpload(db, study.id, { file_name: 'mapa.png', mime_type: 'image/png', size_bytes: PDF.length, purpose: 'mapa' });
  db.objects.set(`${fake.bucket}/${fake.path}`, PDF);
  await assert.rejects(completeEvidenceUpload(db, study.id, { path: fake.path, file_name: 'mapa.png', purpose: 'mapa' }, PREPARER), /JPG o PNG/);
});

test('el informe toma cada dato de su lugar: caracterización, dispositivo, contactos, procesos y calificaciones en palabras', async () => {
  const { db, study } = await setup();
  await updateStudy(db, study.id, { client_description: 'Manufactura de jabones desde 1956.', external_context: 'Corredor industrial con hurtos y extorsión.', criminal_groups: 'Los Costeños.', latitude: 10.95, longitude: -74.9 }, PREPARER);
  await addCharacterizationRow(db, study.id, 'estadisticas', { crime: 'Extorsión', count: 1016, source: 'Policía Nacional', cutoff_date: '2026-10-20' });
  await addCharacterizationRow(db, study.id, 'contactos', { kind: 'empresa', entity: 'Seguridad Nacional', detail: 'Coordinador operativo', phone: '3105210260' });
  await addCharacterizationRow(db, study.id, 'dispositivo', { name: 'Cold Process', schedule: '24 horas', armed: false });
  const risk = await addRisk(db, study.id, {
    title: 'Infiltración de personal con intención delictiva', client_process: 'Gestión Humana', risk_factor: 'Humano – Procedimental – Estratégico',
    probability: 3, impact_company: 4, impact_people: 3, current_control: 'Estudios de confiabilidad', current_quality: 3, current_efficacy: 3, current_efficiency: 3,
    proposed_control: 'Reevaluación periódica', proposed_quality: 4, proposed_efficacy: 4, proposed_efficiency: 4,
  }, PREPARER);
  await addAction(db, study.id, { risk_id: risk.id, description: 'Reevaluación anual del personal crítico', owner_label: 'Gestión Humana', due_date: '2026-12-15' }, PREPARER);
  const { snapshot, sha256 } = buildSnapshot(await getStudy(db, study.id));
  assert.equal(snapshot.riesgos[0].proceso_cliente, 'Gestión Humana');
  assert.equal(snapshot.caracterizacion.grupos_delincuenciales, 'Los Costeños.');
  const fodt = buildStudyReportFodt(readFileSync(AGT002_DOCUMENT_TEMPLATE_PATH, 'utf8'), buildStudyReport(snapshot, { version: 1, sha256, approvedAt: '2026-10-30T15:00:00Z', approverName: 'Alba', preparerName: 'Álvaro' }));
  for (const expected of ['Introducción', 'Manufactura de jabones desde 1956.', 'Contexto externo', 'Extorsión', 'Grupos y organizaciones delincuenciales', 'Dispositivo de seguridad', 'Cold Process', 'Procesos internos analizados', 'Gestión Humana', 'Humano – Procedimental – Estratégico', 'Medianamente confiable · Medianamente eficaz · Medianamente eficiente', 'Confiable · Eficaz · Eficiente', 'Escalonamiento o cadena de mando', '3105210260', 'Muy leve', 'Crítico']) {
    assert.ok(fodt.includes(expected), `falta en el informe: ${expected}`);
  }
});

test('escalas con los nombres de la casa y calificaciones en palabras', () => {
  assert.deepEqual(ESCALAS.probabilidad, ['Muy baja', 'Baja', 'Media', 'Alta', 'Muy alta']);
  assert.deepEqual(ESCALAS.impacto, ['Muy leve', 'Leve', 'Moderado', 'Grave', 'Crítico'], 'los de la guía de calificación');
  assert.deepEqual([2, 3, 4].map(value => controlWord('calidad', value)), ['Poco confiable', 'Medianamente confiable', 'Confiable']);
  // 1 y 5: de la guía de calificación de la sede Medellín (noviembre de 2026).
  assert.deepEqual([1, 5].map(value => controlWord('calidad', value)), ['No confiable', 'Altamente confiable']);
  assert.deepEqual([1, 5].map(value => controlWord('eficacia', value)), ['Ineficaz', 'Altamente eficaz']);
  assert.deepEqual([1, 5].map(value => controlWord('eficiencia', value)), ['Ineficiente', 'Altamente eficiente']);
  assert.equal(controlWord('eficacia', 7), 'Calificación 7', 'fuera de la escala: el número, no un nombre inventado');
  assert.equal(controlWord('eficiencia', null), null);
});
