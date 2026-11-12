// Paso 3 del expediente vivo (Juan, 2026-11-12): las respuestas de la entidad, una por observación.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  esDocumentoDeRespuestas, normalizarRespuestas, configuracionDelPuente, respuestasPorObservacionMarkdown, runAgt002RespuestasPorObservacionPass,
  AGT002_RESPUESTAS_MAX_INTENTOS,
} from '../verticales/licitaciones/agt002-respuestas-por-observacion.js';

const ENV = Object.freeze({
  AGT002_WORKBENCH_RUNTIME: 'agt002_workbench_bridge_v1', AGT002_WORKBENCH_DRAIN_ENABLED: 'true', AGT002_WORKBENCH_MODEL: 'modelo',
  AGT002_HETZNER_BRIDGE_URL: 'https://puente.example.com/run', AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'x'.repeat(48),
  AGT002_WORKBENCH_AGENT_ID: '33333333-3333-4333-8333-333333333333', AGT002_WORKBENCH_WORKER_ID: 'prueba',
});

const NUESTRA = { observante: 'SEGURIDAD NACIONAL LTDA', es_nuestra: true, numero: '3', tema: 'Agencia en Bogotá', pedido: 'Aceptar agencia', decision: 'no_acoge', respuesta: 'NO SE ACOGE LA OBSERVACIÓN y se mantiene el requisito', cambia_el_pliego: '' };
const OTRA = { observante: 'VIASERVIN LTDA', es_nuestra: false, numero: '1', tema: 'Liquidez', pedido: 'Bajar liquidez', decision: 'aclara', respuesta: 'Se aclara que…', cambia_el_pliego: 'Ninguno' };

test('reconoce los documentos de respuestas de la entidad por el nombre, no los propios ni de terceros', () => {
  assert.equal(esDocumentoDeRespuestas({ name: 'Respuesta Observaciones LP-07-2026 _11-11-26.pdf', origin: 'entidad' }), true);
  assert.equal(esDocumentoDeRespuestas({ name: 'Acta_Rtas_Observaciones_PREPLIEGO.pdf', origin: 'entidad' }), false);
  assert.equal(esDocumentoDeRespuestas({ name: 'Respuesta a observaciones.pdf', origin: 'propio' }), false);
  assert.equal(esDocumentoDeRespuestas({ name: 'Pliego definitivo.pdf', origin: 'entidad' }), false);
});

test('normaliza la salida del modelo, numera en orden y descarta lo incompleto', () => {
  const filas = normalizarRespuestas({ observaciones: [OTRA, { ...NUESTRA, decision: 'inventada' }, NUESTRA, { observante: '', pedido: 'x', respuesta: 'y', decision: 'acoge' }] }, { opportunityId: 'o1', documentVersionId: 'v1' });
  assert.deepEqual(filas.map(f => [f.orden, f.observante, f.es_nuestra]), [[1, 'VIASERVIN LTDA', false], [2, 'SEGURIDAD NACIONAL LTDA', true]]);
  assert.equal(filas[1].cambia_el_pliego, null);
});

