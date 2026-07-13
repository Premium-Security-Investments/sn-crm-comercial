import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const officialFronts = [
  ['F1', 'Gestión Comercial Inteligente'],
  ['F2', 'Gestión Gerencial y Control'],
  ['F3', 'Gestión Operativa'],
  ['F3A', 'Personal activo y operación diaria'],
  ['F3B', 'Reclutamiento, selección y contratación permanente'],
  ['F4', 'Archivo Corporativo Inteligente'],
  ['F5', 'Motor Interno de Razonamiento'],
  ['F6', 'Catálogo Institucional de Agentes'],
];

const migrationsDir = 'supabase/migrations';
const migrationFiles = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).map((name) => join(migrationsDir, name));
const migrations = migrationFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
const ui = readFileSync('src/main.tsx', 'utf8');
const pkg = readFileSync('package.json', 'utf8');

assert.ok(existsSync('supabase/migrations/015_siio_official_fronts_seed.sql'), 'missing official SIIO fronts seed migration 015');
assert.ok(migrations.includes('insert into public.siio_fronts'), 'official seed must insert/upsert into public.siio_fronts');

for (const [id, name] of officialFronts) {
  assert.ok(migrations.includes(`('${id}'`) || migrations.includes(`('${id}',`), `migration must seed ${id}`);
  assert.ok(migrations.includes(name), `migration must include official name: ${name}`);
  assert.ok(ui.includes(name), `UI must display official name: ${name}`);
}

assert.ok(ui.includes('Archivo Corporativo Inteligente'), 'F4 copy must say Archivo Corporativo Inteligente, not only Fuentes F4');
assert.ok(ui.includes('Motor Interno de Razonamiento'), 'F5 copy must be present as reasoning layer');
assert.ok(ui.includes('Catálogo Institucional de Agentes'), 'F6 copy must be present as agent catalog');
assert.ok(!ui.includes('Fuentes trazables'), 'UI should not reduce F4 to Fuentes trazables');
assert.ok(!ui.includes("['junta','Junta mensual']"), 'main tab should not make Junta monthly look like a standalone F5 front');
assert.ok(pkg.includes('check_siio_official_fronts.mjs'), 'package check:permissions must run SIIO official fronts checker');

console.log('siio official fronts OK');
