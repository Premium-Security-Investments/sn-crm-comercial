// Estudios de Seguridad Física: SecurityOps como fuente del estudio (migración 201; Juan, 2026-11-10: "podemos construir
// ya"). El estudio se vincula a un puesto de SecurityOps; el servidor de tareas trae sus antecedentes y los reportes de
// riesgo («Alerta de Riesgos» y el «Estudio de seguridad» del historial); "Llevar al estudio" crea el riesgo con su
// referencia y las calificaciones del analista. A Firestore sólo se le piden campos sin datos de personas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addRisk, createStudy, getStudy } from '../verticales/estudios-seguridad/estudios.js';
import { buildSnapshot } from '../verticales/estudios-seguridad/flujo.js';
import { buildStudyReport } from '../verticales/estudios-seguridad/informe.js';
import {
  FIELDS, addRiskFromSecurityOps, buildAntecedentes, firestoreReader, linkPuesto, loadSecurityOps, pendingStudies,
  requestRefresh, runSecurityOpsSync, searchPuestos,
} from '../verticales/estudios-seguridad/securityops.js';
import { PREPARER, database, supabaseOver } from './helpers/estudios-seguridad-db.mjs';

const NOW = new Date('2026-11-10T15:00:00Z');
const STUDY = {
  title: 'Estudio tienda', client_source: 'avancys', client_ref: '900123456', client_name: 'Cliente de prueba S.A.S.',
  site_source: 'manual', site_name: 'Tienda Cuba', scope: 'Tienda y parqueadero.', visit_date: '2026-11-12',
};
const PUESTOS = [
  { id: 'PUESTO1', name: 'ARA Cuba Pereira', address: 'Cra 27 # 70-10', municipio: 'Pereira', departamento: 'Risaralda', regional: 'pereira', zone: 'Zona 2 - Nombre de un coordinador', sap: '0412', type: 'tienda', status: 'active', esUnidadMonitoreo: false, position: { lat: 4.8133, lng: -75.6961 }, pendienteGeo: false },
  { id: 'PUESTO2', name: 'Bodega Dosquebradas', address: 'Av. del Ferrocarril', municipio: 'Dosquebradas', regional: 'PEREIRA', status: 'active', esUnidadMonitoreo: false },
  { id: 'ALARMA1', name: 'Cuenta 4410 Cuba', address: 'Cra 27', municipio: 'Pereira', regional: 'PEREIRA', status: 'active', esUnidadMonitoreo: true },
];
const RAW = {
  novedades: [
    { id: 'n1', tipo: 'seguridad', prioridad: 'alta', createdAt: '2026-09-01T15:00:00Z' },
    { id: 'n2', tipo: 'general', prioridad: 'media', createdAt: '2026-11-11T02:00:00Z' }, // 9 p. m. del 10 en Colombia
    { id: 'n3', tipo: 'general', prioridad: 'critica', createdAt: '2025-10-01T15:00:00Z' }, // fuera de los 12 meses
  ],
  rondas: [{ id: 'r1', iniciadaEn: '2026-10-01T10:00:00Z', completitud: 80 }, { id: 'r2', iniciadaEn: '2026-10-02T10:00:00Z', completitud: 100 }],
  puesto_visits: [{ id: 'v1', arrivalAt: '2026-11-09T14:00:00Z', tipoVisita: 'supervision' }],
  reportes_fallas: [{ id: 'f1', titulo: 'Cámara 3 sin señal', estado: 'nuevo', prioridad: 'alta', createdAt: '2026-10-20T12:00:00Z' }, { id: 'f2', titulo: 'DVR', estado: 'solucionado', prioridad: 'media', createdAt: '2026-08-20T12:00:00Z' }],
  visitas_tecnico: [{ id: 't1', fecha: '2026-10-21', status: 'cerrada' }],
  formularios: [
    { id: 'ALERTA1', formType: 'alerta-riesgos', fecha: '2026-10-05', identificacionRiesgo: 'Cerramiento posterior vulnerable', descripcionAlerta: 'La malla del parqueadero está rota.', recomendaciones: 'Reparar la malla y poner concertina.', fotos: ['a', 'b'], createdByRole: 'supervisor' },
    { id: 'ALERTA2', formType: 'alerta-riesgos', fecha: '2026-11-01', identificacionRiesgo: 'Iluminación deficiente', descripcionAlerta: 'Zona de cargue a oscuras.', recomendaciones: null, fotos: [], createdByRole: 'guarda' },
  ],
  historial: [
    { id: 'NOTA1', tipo: 'estudio', titulo: 'Recorrido con el cliente', detalle: 'El cliente pide revisar el acceso de proveedores.', fecha: '2026-10-15', realizadoPor: 'Coordinación Zona 2', recomendaciones: 'Control de acceso de proveedores.', adjuntos: [{}], anulada: false },
    { id: 'NOTA2', tipo: 'estudio', titulo: 'Anulada', detalle: 'x', anulada: true },
    { id: 'CONTRATO', tipo: 'contrato', titulo: 'Contrato 2026' },
  ],
};

