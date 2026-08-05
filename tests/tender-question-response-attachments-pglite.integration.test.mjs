import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const migration038Url = new URL('../supabase/migrations/038_tender_question_responses.sql', import.meta.url);
const migrationUrl = new URL('../supabase/migrations/059_tender_question_response_attachments.sql', import.meta.url);
const rollbackUrl = new URL('../supabase/rollbacks/059_tender_question_response_attachments_rollback.sql', import.meta.url);
assert.equal(existsSync(migrationUrl), true, 'Falta la migración 059.');
assert.equal(existsSync(rollbackUrl), true, 'Falta el rollback 059.');
const migration038 = readFileSync(migration038Url, 'utf8');
const migration = readFileSync(migrationUrl, 'utf8');
const rollback = readFileSync(rollbackUrl, 'utf8');

const ids = {
  human: '11111111-1111-4111-8111-111111111111',
  agent: '22222222-2222-4222-8222-222222222222',
  opportunity: '33333333-3333-4333-8333-333333333333',
  otherOpportunity: '77777777-7777-4777-8777-777777777777',
  tender: '44444444-4444-4444-8444-444444444444',
  run: '55555555-5555-4555-8555-555555555555',
};

const sha256Hex = (label) => createHash('sha256').update(label).digest('hex');
const storagePath = (opportunityId, responseId, filename) =>
  `tender-documents/${opportunityId}/question-responses/${responseId}/${filename}`;

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role; alter role service_role bypassrls; grant anon, service_role to current_user;
  create table public.psi_sales_profiles (id uuid primary key, full_name text, active boolean not null default true, identity_type text not null default 'human');
  create table public.psi_sales_opportunities (id uuid primary key);
  create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid not null);
  create table public.psi_tender_analysis_runs (id uuid primary key, opportunity_id uuid not null, tender_id uuid not null, result jsonb, created_at timestamptz not null default now());
  insert into public.psi_sales_profiles values ('${ids.human}','Licitaciones',true,'human'),('${ids.agent}','Agente',true,'agent');
  insert into public.psi_sales_opportunities values ('${ids.opportunity}'), ('${ids.otherOpportunity}');
  insert into public.psi_public_tenders values ('${ids.tender}','${ids.opportunity}');
  insert into public.psi_tender_analysis_runs values ('${ids.run}','${ids.opportunity}','${ids.tender}','{"questions":[{"id":"q-1","text":"¿Existe RUP?"}]}',now());
