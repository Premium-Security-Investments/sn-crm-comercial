// Prueba de regresión del bug de pérdida de filas / paginación rala.
//
// Antes de la migración 088 la UI traducía `por_decidir -> pending_decision`,
// `en_curso -> go_authorized` y `cerradas -> closed`. Esos predicados legados son MÁS ESTRECHOS
// que los estados primarios, de modo que el servidor omitía filas que el estado primario sí
// contiene y el cliente no podía recuperarlas:
//
//   · sin decisión + `en_preparacion` rancio  -> es Por decidir, pending_decision NO la devuelve
//   · GO humano + `pendiente_decision` rancio -> es En curso,   go_authorized  NO la devuelve
//   · NO GO humano + estado no terminal rancio-> es Cerrada,    closed         NO la devuelve
//
// Este test ejecuta el SQL real sobre PGlite y exige que los predicados primarios del servidor
// devuelvan esas filas contradictorias, que los tres estados particionen la bandeja, que la
// paginación sea densa (sin huecos) y que el vocabulario legado conserve su semántica exacta.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/088_tender_opportunity_primary_stage_filters.sql', import.meta.url), 'utf8');

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  alter role service_role bypassrls; grant service_role to current_user;
  create table public.psi_sales_profiles (id uuid primary key, full_name text);
  create table public.psi_sales_opportunities (id uuid primary key, tender_offer_status text);
  create table public.psi_public_tenders (
    id uuid primary key, internal_status text, converted_opportunity_id uuid, tracking_updated_at timestamptz
  );
  create table public.psi_tender_go_no_go_decisions (
    id uuid primary key, opportunity_id uuid not null, tender_id uuid not null, decision text not null,
    decided_by uuid, decided_at timestamptz not null, supersedes_decision_id uuid
  );
  insert into public.psi_sales_profiles values ('10000000-0000-4000-8000-000000000001', 'Directora');
`);

// Cada caso trae su estado primario esperado. Los marcados `stale: true` son exactamente los que
// los predicados legados omitían: sus campos se contradicen entre sí.
const cases = [
  { key: 'sin-decision-pendiente', status: 'pendiente_decision', decision: null, stage: 'por_decidir' },
  { key: 'sin-decision-prep-rancia', status: 'en_preparacion', decision: null, stage: 'por_decidir', stale: true },
  { key: 'sin-decision-lista-rancia', status: 'lista_para_presentar', decision: null, stage: 'por_decidir', stale: true },
  { key: 'sin-decision-presentada-rancia', status: 'presentada', decision: null, stage: 'por_decidir', stale: true },
  { key: 'decision-no-canonica', status: 'en_preparacion', decision: 'pendiente', stage: 'por_decidir', stale: true },
  { key: 'go-prep', status: 'en_preparacion', decision: 'go', stage: 'en_curso' },
  { key: 'go-lista', status: 'lista_para_presentar', decision: 'go', stage: 'en_curso' },
  { key: 'go-presentada', status: 'presentada', decision: 'go', stage: 'en_curso' },
  { key: 'go-estado-rancio', status: 'pendiente_decision', decision: 'go', stage: 'en_curso', stale: true },
  { key: 'no-go-prep-rancia', status: 'en_preparacion', decision: 'no_go', stage: 'cerradas', stale: true },
  { key: 'no-go-presentada-rancia', status: 'presentada', decision: 'no_go', stage: 'cerradas', stale: true },
  { key: 'no-go-pendiente-rancia', status: 'pendiente_decision', decision: 'no_go', stage: 'cerradas', stale: true },
  { key: 'no-go-cerrada', status: 'cerrada_no_go', decision: 'no_go', stage: 'cerradas' },
  { key: 'adjudicada-con-go', status: 'adjudicada', decision: 'go', stage: 'cerradas', stale: true },
  { key: 'no-adjudicada-con-go', status: 'no_adjudicada', decision: 'go', stage: 'cerradas', stale: true },
  { key: 'adjudicada-sin-decision', status: 'adjudicada', decision: null, stage: 'cerradas', stale: true },
];

const pad = n => String(n).padStart(12, '0');
for (const [index, row] of cases.entries()) {
  const n = index + 1;
  row.opportunityId = `40000000-0000-4000-8000-${pad(n)}`;
  row.tenderId = `50000000-0000-4000-8000-${pad(n)}`;
  await db.query('insert into public.psi_sales_opportunities values ($1, $2)', [row.opportunityId, row.status]);
  await db.query(
    "insert into public.psi_public_tenders values ($1, 'convertida_oportunidad', $2, $3)",
    [row.tenderId, row.opportunityId, `2027-01-01T00:00:${String(n).padStart(2, '0')}Z`],
  );
  if (row.decision) {
    await db.query(
      "insert into public.psi_tender_go_no_go_decisions values ($1, $2, $3, $4, '10000000-0000-4000-8000-000000000001', $5, null)",
      [`60000000-0000-4000-8000-${pad(n)}`, row.opportunityId, row.tenderId, row.decision, `2027-02-01T00:00:${String(n).padStart(2, '0')}Z`],
    );
  }
}

// Una licitación NO convertida nunca debe aparecer, cualquiera sea el filtro (recorte de 058).
await db.exec(`
  insert into public.psi_sales_opportunities values ('40000000-0000-4000-8000-000000000099', 'en_preparacion');
  insert into public.psi_public_tenders values
    ('50000000-0000-4000-8000-000000000099', 'en_revision', '40000000-0000-4000-8000-000000000099', '2027-03-01T00:00:00Z');
