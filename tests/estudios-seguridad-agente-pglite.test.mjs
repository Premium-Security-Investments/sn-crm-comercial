// Estudios de Seguridad Física — la nota de campo con Vig-IA (AGT-003, agt003.estudios-nota-campo; Juan, 2026-11-05).
//
// Con un modelo simulado: Vig-IA propone texto y no califica; lo que no cita la nota se descarta; al modelo no viajan
// ids ni NIT; nada se guarda hasta confirmar, y al confirmar se valida todo antes de escribir.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addZone, createStudy, getStudy, addRisk } from '../verticales/estudios-seguridad/estudios.js';
import {
  FIELD_NOTE_POLICY, buildFieldNoteInput, claimFieldNoteRun, confirmFieldNote, fieldNoteOutputSchema, normalizeFieldNoteOutput, runFieldNote,
} from '../verticales/estudios-seguridad/agente.js';
import { PLANTILLA_INSTALACIONES_FISICAS_V1 as CATALOG } from '../verticales/estudios-seguridad/plantilla.js';
import { PREPARER, database, supabaseOver } from './helpers/estudios-seguridad-db.mjs';

const STUDY = {
  title: 'Estudio bodega', client_source: 'avancys', client_ref: '900123456', client_name: 'Cliente de prueba S.A.S.', client_nit: '900123456',
  site_source: 'avancys_puesto', site_ref: 'PU-0001', site_name: 'Bodega principal', site_city: 'Pereira',
};
const NOTE = 'En la bodega 3 la malla del costado norte está rota y no hay cámara; el vigilante hace ronda cada 2 horas. En la portería vehicular los camiones entran sin registro.';
const ENV = { AGT003_COPILOT_ENGINE: 'agt003_bridge_preview', AGT003_COPILOT_MODEL: 'sonnet', AGT003_COPILOT_BRIDGE_URL: 'https://bridge.example', AGT003_COPILOT_HMAC_SECRET: 'x'.repeat(40) };

async function setup() {
  const pg = await database();
  const db = supabaseOver(pg);
  const study = await createStudy(db, STUDY, PREPARER);
  const bodega = await addZone(db, study.id, { name: 'Bodega 3' }, PREPARER);
  return { pg, db, study, bodega, detail: await getStudy(db, study.id) };
}

const MODEL_OUTPUT = {
  respuesta: 'Propongo dos riesgos y una zona nueva.',
  zonas_nuevas: [{ ref: 'n1', nombre: 'Portería vehicular' }, { ref: 'n2', nombre: 'bodega 3' }],
  riesgos: [
    { zona: 'z1', catalogo: 'RB-03', proceso: 'P03', proceso_cliente: 'Logística', factor: 'Físico – Perimetral', titulo: 'Intrusión por la malla rota del costado norte', causas: 'Malla rota', consecuencias: 'Hurto en la bodega', control_existente: 'Ronda cada 2 horas', control_propuesto: 'Reparar la malla y poner cámara', evidencia_en_nota: 'la malla del costado norte está rota y no hay cámara' },
    { zona: 'n1', catalogo: 'RB-01', proceso: 'P99', proceso_cliente: '', factor: '', titulo: 'Ingreso de camiones sin registro', causas: '', consecuencias: '', control_existente: '', control_propuesto: 'Registro de vehículos', evidencia_en_nota: 'los camiones entran sin registro' },
    { zona: 'z1', catalogo: 'RB-17', proceso: '', proceso_cliente: '', factor: '', titulo: 'Amenaza terrorista', causas: '', consecuencias: '', control_existente: '', control_propuesto: '', evidencia_en_nota: 'sabotaje grave en la planta' },
  ],
  avisos: [],
};

test('la política y el esquema: propone texto, no califica, y el formato es cerrado', () => {
  assert.match(FIELD_NOTE_POLICY, /No calificas/);
  assert.match(FIELD_NOTE_POLICY, /sólo propones lo que la nota dice/);
  const schema = fieldNoteOutputSchema(CATALOG);
  assert.equal(schema.additionalProperties, false);
  const risk = schema.properties.riesgos.items;
  assert.equal(risk.additionalProperties, false);
  for (const forbidden of ['probabilidad', 'impacto', 'nivel', 'calidad']) assert.equal(Object.keys(risk.properties).some(key => key.includes(forbidden)), false, `sin ${forbidden}`);
  assert.deepEqual(risk.properties.catalogo.enum.slice(0, 3), ['', 'RB-01', 'RB-02']);
});

test('al modelo no viajan ids ni NIT: sólo referencias cortas', async () => {
  const { detail, bodega } = await setup();
  const { input, zoneRefs } = buildFieldNoteInput(detail, NOTE, '2026-11-10');
  const wire = JSON.stringify(input);
  assert.equal(wire.includes(bodega.id), false);
  assert.equal(wire.includes(detail.study.id), false);
  assert.equal(wire.includes('900123456'), false, 'sin NIT');
  assert.deepEqual(input.zonas, [{ ref: 'z1', nombre: 'Bodega 3' }]);
  assert.equal(zoneRefs.z1, bodega.id);
});

