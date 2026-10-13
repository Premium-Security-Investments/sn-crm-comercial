import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buildAgt002WorkbenchInitialReference } from '../agt002-workbench-context.js';
import { dossierTaskLinks } from '../agt002-workbench-api.js';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const v2Run = { id: uuid(1), opportunity_id: uuid(2), tender_id: uuid(3), snapshot_id: null, package_version_id: uuid(4), producer: 'AGT-002', method: 'agent_ai', status: 'completed', canonical: true, result: {} };

test('un análisis inicial v2 (snapshot null) se ancla a su paquete documental', () => {
  const reference = buildAgt002WorkbenchInitialReference(v2Run);
  assert.equal(reference.snapshot_id, uuid(4));
  assert.equal(reference.context_links[0].label, 'Paquete documental analizado por Vig-IA');
  assert.match(reference.context_links[0].source_ref, /^psi_agt002_evidence_package_versions:/);
});

test('sin snapshot ni paquete la Mesa sigue cerrada', () => {
  assert.throws(() => buildAgt002WorkbenchInitialReference({ ...v2Run, package_version_id: null }));
});

test('las tareas abiertas viajan como contexto: rechazo primero, luego fecha; sin listas, no aplica ni plantilla', async () => {
  const checklist = [
    { id: uuid(10), title: 'Financiero · Póliza', status: 'pendiente', applicability: 'requerido', target_date: '2026-10-14', item_type: 'pendiente_humano', origin: 'human' },
    { id: uuid(11), title: 'Jurídico · Sedes — CAUSA RECHAZO', status: 'pendiente', applicability: 'requerido', target_date: '2026-10-16', item_type: 'pendiente_humano', origin: 'human', instruction: 'Listar sedes.\n\nCargado por Vig-IA Licitaciones desde la matriz.' },
    { id: uuid(12), title: 'Lista', status: 'listo', applicability: 'requerido', target_date: '2026-10-13', item_type: 'pendiente_humano', origin: 'human' },
    { id: uuid(13), title: 'No aplica', status: 'pendiente', applicability: 'no_aplica', target_date: null, item_type: 'pendiente_humano', origin: 'human' },
    { id: uuid(14), title: 'Índice', status: 'pendiente', applicability: 'requerido', target_date: null, item_type: 'documento', origin: 'seed_go' },
  ];
  const database = { rpc: async (name) => { assert.equal(name, 'psi_get_tender_dossier_workspace'); return { data: { checklist }, error: null }; } };
  const links = await dossierTaskLinks(database, uuid(2), 18);
  assert.deepEqual(links.map(link => link.id), [uuid(11), uuid(10)]);
  assert.equal(links[0].kind, 'requirement');
  assert.match(links[0].source_ref, /responsable sin asignar · fecha 2026-10-16 · sin soporte · detalle: Listar sedes\./);
  assert.doesNotMatch(links[0].source_ref, /Cargado por Vig-IA/);
  assert.ok(links.every(link => link.label.length <= 300 && link.source_ref.length <= 1000));
  assert.deepEqual(await dossierTaskLinks(database, uuid(2), 0), []);
  assert.deepEqual(await dossierTaskLinks({ rpc: async () => ({ data: null, error: { message: 'x' } }) }, uuid(2), 5), [], 'si el expediente no se lee, la Mesa sigue con la referencia mínima');
});

test('el envío de un mensaje drena un trabajo en el mismo pedido, con los interruptores de siempre', () => {
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.match(server, /await drainAgt002WorkbenchAfterMessage\(database\);\s*res\.status\(201\)\.json\(queued\)/);
  assert.match(server, /async function drainAgt002WorkbenchAfterMessage\(database\) \{\s*if \(!isAgt002WorkbenchDrainEnabled\(process\.env\)\) return null;/);
  assert.equal((server.match(/dossierContext: true/g) || []).length, 2, 'el contexto del expediente solo lo pide el servidor, en la lectura y en el envío');
});

import { passageSearchTerms, documentPassageLinks } from '../agt002-workbench-api.js';

test('la pregunta se vuelve raíces de búsqueda; una pregunta de fechas agrega el cronograma', () => {
  assert.deepEqual(passageSearchTerms('hasta cuándo se pueden presentar observaciones al pliego'), ['presen', 'observ', 'pliego', 'cronog']);
  assert.deepEqual(passageSearchTerms('¿Qué nos falta para la garantía de seriedad?'), ['falta', 'garant', 'seried']);
  assert.deepEqual(passageSearchTerms('y?'), []);
});

test('fragmentos: los mejores por documento, con nombre del documento y dentro de los topes del contrato', async () => {
  const rows = [
    { document_version_id: uuid(30), name: 'Resolución 00390.pdf', excerpt: 'Presentación de observaciones al Pliego definitivo 08 de octubre'.padEnd(1200, '.'), score: 44 },
    { document_version_id: uuid(31), name: 'Pliego.pdf', excerpt: 'observaciones', score: 12 },
    { document_version_id: uuid(32), name: 'Anexo.pdf', excerpt: 'pliego observaciones', score: 31 },
  ];
  const database = { rpc: async (name, args) => { assert.equal(name, 'psi_search_tender_document_passages'); assert.ok(args.p_terms.includes('observ')); return { data: rows, error: null }; } };
  const links = await documentPassageLinks(database, uuid(2), 'observaciones al pliego', 6);
  assert.deepEqual(links.map(link => link.id), [uuid(30), uuid(32)], 'por puntaje y sin coincidencias débiles');
  assert.equal(links[0].kind, 'source');
  assert.equal(links[0].label, 'Documento del proceso: Resolución 00390.pdf');
  assert.ok(links.every(link => link.source_ref.length <= 1000));
  assert.deepEqual(await documentPassageLinks({ rpc: async () => { throw new Error('caída'); } }, uuid(2), 'observaciones', 6), []);
});

test('migración 126: búsqueda solo lectura y solo para service_role', () => {
  const sql = readFileSync(new URL('../supabase/migrations/126_tender_document_passage_search.sql', import.meta.url), 'utf8');
  assert.match(sql, /language plpgsql stable security definer/);
  assert.doesNotMatch(sql, /\b(insert|update|delete)\b/i);
  for (const role of ['public', 'anon', 'authenticated']) assert.match(sql, new RegExp(`revoke all on function public\\.psi_search_tender_document_passages\\(uuid, text\\[\\]\\) from ${role};`));
  assert.match(sql, /grant execute on function public\.psi_search_tender_document_passages\(uuid, text\[\]\) to service_role;/);
});
