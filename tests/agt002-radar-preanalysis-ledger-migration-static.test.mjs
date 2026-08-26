import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/072_agt002_radar_preanalysis_ledger.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/072_agt002_radar_preanalysis_ledger_rollback.sql', import.meta.url), 'utf8');

// Postura de seguridad del ledger de preanálisis.
assert.match(migration, /enable row level security/i);
assert.match(migration, /security definer/i);
assert.match(migration, /set search_path\s*=\s*public,\s*pg_temp/i);
assert.match(migration, /revoke all on function public\.psi_record_agt002_radar_preanalysis_run/i);
assert.match(migration, /grant execute on function public\.psi_record_agt002_radar_preanalysis_run[^;]+ to service_role/i);
assert.match(migration, /before update or delete on public\.psi_agt002_radar_preanalysis_runs/i);
assert.match(migration, /append-only/i);

// BLOCKER: `human_review_required` es autoridad humana no negociable y su comprobación no puede ser
// permisiva ante NULL. `(result->'clave')='true'::jsonb` devuelve NULL cuando la clave falta, y un
// CHECK que no es falso pasa; `<>` en la RPC devuelve NULL y el `if` no se toma. Ambas rutas deben
// cerrar a falso de forma explícita, de modo que sólo el booleano JSON `true` sea aceptado.
const HUMAN_REVIEW_TABLE_CHECK = /coalesce\(\s*\(result->'human_review_required'\)\s*=\s*'true'::jsonb\s*,\s*false\s*\)\s+is\s+true/i;
const HUMAN_REVIEW_RPC_CHECK = /not\s+coalesce\(\s*\(p_result->'human_review_required'\)\s*=\s*'true'::jsonb\s*,\s*false\s*\)/i;
assert.match(migration, HUMAN_REVIEW_TABLE_CHECK, 'el CHECK de tabla debe cerrar el NULL con coalesce/is true');
assert.match(migration, HUMAN_REVIEW_RPC_CHECK, 'la RPC debe cerrar el NULL con not coalesce(...)');
// Ninguna comparación desnuda (sin coalesce) puede sobrevivir en el archivo.
assert.doesNotMatch(migration, /(?<!coalesce\()\((?:p_)?result->'human_review_required'\)\s*<>\s*'true'::jsonb/i,
  'ninguna ruta puede usar `<>` desnudo sobre human_review_required');
for (const line of migration.split('\n')) {
  if (!line.includes("human_review_required")) continue;
  if (/^\s*--/.test(line)) continue;
  assert.match(line, /coalesce\(/i, `toda comparación de human_review_required debe pasar por coalesce: ${line.trim()}`);
}

// La forma existente del ledger no se relaja al endurecer la marca de revisión humana.
assert.match(migration, /constraint psi_agt002_radar_preanalysis_runs_evidence_check check \(jsonb_typeof\(evidence\)='array' and jsonb_array_length\(evidence\)>=1\)/i);
assert.match(migration, /constraint psi_agt002_radar_preanalysis_runs_verdict_status_check/i);
assert.match(migration, /constraint psi_agt002_radar_preanalysis_runs_learning_shape_check/i);
assert.match(migration, /create unique index psi_agt002_radar_preanalysis_one_canonical_idx/i);

assert.match(rollback, /drop function if exists public\.psi_record_agt002_radar_preanalysis_run/i);
assert.match(rollback, /drop table if exists public\.psi_agt002_radar_preanalysis_runs/i);
for (const sql of [migration, rollback]) {
  assert.doesNotMatch(sql, /psi_sales_opportunities|psi_convert_tender_to_opportunity|converted_opportunity_id|internal_status/i);
}
console.log('AGT-002 Radar preanalysis ledger migration static safety passed');
