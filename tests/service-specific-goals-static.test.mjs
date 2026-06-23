import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/007_service_specific_goals.sql', import.meta.url), 'utf8');

const requiredMainMarkers = [
  'service_type_code: string | null',
  'regional_nombre?: string | null',
  'operational_unit_target?: number',
  'goalMatchesV2Scope',
  'serviceScopedGoalsV2',
  'goal.service_type_code',
  'goal.regional_nombre',
  'Unidad meta',
  'Servicio / producto de la meta',
  'Regional de la meta',
  'Cantidad unidades / puestos 24H',
];

const requiredServerMarkers = [
  'service_type_code: body.service_type_code || null',
  'regional_nombre: body.regional_nombre || null',
  'operational_unit_target: Number(body.operational_unit_target || 0)',
  "onConflict: 'user_id,period_month,service_type_code,regional_nombre'",
];

const requiredMigrationMarkers = [
  'alter table if exists public.psi_sales_goals',
  'add column if not exists service_type_code text',
  'add column if not exists regional_nombre text',
  'add column if not exists operational_unit_target numeric',
  'psi_sales_goals_user_period_service_regional_unique',
  'user_id, period_month, service_type_code, regional_nombre',
];

for (const marker of requiredMainMarkers) assert.ok(main.includes(marker), `main.tsx missing service-specific goal marker: ${marker}`);
for (const marker of requiredServerMarkers) assert.ok(server.includes(marker), `server/index.js missing service-specific goal marker: ${marker}`);
for (const marker of requiredMigrationMarkers) assert.ok(migration.includes(marker), `migration missing service-specific goal marker: ${marker}`);

assert.ok(!main.includes('const budget = data.goals.filter(goal => goal.user_id === profile.id).reduce'), 'Dashboard 2 must not sum all goals for a commercial without service/regional filtering');
assert.ok(!main.includes('|| data.goals.reduce((sum, goal) => sum + Number(goal.sales_budget || 0), 0)'), 'Dashboard 2 must not fall back to all CRM goals for a filtered product');

console.log('service-specific goals static checks passed');