test('normaliza: zonas existentes no se repiten, catálogo coherente y sin cita se descarta', async () => {
  const { detail, bodega } = await setup();
  const { zoneRefs } = buildFieldNoteInput(detail, NOTE, '2026-11-10');
  const out = normalizeFieldNoteOutput(MODEL_OUTPUT, { zoneRefs, zones: detail.zones, catalog: CATALOG, note: NOTE });
  assert.deepEqual(out.zonas_nuevas, [{ ref: 'n1', nombre: 'Portería vehicular' }], '"bodega 3" ya existe');
  assert.equal(out.riesgos.length, 2);
  assert.equal(out.riesgos[0].zone_id, bodega.id);
  assert.equal(out.riesgos[1].zone_ref, 'n1');
  assert.equal(out.riesgos[1].process_code, null, 'P99 no existe y la lista base no ata riesgos a procesos: queda sin proceso');
  assert.deepEqual(out.riesgos.map(risk => risk.catalog_risk_code), ['RB-03', 'RB-01']);
  assert.equal(out.riesgos[0].process_code, 'P03', 'un proceso que existe se conserva');
  assert.deepEqual([out.riesgos[0].client_process, out.riesgos[0].risk_factor, out.riesgos[1].client_process], ['Logística', 'Físico – Perimetral', null]);
  assert.match(out.avisos.join(' '), /Se descartó "Amenaza terrorista": no cita un fragmento de la nota/);
  for (const risk of out.riesgos) assert.equal('probability' in risk, false, 'la propuesta no trae calificación');
});

test('runFieldNote: pasa por la puerta de modelos de AGT-003 con su capacidad, y no guarda nada', async () => {
  const { db, detail, study } = await setup();
  let call;
  const usage = [];
  const client = { async run(args) { call = args; return { content: JSON.stringify(MODEL_OUTPUT), usage: { input_tokens: 900, output_tokens: 300 } }; } };
  const result = await runFieldNote({ detail, note: NOTE, today: '2026-11-10', idempotencyKey: 'k1', environment: ENV, client, recordUsage: async event => usage.push(event) });
  assert.equal(call.policy, FIELD_NOTE_POLICY);
  assert.equal(call.input.nota, NOTE);
  assert.equal(usage[0].capability, 'agt003.estudios-nota-campo');
  assert.equal(result.output.riesgos.length, 2);
  assert.equal((await getStudy(db, study.id)).risks.length, 0, 'proponer no escribe');
  await assert.rejects(runFieldNote({ detail, note: 'hola', today: '2026-11-10', environment: ENV, client, recordUsage: async () => {} }), error => error.status === 400);
});

test('confirmar: crea zonas y riesgos con origen agente y la calificación de la persona; si uno falla, no crea nada', async () => {
  const { db, detail, study } = await setup();
  const { zoneRefs } = buildFieldNoteInput(detail, NOTE, '2026-11-10');
  const out = normalizeFieldNoteOutput(MODEL_OUTPUT, { zoneRefs, zones: detail.zones, catalog: CATALOG, note: NOTE });
  const rated = out.riesgos.map(risk => ({ ...risk, probability: 4, impact_company: 3, impact_people: 2 }));

  await assert.rejects(confirmFieldNote(db, study.id, { zonas_nuevas: out.zonas_nuevas, riesgos: [rated[0], { ...rated[1], probability: null }] }, PREPARER), /Riesgo 2 .*Probabilidad/);
  assert.equal((await getStudy(db, study.id)).risks.length, 0, 'nada a medias');
  assert.equal((await getStudy(db, study.id)).zones.length, 1);

  const created = await confirmFieldNote(db, study.id, { zonas_nuevas: out.zonas_nuevas, riesgos: rated }, PREPARER);
  assert.deepEqual(created.zonas.map(zone => zone.name), ['Portería vehicular']);
  assert.deepEqual(created.riesgos.map(risk => [risk.number, risk.origin, risk.zone_id]), [[1, 'agente', detail.zones[0].id], [2, 'agente', created.zonas[0].id]]);
  assert.equal(created.riesgos[0].valuation.actual.nivel, 'tolerable', 'guía: P4 × I3 = 12, sin control');
});

test('cupo: la reserva de la 181 cuenta por equipo y por persona, y una a la vez', async () => {
  const { db, study } = await setup();
  const quota = { team: { max: 2, period_start: new Date(Date.now() - 3600_000).toISOString() }, actor: null };
  const first = await claimFieldNoteRun(db, { actorId: PREPARER.id, studyId: study.id, quota });
  assert.equal(first.status, 'claimed');
  assert.equal((await claimFieldNoteRun(db, { actorId: PREPARER.id, studyId: study.id, quota })).status, 'in_progress');
  await db.from('psi_security_study_agent_runs').update({ status: 'completed' }).eq('id', first.id);
  const second = await claimFieldNoteRun(db, { actorId: PREPARER.id, studyId: study.id, quota });
  await db.from('psi_security_study_agent_runs').update({ status: 'completed' }).eq('id', second.id);
  assert.deepEqual(await claimFieldNoteRun(db, { actorId: PREPARER.id, studyId: study.id, quota }), { status: 'quota', scope: 'team', used: 2, max: 2 });
  const sql = readFileSync(new URL('../supabase/migrations/181_estudios_seguridad_agente.sql', import.meta.url), 'utf8');
  assert.match(sql, /revoke all on function public\.psi_claim_security_study_agent_run\(uuid, uuid, integer, timestamptz, integer, timestamptz\) from public, anon, authenticated/);
});
