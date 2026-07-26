import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';

const rollback026Path = new URL('../supabase/rollbacks/026_tender_document_versions_rollback.sql', import.meta.url);
const rollback027Path = new URL('../supabase/rollbacks/027_tender_decision_current_analysis_rollback.sql', import.meta.url);
assert.equal(existsSync(rollback026Path), true, 'debe existir rollback versionado de 026');
assert.equal(existsSync(rollback027Path), true, 'debe existir rollback versionado de 027');
const rollback026 = readFileSync(rollback026Path, 'utf8');
const rollback027 = readFileSync(rollback027Path, 'utf8');

for (const [label, sql] of [['026', rollback026], ['027', rollback027]]) {
  assert.match(sql, /^\s*--[\s\S]*?begin;/i, `${label}: rollback debe iniciar una transacción documentada`);
  assert.match(sql, /commit;\s*$/i, `${label}: rollback debe cerrar la transacción`);
  assert.doesNotMatch(sql, /drop\s+table|drop\s+column|alter\s+table[\s\S]*?drop\s+column/i, `${label}: rollback no puede borrar tablas ni columnas`);
  assert.doesNotMatch(sql, /delete\s+from/i, `${label}: rollback no puede borrar filas/evidencia`);
  assert.doesNotMatch(sql, /truncate/i, `${label}: rollback no puede truncar datos`);
  assert.match(sql, /do \$\$[\s\S]*?raise exception[\s\S]*?\$\$;/i, `${label}: rollback debe fallar cerrado si faltan prerrequisitos`);
}

// 027 must be rolled back before 026 (LIFO) — 026's guard must refuse to run
// while 027 objects are still present, and 027's guard must require 026's
// typed relation before restoring 025-era signatures.
assert.match(rollback026, /psi_record_tender_document_snapshot\(uuid,uuid,text,text,jsonb,jsonb,uuid,uuid\)[\s\S]*?is not null[\s\S]*?raise exception/i, '026: debe negarse si 027 no se revirtió antes (orden LIFO)');
assert.match(rollback027, /psi_tender_document_versions.*is null[\s\S]*?raise exception/i, '027: debe exigir que 026 siga presente antes de restaurar 025');

// 027 restores the pre-027 (025-era) RPC signatures so pre-027 application
// code keeps working after rollback.
assert.match(rollback027, /drop function if exists public\.psi_record_tender_document_snapshot\(uuid, uuid, text, text, jsonb, jsonb, uuid, uuid\)/i);
assert.match(rollback027, /create (?:or replace )?function public\.psi_record_tender_document_snapshot\(\s*p_opportunity_id uuid,\s*p_tender_id uuid,\s*p_document_hash text,\s*p_profile_hash text,\s*p_document_manifest jsonb,\s*p_profile_snapshot jsonb,\s*p_actor_id uuid default null\s*\)/i, '027: debe restaurar la firma de snapshot de 7 argumentos de 025');
assert.match(rollback027, /drop function if exists public\.psi_record_tender_go_no_go\(uuid, uuid, uuid, text, uuid, text, jsonb, text\)/i);
assert.match(rollback027, /p_analysis_run_id uuid,\s*p_justification text,\s*p_preparation jsonb\s*\)/i, '027: debe restaurar la firma de GO/NO GO de 7 argumentos de 025 (sin p_document_hash)');
assert.match(rollback027, /create or replace function public\.psi_tender_analysis_foundation_ready\(\)/i, '027: debe restaurar el readiness de 025 sin dependencias de 026/027');
{
  const readinessStart = rollback027.search(/create or replace function public\.psi_tender_analysis_foundation_ready\(\)/i);
  const readinessEnd = rollback027.indexOf('$$;', readinessStart) + 3;
  const readinessBody = rollback027.slice(readinessStart, readinessEnd);
  assert.doesNotMatch(readinessBody, /psi_tender_document_state/i, '027: el readiness restaurado no debe volver a exigir psi_tender_document_state');
}

// Neither rollback disables psi_is_public_https_url — it backs a CHECK
// constraint on the retained psi_tender_document_versions table. Mentioning
// it in an explanatory comment is fine; touching it via SQL is not.
assert.doesNotMatch(rollback026, /(?:revoke|grant|drop|alter)[^\n;]*psi_is_public_https_url/i, '026: no debe tocar la función usada por el CHECK de source_url');

// De-powering happens via revoke, not by deleting the exposed capability's structure.
assert.match(rollback026, /revoke all on function public\.psi_record_company_procurement_document\([^)]*\) from service_role/i);
assert.match(rollback026, /revoke all on function public\.psi_record_tender_document_version\([^)]*\) from service_role/i);
assert.match(rollback027, /revoke all on function public\.psi_begin_tender_document_refresh\(uuid, uuid\) from service_role/i);

console.log('tender document state rollback safety contract passed');
