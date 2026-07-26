import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';

const path = new URL('../supabase/migrations/027_tender_decision_current_analysis.sql', import.meta.url);
assert.equal(existsSync(path), true, 'La corrección autoritativa debe vivir en una migración nueva aplicable después de 025.');
const sql = readFileSync(path, 'utf8');

assert.match(sql, /create table if not exists public\.psi_tender_document_state/i, 'Debe existir un puntero explícito de vigencia.');
assert.match(sql, /function public\.psi_begin_tender_document_refresh/i, 'Cada refresh debe abrir un estado tokenizado.');
assert.match(sql, /psi_invalidate_tender_state_from_legacy_upload/i, 'Las cargas legacy deben invalidar el puntero vigente dentro de SQL.');
assert.match(sql, /psi_invalidate_tender_state_from_typed_version/i, 'Las versiones tipadas deben invalidar el puntero vigente dentro de SQL.');
assert.match(sql, /pg_trigger[\s\S]*psi_invalidate_tender_state_from_legacy_upload/i, 'El readiness debe exigir el trigger de carga legacy.');
assert.match(sql, /pg_trigger[\s\S]*psi_invalidate_tender_state_from_typed_version/i, 'El readiness debe exigir el trigger de versión tipada.');
assert.match(sql, /active_refresh_token is distinct from p_refresh_token/i, 'Sólo el refresh activo puede mover el puntero al cerrar.');
assert.match(sql, /p_refresh_token is null[\s\S]*token de actualización documental es obligatorio/i, 'Ningún caller puede publicar un snapshot sin token gobernado.');
assert.match(sql, /create function public\.psi_record_tender_go_no_go[\s\S]*p_document_hash text/i);
assert.match(sql, /v_analysis\.status is distinct from 'completed'/i, 'Sólo un run completado puede anclarse.');
assert.match(sql, /v_analysis_snapshot\.document_hash is distinct from p_document_hash/i, 'El run debe coincidir con el hash documental enviado.');
assert.match(sql, /v_state\.current_snapshot_id is distinct from v_analysis\.snapshot_id/i, 'El run debe pertenecer al puntero documental vigente.');
assert.match(sql, /v_state\.refresh_in_progress/i, 'No se debe anclar un run durante un refresh.');
assert.match(sql, /to_regclass\('public\.psi_tender_document_versions'\) is not null/i, 'Readiness debe incluir la dependencia tipada 026.');
assert.match(sql, /from public\.psi_sales_opportunities where id = p_opportunity_id for update/i, 'Snapshot y decisión deben compartir el lock de oportunidad.');
assert.match(sql, /revoke all on function public\.psi_record_tender_go_no_go\(uuid, uuid, uuid, text, uuid, text, jsonb, text\)/i);
assert.match(sql, /grant execute on function public\.psi_record_tender_go_no_go\(uuid, uuid, uuid, text, uuid, text, jsonb, text\) to service_role/i);

console.log('current analysis GO/NO GO migration contract passed');