function fakeReader(calls = []) {
  return {
    async all(collection) { calls.push(['all', collection]); return collection === 'puestos' ? PUESTOS : []; },
    async query(collection, { where = [], parent = '' } = {}) {
      calls.push(['query', collection, parent, where]);
      const source = collection === 'historial' ? RAW.historial : RAW[collection] || [];
      return source.filter(row => where.every(([field, value]) => field === 'puestoId' || row[field] === value));
    },
  };
}

async function setup() {
  const pg = await database();
  const db = supabaseOver(pg);
  const study = await createStudy(db, STUDY, PREPARER);
  return { pg, db, study };
}

test('migración 201: tablas sólo del servidor, y la reversa conserva los riesgos como manuales', async () => {
  const { pg, db, study } = await setup();
  for (const table of ['psi_securityops_puestos', 'psi_security_study_securityops']) {
    const grants = await pg.query(`select grantee, privilege_type from information_schema.role_table_grants where table_name = $1 order by 1, 2`, [table]);
    assert.deepEqual(grants.rows.map(row => `${row.grantee}:${row.privilege_type}`).filter(item => !item.startsWith('postgres')),
      ['service_role:DELETE', 'service_role:INSERT', 'service_role:SELECT', 'service_role:UPDATE'], table);
    assert.equal((await pg.query(`select relrowsecurity from pg_class where relname = $1`, [table])).rows[0].relrowsecurity, true);
  }
  await assert.rejects(pg.query(`update public.psi_security_study_risks set origin = 'securityops'`).then(() => pg.query(`insert into public.psi_security_study_risks (study_id, number, title, probability, impact_company, impact_people, origin, created_by) values ($1, 99, 'xxx', 1, 1, 1, 'securityops', $2)`, [study.id, PREPARER.id])), /source_consistency/);
  await runSecurityOpsSync(db, fakeReader(), () => {}, NOW);
  await linkPuesto(db, study, 'PUESTO1', NOW);
  await runSecurityOpsSync(db, fakeReader(), () => {}, NOW);
  const risk = await addRiskFromSecurityOps(db, study.id, { source_ref: 'securityops:alerta:ALERTA1', title: 'Cerramiento posterior vulnerable', probability: 3, impact_company: 3, impact_people: 2 }, PREPARER, addRisk);
  await pg.exec(readFileSync(new URL('../supabase/rollbacks/201_estudios_seguridad_securityops_rollback.sql', import.meta.url), 'utf8'));
  assert.equal((await pg.query(`select origin from public.psi_security_study_risks where id = $1`, [risk.id])).rows[0].origin, 'manual');
  assert.equal((await pg.query(`select to_regclass('public.psi_securityops_puestos') as t`)).rows[0].t, null);
});

