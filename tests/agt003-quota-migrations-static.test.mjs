// Prueba estática de las migraciones 117–119 (escritas, NO aplicadas) y de las pantallas que cambian con ellas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const MIGRATIONS = {
  117: '117_agt003_copilot_quota_by_actor',
  118: '118_agt003_lead_analysis_quota_by_actor',
  119: '119_crm_profile_ai_usage_profile',
};

test('117–119 son los siguientes números libres, con transacción y reversa', () => {
  const numbers = readdirSync(new URL('../supabase/migrations/', import.meta.url)).map(name => name.slice(0, 3));
  for (const [number, name] of Object.entries(MIGRATIONS)) {
    assert.equal(numbers.filter(value => value === number).length, 1, `una sola migración ${number}`);
    const sql = read(`../supabase/migrations/${name}.sql`);
    assert.match(sql, /^begin;$/m);
    assert.match(sql, /commit;\s*$/);
    assert.ok(existsSync(new URL(`../supabase/rollbacks/${name}_rollback.sql`, import.meta.url)), `reversa de ${number}`);
  }
});

test('117: reserva v2 del copiloto con el mismo lock, sin tocar la original ni el historial', () => {
  const sql = read(`../supabase/migrations/${MIGRATIONS[117]}.sql`);
  assert.match(sql, /create or replace function public\.psi_claim_agt003_copilot_run_v2\(\n  p_idempotency_key text,\n  p_actor_id uuid,\n  p_team_max integer,\n  p_team_period_start timestamptz,\n  p_actor_max integer,\n  p_actor_period_start timestamptz,/);
  assert.ok(sql.includes("pg_advisory_xact_lock(hashtextextended('psi_agt003_copilot_claims:v1', 0))"), 'mismo lock que 043');
  assert.match(sql, /security definer\nset search_path = public, pg_temp/);
  assert.match(sql, /'scope', 'team'/);
  assert.match(sql, /'scope', 'actor'/);
  assert.match(sql, /alter table public\.psi_agt003_copilot_claims add column if not exists actor_id uuid;/);
  assert.doesNotMatch(sql, /function public\.psi_claim_agt003_copilot_run\(/, 'la reserva original no se reemplaza');
  assert.doesNotMatch(sql, /drop table|delete from public\.psi_agt003_copilot_runs|truncate/i);
  assert.match(sql, /revoke all on function public\.psi_claim_agt003_copilot_run_v2\([^)]+\) from public, anon, authenticated, service_role;/);
  assert.match(sql, /grant execute on function public\.psi_claim_agt003_copilot_run_v2\([^)]+\) to service_role;/);
});

test('118: reserva v2 del análisis profundo con el mismo lock y la misma definición de uso', () => {
  const sql = read(`../supabase/migrations/${MIGRATIONS[118]}.sql`);
  assert.ok(sql.includes("pg_advisory_xact_lock(hashtextextended('agt003-lead-analysis', 0))"), 'mismo lock que 114');
  assert.ok(sql.includes("(status = 'completed' or (status = 'running' and created_at > now() - interval '5 minutes'))"), 'cuenta completados + en curso recientes');
  assert.match(sql, /where actor_id = p_actor_id and created_at >= p_actor_period_start/);
  assert.doesNotMatch(sql, /function public\.psi_claim_agt003_lead_analysis\(/);
  assert.match(sql, /grant execute on function public\.psi_claim_agt003_lead_analysis_v2\([^)]+\) to service_role;/);
  assert.match(sql, /revoke all on function public\.psi_claim_agt003_lead_analysis_v2\([^)]+\) from public, anon, authenticated;/);
});

test('119: columna con formato de slug y escritura auditada sólo por service_role', () => {
  const sql = read(`../supabase/migrations/${MIGRATIONS[119]}.sql`);
  assert.match(sql, /alter table public\.psi_sales_profiles add column if not exists ai_usage_profile text;/);
  assert.ok(sql.includes("check (ai_usage_profile is null or ai_usage_profile ~ '^[a-z][a-z0-9_]{1,40}$')"));
  assert.match(sql, /insert into public\.psi_access_audit_log/);
  assert.match(sql, /'profile\.ai_usage_profile\.set'/);
  assert.match(sql, /grant execute on function public\.psi_admin_set_profile_ai_usage_profile\(uuid, text, uuid\) to service_role;/);
});

test('servidor: usa las reservas v2 con caída a las originales y nunca aplica migraciones', () => {
  const quota = read('../agt003-ai-quota.js');
  for (const rpc of ['psi_claim_agt003_copilot_run_v2', 'psi_claim_agt003_copilot_run', 'psi_claim_agt003_lead_analysis_v2', 'psi_claim_agt003_lead_analysis']) assert.ok(quota.includes(`'${rpc}'`), rpc);
  assert.ok(quota.includes("console.warn('agt003_quota_rpc_fallback'"));
  const server = read('../server/index.js');
  assert.equal(server, read('../api/[...path].js'));
  assert.ok(server.includes("database.rpc('psi_admin_set_profile_ai_usage_profile'"));
  assert.doesNotMatch(server, /psi_claim_agt003_lead_analysis', \{/, 'la ruta ya no llama directo a la reserva original');
});

test('pantallas: "Perfil de uso de IA" en Usuarios y permisos y "Tope actual" con su origen y el día de Bogotá', () => {
  const main = read('../src/main.tsx');
  const users = main.slice(main.indexOf('function UsersAdmin'), main.lastIndexOf('createRoot('));
  for (const text of ['Perfil de uso de IA', '<option value="">Sin perfil</option>', "disabled={aiProfiles.status !== 'ready'}", 'Los perfiles se crean en IT → Agentes → Perfiles de uso.', '/api/platform/ai-usage-profiles', 'se conserva el perfil guardado']) {
    assert.ok(users.includes(text), text);
  }
  assert.ok(users.includes("aiProfiles.status === 'ready' ? { ...formWithoutAiProfile, ai_usage_profile: aiUsageProfile ?? null } : formWithoutAiProfile"), 'sin plataforma no se envía el campo');
  const usage = read('../src/platform/ModelUsageSection.tsx');
  assert.ok(usage.includes('Tope actual del equipo {limit.periodLabel}'));
  assert.ok(usage.includes('limitSourceText(item.limit)'));
  assert.ok(usage.includes('bogotaDayText(today)'));
  const presentation = read('../src/platform/agentsPresentation.ts');
  assert.ok(presentation.includes("'valores del código (sin versión aprobada)'"));
  assert.ok(presentation.includes('`configuración vigente (versión ${limit.version_number})`'));
});
