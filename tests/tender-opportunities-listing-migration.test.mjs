import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';

const migrationPath = new URL('../supabase/migrations/023_tender_opportunities_listing.sql', import.meta.url);
assert.equal(existsSync(migrationPath), true, 'La migración 023 debe existir.');
const sql = readFileSync(migrationPath, 'utf8');

assert.match(sql, /create or replace function public\.psi_list_tender_opportunity_page\(p_filter text, p_limit int, p_offset int\)/i);
assert.match(sql, /security definer/i);
assert.match(sql, /set search_path = public, pg_temp/i);
assert.match(sql, /p_filter is null or p_filter not in \('all', 'pending_decision', 'go_authorized', 'in_preparation', 'submitted', 'closed'\)/i);
assert.match(sql, /p_limit is null or p_limit < 1 or p_limit > 50/i);
assert.match(sql, /p_offset is null or p_offset < 0 or p_offset > 10000/i);
assert.match(sql, /join public\.psi_sales_opportunities o on o\.id = t\.converted_opportunity_id/i);
assert.match(sql, /left join lateral \([\s\S]*?order by d\.decided_at desc, d\.id desc[\s\S]*?limit 1/i);
assert.match(sql, /p_filter = 'pending_decision'[\s\S]*?coalesce\(o\.tender_offer_status, 'pendiente_decision'\) = 'pendiente_decision'[\s\S]*?d\.id is null/i);
assert.match(sql, /p_filter = 'go_authorized'[\s\S]*?d\.decision = 'go'[\s\S]*?'lista_para_presentar'/i);
assert.match(sql, /p_filter = 'in_preparation'[\s\S]*?'en_preparacion'[\s\S]*?'lista_para_presentar'/i);
assert.match(sql, /p_filter = 'closed'[\s\S]*?'cerrada_no_go'[\s\S]*?'adjudicada'[\s\S]*?'no_adjudicada'/i);
assert.match(sql, /order by t\.tracking_updated_at desc nulls last, t\.id asc[\s\S]*?limit p_limit offset p_offset/i);
assert.match(sql, /revoke all on function public\.psi_list_tender_opportunity_page\(text, int, int\) from public/i);
assert.match(sql, /revoke all on function public\.psi_list_tender_opportunity_page\(text, int, int\) from authenticated/i);
assert.match(sql, /grant execute on function public\.psi_list_tender_opportunity_page\(text, int, int\) to service_role/i);

console.log('tender opportunity paginated listing migration static contract passed');