test('a Firestore sólo se le piden campos sin datos de personas, con filtro por puesto y por páginas', async () => {
  const PERSONAL = ['nombreAgente', 'cedulaAgente', 'nombreSupervisor', 'cedulaSupervisor', 'firmaUrl', 'selfieUrl', 'guardaName', 'supervisorName', 'creadoPor', 'descripcion', 'titulo_novedad', 'gpsLocation', 'coordsLat', 'uid', 'userEmail'];
  for (const [collection, fields] of Object.entries(FIELDS)) {
    for (const field of PERSONAL) assert.ok(!fields.includes(field), `${collection} no pide ${field}`);
  }
  assert.ok(!FIELDS.novedades.includes('titulo') && !FIELDS.novedades.includes('descripcion'), 'de las novedades sólo salen conteos');
  const requests = [];
  const page = (names, extra = {}) => names.map(name => ({ document: { name: `projects/p/databases/(default)/documents/puestos/${name}`, fields: { name: { stringValue: name }, position: { mapValue: { fields: { lat: { doubleValue: 4.8 }, lng: { doubleValue: -75.6 } } } }, ...extra } } }));
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, body, auth: init.headers.authorization });
    const after = body.structuredQuery.startAt?.values?.[0]?.referenceValue;
    return { ok: true, json: async () => (after ? page(['C']) : page(['A', 'B'])) };
  };
  const reader = firestoreReader({ getToken: async () => 'tk', project: 'p', fetchImpl });
  const all = await reader.all('puestos', { page: 2 });
  assert.deepEqual(all.map(row => [row.id, row.position.lat]), [['A', 4.8], ['B', 4.8], ['C', 4.8]]);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].body.structuredQuery.select.fields.map(field => field.fieldPath), FIELDS.puestos);
  assert.equal(requests[0].auth, 'Bearer tk');
  await reader.query('formularios', { where: [['puestoId', 'PUESTO1'], ['formType', 'alerta-riesgos']] });
  await reader.query('historial', { parent: 'puestos/PUESTO1', where: [['tipo', 'estudio']] });
  assert.equal(requests[2].body.structuredQuery.where.compositeFilter.filters.length, 2);
  assert.match(requests[3].url, /documents\/puestos\/PUESTO1:runQuery$/);
  await assert.rejects(firestoreReader({ getToken: async () => 'tk', fetchImpl: async () => ({ ok: false, status: 403 }) }).query('puestos'), /firestore_403/);
});

test('los antecedentes: 12 meses en hora de Colombia, alertas y notas para el estudio, y fallas abiertas', () => {
  const result = buildAntecedentes({ novedades: RAW.novedades, rondas: RAW.rondas, visitas: RAW.puesto_visits, fallas: RAW.reportes_fallas, tecnicas: RAW.visitas_tecnico, alertas: RAW.formularios, historial: RAW.historial }, NOW);
  assert.equal(result.window_from, '2025-11-10');
  assert.equal(result.window_to, '2026-11-10');
  assert.deepEqual(result.summary.novedades, { total: 2, por_tipo: { seguridad: 1, general: 1 }, altas: 1, altas_fechas: ['2026-09-01'], ultima: '2026-11-10' });
  assert.deepEqual(result.summary.rondas, { total: 2, completitud_promedio: 90 });
  assert.deepEqual(result.summary.fallas, { total: 2, abiertas: 1 });
  assert.deepEqual(result.alerts.map(alert => [alert.id, alert.fotos]), [['ALERTA2', 0], ['ALERTA1', 2]], 'la más reciente primero');
  assert.deepEqual(result.notes.map(note => note.id), ['NOTA1'], 'sin anuladas ni otros tipos del historial');
  assert.equal(result.notes[0].realizado_por, 'Coordinación Zona 2');
  assert.deepEqual(result.failures[0], { fecha: '2026-10-20', titulo: 'Cámara 3 sin señal', estado: 'nuevo', prioridad: 'alta', abierta: true });
});

