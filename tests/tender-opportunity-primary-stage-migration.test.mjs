// Contrato estático de la migración 088: el RPC de listado habla el vocabulario primario
// (all / por_decidir / en_curso / cerradas) SIN perder el vocabulario legado.
//
// Por qué existe esta migración: los predicados legados son MÁS ESTRECHOS que los estados
// primarios, así que traducir `por_decidir -> pending_decision`, `en_curso -> go_authorized` y
// `cerradas -> closed` en el cliente pierde filas en el servidor (una fila sin decisión con
// `en_preparacion` rancio, un GO con `pendiente_decision` rancio, un NO GO con estado no terminal
// rancio). Lo que el SQL no devuelve el cliente no lo puede recuperar, y filtrar de nuevo en el
// cliente además deja páginas ralas. El predicado primario vive aquí, en el servidor.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';

const migrationPath = new URL('../supabase/migrations/088_tender_opportunity_primary_stage_filters.sql', import.meta.url);
assert.equal(existsSync(migrationPath), true, 'La migración 088 debe existir.');
const sql = readFileSync(migrationPath, 'utf8');
const latest = readFileSync(new URL('../supabase/migrations/058_tender_opportunity_exit_destinations.sql', import.meta.url), 'utf8');

assert.match(sql, /^begin;/i);
assert.match(sql, /commit;\s*$/i);
assert.match(sql, /create or replace function public\.psi_list_tender_opportunity_page\(p_filter text, p_limit int, p_offset int\)/i);
assert.match(sql, /returns table \(tender jsonb, opportunity jsonb, latest_decision jsonb\)/i);
assert.match(sql, /security definer/i);
assert.match(sql, /set search_path = public, pg_temp/i);

// --- Vocabulario aceptado: los cuatro primarios MÁS los cinco legados, sin perder ninguno.
const accepted = sql.match(/p_filter not in \(([^)]*)\)/)[1].split(',').map(value => value.trim().replace(/'/g, ''));
for (const primary of ['all', 'por_decidir', 'en_curso', 'cerradas']) {
  assert.ok(accepted.includes(primary), `el RPC debe aceptar el filtro primario ${primary}`);
}
for (const legacy of ['pending_decision', 'go_authorized', 'in_preparation', 'submitted', 'closed']) {
  assert.ok(accepted.includes(legacy), `el RPC debe seguir aceptando el filtro legado ${legacy}`);
}

// --- Límites, joins, payload, orden y grants se conservan de la definición vigente (058).
assert.match(sql, /p_limit is null or p_limit < 1 or p_limit > 50/i);
assert.match(sql, /p_offset is null or p_offset < 0 or p_offset > 10000/i);
assert.match(sql, /join public\.psi_sales_opportunities o on o\.id = t\.converted_opportunity_id/i);
assert.match(sql, /left join lateral \([\s\S]*?child\.supersedes_decision_id = d\.id[\s\S]*?order by d\.decided_at desc, d\.id desc[\s\S]*?limit 1/i);
assert.match(sql, /left join public\.psi_sales_profiles actor on actor\.id = d\.decided_by/i);
assert.match(sql, /'psi_sales_profiles', case when actor\.id is null then null else jsonb_build_object\('full_name', actor\.full_name\) end/i);
assert.match(sql, /where t\.internal_status = 'convertida_oportunidad'/i, 'se conserva el recorte de 058 a licitaciones convertidas');
assert.match(sql, /order by t\.tracking_updated_at desc nulls last, t\.id asc[\s\S]*?limit p_limit offset p_offset/i);
assert.match(sql, /revoke all on function public\.psi_list_tender_opportunity_page\(text, int, int\) from public/i);
assert.match(sql, /revoke all on function public\.psi_list_tender_opportunity_page\(text, int, int\) from anon/i);
assert.match(sql, /revoke all on function public\.psi_list_tender_opportunity_page\(text, int, int\) from authenticated/i);
assert.match(sql, /revoke all on function public\.psi_list_tender_opportunity_page\(text, int, int\) from service_role/i);
assert.match(sql, /grant execute on function public\.psi_list_tender_opportunity_page\(text, int, int\) to service_role/i);

// --- Precedencia exacta del clasificador primario, expresada una sola vez en SQL.
const stage = sql.match(/case\s*\n[\s\S]*?end as stage/i);
assert.ok(stage, 'el estado primario debe calcularse con una sola expresión CASE');
const stageSql = stage[0];
const closedIdx = stageSql.search(/'cerradas'/i);
const pendingIdx = stageSql.search(/'por_decidir'/i);
const activeIdx = stageSql.search(/'en_curso'/i);
assert.ok(closedIdx >= 0 && pendingIdx >= 0 && activeIdx >= 0, 'la expresión debe producir los tres estados primarios');
assert.ok(closedIdx < pendingIdx && pendingIdx < activeIdx, 'el orden de las ramas es la regla: cerradas, luego por decidir, luego en curso');
// Cerradas = NO GO humano O estado terminal, y la comparación de decisión debe ser NULL-safe:
// `d.decision = 'no_go'` sobre una fila sin decisión da NULL, no FALSE.
assert.match(stageSql, /coalesce\(d\.decision, ''\) = 'no_go'/i, 'la rama cerradas debe comparar la decisión de forma NULL-safe');
assert.match(stageSql, /coalesce\(o\.tender_offer_status, 'pendiente_decision'\) in \('cerrada_no_go', 'adjudicada', 'no_adjudicada'\)/i);
// Por decidir = todo lo no cerrado cuya decisión no sea el 'go' canónico (ausente o no canónica).
assert.match(stageSql, /coalesce\(d\.decision, ''\) <> 'go'[\s\S]*?'por_decidir'/i);

// --- Los predicados legados sobreviven intactos, byte a byte respecto de 058.
for (const legacyPredicate of (latest.match(/\(p_filter = '(?:pending_decision|go_authorized|in_preparation|submitted|closed)'[^\n]*\)/g) || [])) {
  assert.ok(sql.includes(legacyPredicate), `el predicado legado debe conservarse sin cambios: ${legacyPredicate}`);
}
assert.match(sql, /p_filter = st\.stage/i, 'los filtros primarios se resuelven contra el estado calculado');

console.log('tender opportunity primary stage migration static contract passed');