`);

// Reaplicar la migración debe ser idempotente.
await db.exec(migration);
await db.exec(migration);

const page = async (filter, limit = 50, offset = 0) => (await db.query(
  'select * from public.psi_list_tender_opportunity_page($1, $2, $3)', [filter, limit, offset]
)).rows;
const keysOf = rows => rows.map(row => cases.find(item => item.opportunityId === row.opportunity.id)?.key || row.opportunity.id).sort();
const expectedKeys = stage => cases.filter(row => row.stage === stage).map(row => row.key).sort();

// --- 1. Cada predicado primario del SERVIDOR devuelve su estado completo, filas rancias incluidas.
for (const stage of ['por_decidir', 'en_curso', 'cerradas']) {
  assert.deepEqual(keysOf(await page(stage)), expectedKeys(stage), `el RPC debe devolver la partición completa de ${stage}`);
}

// --- 2. Las filas contradictorias que el vocabulario legado omitía ahora sí vuelven del servidor.
for (const row of cases.filter(item => item.stale)) {
  const returned = keysOf(await page(row.stage));
  assert.ok(returned.includes(row.key), `${row.key} (${row.decision || 'sin decisión'} + ${row.status}) debe volver del servidor en ${row.stage}`);
}
const legacyEquivalent = { por_decidir: 'pending_decision', en_curso: 'go_authorized', cerradas: 'closed' };
for (const [stage, legacy] of Object.entries(legacyEquivalent)) {
  const primaryKeys = keysOf(await page(stage));
  const legacyKeys = keysOf(await page(legacy));
  const omitted = primaryKeys.filter(key => !legacyKeys.includes(key));
  assert.ok(omitted.length > 0, `el predicado legado ${legacy} es más estrecho que ${stage}: este test sería vacuo si no lo fuera`);
}

// --- 3. Los tres estados primarios particionan `all`: ni solapamiento ni huérfanos.
const all = keysOf(await page('all'));
const union = [...expectedKeys('por_decidir'), ...expectedKeys('en_curso'), ...expectedKeys('cerradas')].sort();
assert.deepEqual(all, union, 'todas las filas convertidas caen en exactamente un estado primario');
assert.equal(all.includes('40000000-0000-4000-8000-000000000099'), false, 'una licitación no convertida nunca se lista');
const seen = new Map();
for (const stage of ['por_decidir', 'en_curso', 'cerradas']) {
  for (const key of keysOf(await page(stage))) {
    assert.equal(seen.has(key), false, `${key} no puede estar en ${stage} y también en ${seen.get(key)}`);
    seen.set(key, stage);
  }
}

// --- 4. Paginación densa: el servidor llena cada página hasta agotar el estado, sin huecos.
for (const stage of ['por_decidir', 'en_curso', 'cerradas', 'all']) {
  const total = (await page(stage)).length;
  const limit = 2;
  const walked = [];
  for (let offset = 0; offset < total; offset += limit) {
    const chunk = await page(stage, limit, offset);
    const expectedSize = Math.min(limit, total - offset);
    assert.equal(chunk.length, expectedSize, `la página ${offset / limit + 1} de ${stage} debe venir llena (${expectedSize}), no rala`);
    walked.push(...chunk.map(row => row.opportunity.id));
  }
  assert.equal(new Set(walked).size, total, `recorrer ${stage} por páginas debe ver cada fila exactamente una vez`);
}

// --- 5. El orden de 058 se conserva: tracking_updated_at desc nulls last, id asc.
const ordered = (await page('all')).map(row => new Date(row.tender.tracking_updated_at).getTime());
assert.deepEqual(ordered, [...ordered].sort((left, right) => right - left), 'el orden por tracking_updated_at desc se conserva');

// --- 6. El vocabulario legado conserva EXACTAMENTE su semántica anterior.
assert.deepEqual(keysOf(await page('pending_decision')), ['sin-decision-pendiente']);
assert.deepEqual(keysOf(await page('go_authorized')), ['go-lista', 'go-prep', 'go-presentada'].sort());
assert.deepEqual(keysOf(await page('in_preparation')), ['decision-no-canonica', 'go-lista', 'go-prep', 'no-go-prep-rancia', 'sin-decision-lista-rancia', 'sin-decision-prep-rancia'].sort());
assert.deepEqual(keysOf(await page('submitted')), ['go-presentada', 'no-go-presentada-rancia', 'sin-decision-presentada-rancia'].sort());
assert.deepEqual(keysOf(await page('closed')), ['adjudicada-con-go', 'adjudicada-sin-decision', 'no-adjudicada-con-go', 'no-go-cerrada'].sort());

// --- 7. La decisión vigente sigue siendo la última no superseded, y el payload no cambia.
await db.exec(`
  insert into public.psi_tender_go_no_go_decisions values
    ('60000000-0000-4000-8000-000000000201', '40000000-0000-4000-8000-000000000006', '50000000-0000-4000-8000-000000000006',
     'no_go', '10000000-0000-4000-8000-000000000001', '2027-02-06T00:00:00Z', '60000000-0000-4000-8000-000000000006');
`);
const superseded = (await page('cerradas')).find(row => row.opportunity.id === '40000000-0000-4000-8000-000000000006');
assert.ok(superseded, 'un GO supersedido por un NO GO pasa a Cerradas por el predicado del servidor');
assert.equal(superseded.latest_decision.decision, 'no_go');
assert.equal(superseded.latest_decision.psi_sales_profiles.full_name, 'Directora');
assert.deepEqual(Object.keys(superseded).sort(), ['latest_decision', 'opportunity', 'tender']);

// --- 8. Las guardas de validación siguen vivas.
await assert.rejects(() => page('desconocido', 1, 0), /filtro/i);
await assert.rejects(() => page('all', 51, 0), /límite/i);
await assert.rejects(() => page('all', 0, 0), /límite/i);
await assert.rejects(() => page('all', 1, 10001), /desplazamiento/i);

await db.close();
console.log('PGlite tender opportunity primary stage filters, partition, dense pagination, and legacy parity passed');