test('el trabajo: directorio una vez al día, y cada estudio sólo cuando se vincula, se pide o envejece', async () => {
  const { db, study } = await setup();
  const calls = [];
  const events = [];
  const first = await runSecurityOpsSync(db, fakeReader(calls), event => events.push(event), NOW);
  assert.deepEqual(first, { directorio: { puestos: 3, inactivos: 0 }, estudios: 0, fallidos: 0 });
  assert.deepEqual(await searchPuestos(db, 'cuba'), (await searchPuestos(db, 'ARA  Cubá')).slice(0, 1));
  assert.deepEqual((await searchPuestos(db, 'cuba')).map(row => row.id), ['PUESTO1'], 'sin unidades de monitoreo');
  assert.deepEqual((await searchPuestos(db, 'cuba', { todos: true })).map(row => row.id).sort(), ['ALARMA1', 'PUESTO1']);
  const [row] = await searchPuestos(db, 'cuba');
  assert.equal(row.zone, 2, 'de la zona sólo el número: el nombre del coordinador no se guarda');
  assert.equal(Number(row.latitude), 4.8133);

  await assert.rejects(linkPuesto(db, study, 'NO-EXISTE', NOW), /no está en el directorio/);
  await assert.rejects(linkPuesto(db, study, '../x', NOW), /inválido/);
  await linkPuesto(db, study, 'PUESTO1', NOW);
  assert.equal((await pendingStudies(db, NOW)).length, 1);
  const before = (await getStudy(db, study.id)).securityops;
  assert.equal(before.pending, true);
  calls.length = 0;
  const second = await runSecurityOpsSync(db, fakeReader(calls), () => {}, new Date(NOW.getTime() + 60e3));
  assert.deepEqual(second, { directorio: null, estudios: 1, fallidos: 0 }, 'el directorio no se vuelve a leer en el mismo día');
  assert.ok(calls.some(([, collection, parent]) => collection === 'historial' && parent === 'puestos/PUESTO1'));
  const loaded = await loadSecurityOps(db, (await getStudy(db, study.id)).study);
  assert.equal(loaded.pending, false);
  assert.equal(loaded.data.alerts.length, 2);
  assert.equal((await runSecurityOpsSync(db, fakeReader(), () => {}, new Date(NOW.getTime() + 120e3))).estudios, 0, 'sin pedidos no lee');

  await requestRefresh(db, (await getStudy(db, study.id)).study, new Date(NOW.getTime() + 180e3));
  assert.equal((await runSecurityOpsSync(db, fakeReader(), () => {}, new Date(NOW.getTime() + 240e3))).estudios, 1, '"Actualizar" vuelve a leer');

  const broken = { ...fakeReader(), async query() { throw Object.assign(new Error('firestore_503'), { code: 'securityops_lectura' }); } };
  await requestRefresh(db, (await getStudy(db, study.id)).study, new Date(NOW.getTime() + 300e3));
  const failed = await runSecurityOpsSync(db, broken, event => events.push(event), new Date(NOW.getTime() + 360e3));
  assert.equal(failed.fallidos, 1);
  assert.equal((await loadSecurityOps(db, (await getStudy(db, study.id)).study)).data.status, 'error');
  assert.ok(events.some(event => event.event === 'estudios_securityops_estudio_fallido' && event.code === 'securityops_lectura'));
});