`);

await db.exec(migration038); await db.exec(migration038);
await db.exec(migration); await db.exec(migration);

const call = async ({
  responseId = randomUUID(),
  opportunityId = ids.opportunity,
  runId = ids.run,
  actor = ids.human,
  status = 'resolved',
  response = 'Sí, vigente.',
  evidence = 'RUP 2026',
  attachments = [],
} = {}) => (await db.query(
  `select public.psi_record_tender_question_response_with_attachments($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text,$8::text,$9::uuid,$10::jsonb) as result`,
  [responseId, opportunityId, runId, 'q-1', '¿Existe RUP?', status, response, evidence, actor, JSON.stringify(attachments)]
)).rows[0].result;

// Happy path: zero attachments.
const zeroId = randomUUID();
const zero = await call({ responseId: zeroId, attachments: [] });
assert.equal(zero.id, zeroId);
assert.equal(zero.responded_by_name, 'Licitaciones');
assert.deepEqual(zero.attachments, []);

// Happy path: several attachments spanning the full MIME allow-list.
const manyId = randomUUID();
const manyAttachments = [
  { name: 'RUP.pdf', mime_type: 'application/pdf', content_hash: sha256Hex('rup'), size_bytes: 1024, storage_path: storagePath(ids.opportunity, manyId, 'RUP.pdf') },
  { name: 'Foto.png', mime_type: 'image/png', content_hash: sha256Hex('foto'), size_bytes: 2048, storage_path: storagePath(ids.opportunity, manyId, 'Foto.png') },
  { name: 'Escaneo.jpg', mime_type: 'image/jpeg', content_hash: sha256Hex('escaneo'), size_bytes: 4096, storage_path: storagePath(ids.opportunity, manyId, 'Escaneo.jpg') },
  { name: 'Carta.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content_hash: sha256Hex('carta'), size_bytes: 8192, storage_path: storagePath(ids.opportunity, manyId, 'Carta.docx') },
  { name: 'Presupuesto.xlsx', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content_hash: sha256Hex('presupuesto'), size_bytes: 16384, storage_path: storagePath(ids.opportunity, manyId, 'Presupuesto.xlsx') },
  { name: 'Notas.txt', mime_type: 'text/plain', content_hash: sha256Hex('notas'), size_bytes: 128, storage_path: storagePath(ids.opportunity, manyId, 'Notas.txt') },
];
const many = await call({ responseId: manyId, attachments: manyAttachments });
assert.equal(many.attachments.length, 6);
assert.deepEqual(new Set(many.attachments.map((a) => a.mime_type)), new Set(manyAttachments.map((a) => a.mime_type)));
assert.equal(
  Number((await db.query('select count(*)::int as count from public.psi_tender_question_response_attachments where response_id = $1::uuid', [manyId])).rows[0].count),
  6
);

// Agent identities cannot record responses (with or without attachments).
await assert.rejects(() => call({ actor: ids.agent, attachments: [] }), /humana|humano/i);
await assert.rejects(() => call({
  actor: ids.agent,
  attachments: [{ name: 'x.pdf', mime_type: 'application/pdf', content_hash: sha256Hex('x'), size_bytes: 1, storage_path: storagePath(ids.opportunity, randomUUID(), 'x.pdf') }],
}), /humana|humano/i);

// Cross-opportunity storage path must be rejected.
const crossId = randomUUID();
await assert.rejects(() => call({
  responseId: crossId,
  attachments: [{ name: 'x.pdf', mime_type: 'application/pdf', content_hash: sha256Hex('x'), size_bytes: 1, storage_path: storagePath(ids.otherOpportunity, crossId, 'x.pdf') }],
}), /ruta/i);

// Path traversal must be rejected.
const traversalId = randomUUID();
await assert.rejects(() => call({
  responseId: traversalId,
  attachments: [{ name: 'x.pdf', mime_type: 'application/pdf', content_hash: sha256Hex('x'), size_bytes: 1, storage_path: `${storagePath(ids.opportunity, traversalId, '')}../evil.pdf` }],
}), /ruta/i);

// Disallowed MIME type must be rejected.
const badMimeId = randomUUID();
await assert.rejects(() => call({
  responseId: badMimeId,
  attachments: [{ name: 'x.zip', mime_type: 'application/zip', content_hash: sha256Hex('x'), size_bytes: 1, storage_path: storagePath(ids.opportunity, badMimeId, 'x.zip') }],
}), /tipo/i);

// Invalid size (zero and over 25 MiB) must be rejected.
const zeroSizeId = randomUUID();
await assert.rejects(() => call({
  responseId: zeroSizeId,
  attachments: [{ name: 'x.pdf', mime_type: 'application/pdf', content_hash: sha256Hex('x'), size_bytes: 0, storage_path: storagePath(ids.opportunity, zeroSizeId, 'x.pdf') }],
}), /tamaño/i);
const overSizeId = randomUUID();
await assert.rejects(() => call({
  responseId: overSizeId,
  attachments: [{ name: 'x.pdf', mime_type: 'application/pdf', content_hash: sha256Hex('x'), size_bytes: 25 * 1024 * 1024 + 1, storage_path: storagePath(ids.opportunity, overSizeId, 'x.pdf') }],
}), /tamaño/i);

// Invalid SHA-256 hash must be rejected.
const badHashId = randomUUID();
await assert.rejects(() => call({
  responseId: badHashId,
  attachments: [{ name: 'x.pdf', mime_type: 'application/pdf', content_hash: 'not-a-hash', size_bytes: 1, storage_path: storagePath(ids.opportunity, badHashId, 'x.pdf') }],
}), /hash/i);

// A rejected attachment must not leave a partial response behind.
assert.equal(
  Number((await db.query('select count(*)::int as count from public.psi_tender_question_responses where id in ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid)', [crossId, traversalId, badMimeId, zeroSizeId, overSizeId])).rows[0].count),
  0
);

// UPDATE/DELETE are blocked (append-only).
await assert.rejects(() => db.query(`update public.psi_tender_question_response_attachments set name='x'`), /append-only/i);
await assert.rejects(() => db.query(`delete from public.psi_tender_question_response_attachments`), /append-only/i);

// anon has no access at all.
await db.exec('set role anon');
await assert.rejects(() => db.query('select * from public.psi_tender_question_response_attachments'), /permission denied/i);
await assert.rejects(() => call({ attachments: [] }), /permission denied/i);
await db.exec('reset role');

// service_role can only SELECT directly; inserts must go through the RPC.
await db.exec('set role service_role');
await assert.rejects(() => db.query(
  `insert into public.psi_tender_question_response_attachments(response_id,opportunity_id,name,mime_type,content_hash,size_bytes,storage_path,uploaded_by) values ('${zeroId}','${ids.opportunity}','x.pdf','application/pdf','${sha256Hex('x')}',1,'${storagePath(ids.opportunity, zeroId, 'x.pdf')}','${ids.human}')`
), /permission denied/i);
const viaServiceRole = await db.query(
  'select public.psi_record_tender_question_response_with_attachments($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text,$8::text,$9::uuid,$10::jsonb) as result',
  [randomUUID(), ids.opportunity, ids.run, 'q-1', '¿Existe RUP?', 'resolved', 'Desde RPC.', null, ids.human, JSON.stringify([])]
);
assert.equal(viaServiceRole.rows[0].result.response, 'Desde RPC.');
await db.exec('reset role');

console.log('PGlite tender question response attachments append-only contract passed');

// Rollback preserves the base responses table and RPC 038, but removes the attachment helpers.
const responsesBefore = Number((await db.query('select count(*)::int as count from public.psi_tender_question_responses')).rows[0].count);
await db.exec(rollback);
const responsesAfter = Number((await db.query('select count(*)::int as count from public.psi_tender_question_responses')).rows[0].count);
assert.equal(responsesAfter, responsesBefore, 'El rollback no debe tocar las respuestas base.');
await assert.rejects(() => db.query('select 1 from public.psi_tender_question_response_attachments'), /does not exist/i);
await assert.rejects(
  () => db.query(
    'select public.psi_record_tender_question_response_with_attachments($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text,$8::text,$9::uuid,$10::jsonb) as result',
    [randomUUID(), ids.opportunity, ids.run, 'q-1', '¿Existe RUP?', 'resolved', 'Post rollback.', null, ids.human, JSON.stringify([])]
  ),
  /does not exist|function/i
);
const stillWorks = await db.query(
  'select public.psi_record_tender_question_response($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,$8::uuid) as result',
  [ids.opportunity, ids.run, 'q-1', '¿Existe RUP?', 'resolved', 'RPC 038 sigue viva.', null, ids.human]
);
assert.equal(stillWorks.rows[0].result.response, 'RPC 038 sigue viva.');

await db.close();
console.log('PGlite tender question response attachments rollback contract passed');