test('el archivo para la Mesa pone las nuestras primero, con la decisión y la frase literal', () => {
  const texto = respuestasPorObservacionMarkdown('Respuesta.pdf', normalizarRespuestas({ observaciones: [OTRA, NUESTRA] }, { opportunityId: 'o1', documentVersionId: 'v1' }));
  assert.ok(texto.indexOf('SEGURIDAD NACIONAL (nuestras)') < texto.indexOf('VIASERVIN'));
  assert.match(texto, /### Observación 3: Agencia en Bogotá — NO ACOGE/);
  assert.match(texto, /Respondió la entidad: «NO SE ACOGE LA OBSERVACIÓN y se mantiene el requisito»/);
});

function baseDeDatos({ opps, docs, hechos = [] }) {
  const escrito = { insert: [], upsert: [], delete: [] };
  const tablas = { psi_sales_opportunities: opps, psi_tender_document_versions: docs, psi_agt002_respuestas_observacion_docs: hechos, psi_tender_document_extractions: [] };
  const consulta = tabla => {
    const q = { select: () => q, eq: () => q, in: () => q, ilike: () => q, order: () => q,
      then: (ok, ko) => Promise.resolve({ data: tablas[tabla] || [], error: null }).then(ok, ko),
      insert: filas => { escrito.insert.push(...filas); return Promise.resolve({ error: null }); },
      upsert: fila => { escrito.upsert.push(fila); return Promise.resolve({ error: null }); },
      delete: () => { const d = { eq: (col, val) => { escrito.delete.push(val); return Promise.resolve({ error: null }); } }; return d; } };
    return q;
  };
  return { from: consulta, escrito };
}

const OPPS = [{ id: 'o1', tender_offer_status: 'en_preparacion' }, { id: 'o2', tender_offer_status: 'cerrada_no_go' }];
const DOCS = [
  { id: 'v1', opportunity_id: 'o1', name: 'Respuesta Observaciones LP-07.pdf', origin: 'entidad', extracted_text: 'tabla de respuestas', created_at: '2026-11-12' },
  { id: 'v2', opportunity_id: 'o1', name: 'Respuesta Observaciones viejas.pdf', origin: 'entidad', extracted_text: 'otra', created_at: '2026-11-01' },
];

test('lee el documento pendiente con la carpeta, guarda las observaciones y lo marca leído', async () => {
  const llamadas = [];
  const db = baseDeDatos({ opps: OPPS, docs: DOCS, hechos: [{ document_version_id: 'v2', estado: 'leido', intentos: 1 }] });
  const bridgeClient = { run: async args => { llamadas.push(args); return { content: JSON.stringify({ observaciones: [NUESTRA, OTRA] }) }; } };
  const eventos = await runAgt002RespuestasPorObservacionPass(db, { environment: ENV, bridgeClient });
  assert.equal(llamadas.length, 1, 'el ya leído no se vuelve a leer');
  assert.deepEqual(llamadas[0].carpeta, { archivos: [{ ruta: 'respuestas.txt', texto: 'tabla de respuestas' }] });
  assert.equal(llamadas[0].timeoutMs, 6 * 60 * 1000);
  assert.equal(db.escrito.insert.length, 2);
  assert.deepEqual(db.escrito.delete, ['v1'], 'antes de guardar borra lo de una lectura anterior');
  assert.equal(db.escrito.upsert[0].estado, 'leido');
  assert.equal(eventos[0].event, 'agt002_respuestas_read');
  assert.equal(eventos[0].nuestras, 1);
});

test('un fallo se marca y se reintenta hasta el tope; sin tiempo o con la Mesa apagada no hace nada', async () => {
  const roto = baseDeDatos({ opps: OPPS, docs: [DOCS[0]] });
  const eventos = await runAgt002RespuestasPorObservacionPass(roto, { environment: ENV, bridgeClient: { run: async () => ({ content: 'no es json' }) } });
  assert.equal(eventos[0].code, 'invalid_json');
  assert.equal(roto.escrito.upsert[0].estado, 'fallido');
  assert.equal(roto.escrito.upsert[0].intentos, 1);

  const agotado = baseDeDatos({ opps: OPPS, docs: [DOCS[0]], hechos: [{ document_version_id: 'v1', estado: 'fallido', intentos: AGT002_RESPUESTAS_MAX_INTENTOS }] });
  assert.equal((await runAgt002RespuestasPorObservacionPass(agotado, { environment: ENV, bridgeClient: { run: async () => { throw new Error('no'); } } }))[0].event, 'agt002_respuestas_idle');

  assert.equal((await runAgt002RespuestasPorObservacionPass(roto, { environment: ENV, timeoutMs: 60_000 }))[0].reason, 'sin_tiempo');
  assert.equal((await runAgt002RespuestasPorObservacionPass(roto, { environment: {} }))[0].reason, 'apagada');
});

test('la migración 217 crea las dos tablas sólo para service_role y su reversa las borra', () => {
  const sql = readFileSync(new URL('../supabase/migrations/217_respuestas_por_observacion.sql', import.meta.url), 'utf8');
  assert.match(sql, /^-- 217/);
  assert.match(sql, /create table if not exists public\.psi_agt002_respuestas_observacion \(/);
  assert.match(sql, /create table if not exists public\.psi_agt002_respuestas_observacion_docs \(/);
  assert.match(sql, /revoke all on table public\.psi_agt002_respuestas_observacion from public, anon, authenticated, service_role;/);
  assert.match(sql, /decision in \('acoge', 'acoge_parcialmente', 'no_acoge', 'aclara', 'otra'\)/);
  const reversa = readFileSync(new URL('../supabase/rollbacks/217_respuestas_por_observacion_rollback.sql', import.meta.url), 'utf8');
  assert.match(reversa, /drop table if exists public\.psi_agt002_respuestas_observacion_docs;/);
});

test('en el servidor de tareas, sin la Mesa configurada, usa el puente y el modelo del análisis', () => {
  const analisis = { AGT002_MODEL_CALLS_ENABLED: 'true', AGT002_BRIDGE_HMAC_SECRET: 'y'.repeat(40), AGT002_INITIAL_ANALYSIS_MODEL_ID: 'sonnet' };
  assert.equal(configuracionDelPuente(analisis).model, 'sonnet');
  assert.equal(configuracionDelPuente(ENV).model, 'modelo', 'con la Mesa configurada, la de la Mesa');
  assert.equal(configuracionDelPuente({ ...analisis, AGT002_MODEL_CALLS_ENABLED: 'false' }), null);
  assert.equal(configuracionDelPuente({ ...analisis, AGT002_BRIDGE_HMAC_SECRET: 'corta' }), null);
});