test('"Llevar al estudio": sólo alertas y notas traídas para ESTE estudio, una vez; la versión y el informe las citan', async () => {
  const { db, study } = await setup();
  await runSecurityOpsSync(db, fakeReader(), () => {}, NOW);
  await linkPuesto(db, study, 'PUESTO1', NOW);
  await runSecurityOpsSync(db, fakeReader(), () => {}, new Date(NOW.getTime() + 60e3));
  // IEC 31010: los datos sugieren 3 (una novedad de seguridad en 12 meses); el analista escoge 4 y explica por qué.
  const rated = { probability: 4, probability_basis: 'Dos alertas de riesgo recientes sobre el mismo cerramiento.', impact_company: 3, impact_people: 2, current_control: 'Guarda en la entrada', current_quality: 3, current_efficacy: 3, current_efficiency: 3 };

  await assert.rejects(addRiskFromSecurityOps(db, study.id, { source_ref: 'securityops:alerta:OTRA', title: 'xxx', ...rated }, PREPARER, addRisk), error => error.status === 409);
  await assert.rejects(addRiskFromSecurityOps(db, study.id, { source_ref: 'securityops:foto:ALERTA1', title: 'xxx', ...rated }, PREPARER, addRisk), error => error.status === 400);
  await assert.rejects(addRiskFromSecurityOps(db, study.id, { source_ref: 'securityops:alerta:ALERTA1', title: 'Cerramiento posterior vulnerable' }, PREPARER, addRisk), /Probabilidad/, 'sin calificar no entra: SecurityOps no califica');
  const risk = await addRiskFromSecurityOps(db, study.id, { source_ref: 'securityops:alerta:ALERTA1', title: 'Cerramiento posterior vulnerable', causes: 'La malla del parqueadero está rota.', ...rated }, PREPARER, addRisk);
  assert.equal(risk.origin, 'securityops');
  assert.equal(risk.source_ref, 'securityops:alerta:ALERTA1');
  await assert.rejects(addRiskFromSecurityOps(db, study.id, { source_ref: 'securityops:alerta:ALERTA1', title: 'Otra vez', ...rated }, PREPARER, addRisk), /ya está en el estudio como R1/);
  await addRiskFromSecurityOps(db, study.id, { source_ref: 'securityops:nota:NOTA1', title: 'Acceso de proveedores', ...rated }, PREPARER, addRisk);

  const detail = await getStudy(db, study.id);
  const { snapshot } = buildSnapshot(detail);
  assert.equal(snapshot.securityops.puesto.nombre, 'ARA Cuba Pereira');
  assert.equal(snapshot.securityops.resumen.novedades.total, 2);
  assert.deepEqual(snapshot.riesgos.map(item => item.fuente), ['securityops:alerta:ALERTA1', 'securityops:nota:NOTA1']);

  const text = JSON.stringify(buildStudyReport(snapshot, { version: 1, sha256: 'a'.repeat(64), approvedAt: '2026-11-12T15:00:00Z', approverName: 'Alba', preparerName: 'Ana' }).blocks);
  assert.match(text, /Antecedentes operativos del puesto \(SecurityOps\)/);
  assert.match(text, /Alertas de riesgo reportadas en campo/);
  assert.match(text, /Cámara 3 sin señal \(abierta\)/);
  assert.match(text, /Registrado a partir de la Alerta de Riesgos de SecurityOps del 5 de octubre de 2026, y calificado por una persona/);
  assert.match(text, /nota «Recorrido con el cliente» del historial del puesto en SecurityOps/);
  assert.match(text, /Notas de coordinación para el estudio/);
});

test('sin puesto vinculado, o sin la migración, la ficha se sigue viendo', async () => {
  const { pg, db, study } = await setup();
  assert.deepEqual((await getStudy(db, study.id)).securityops, { available: true, puesto: null, data: null });
  assert.equal(buildSnapshot(await getStudy(db, study.id)).snapshot.securityops, null);
  await pg.exec(readFileSync(new URL('../supabase/rollbacks/201_estudios_seguridad_securityops_rollback.sql', import.meta.url), 'utf8'));
  assert.deepEqual((await getStudy(db, study.id)).securityops, { available: true, puesto: null, data: null });
  assert.deepEqual(await searchPuestos(db, 'cuba'), []);
  assert.deepEqual(await runSecurityOpsSync(db, fakeReader(), () => {}, NOW), { directorio: null, estudios: 0, fallidos: 0 });
});
