// Cotizador de modelos de servicio: lleva precios, costos y márgenes de clientes. Sólo con la Torre y además el permiso
// de capacidad `siio_cotizador_modelos`, en la pantalla, en el servidor y en la base.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accessFromTabs, tabsFromProfile } from '../profile-tabs.js';

const leer = ruta => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');

test('la casilla del cotizador da el permiso solo con la Torre y no con solo consulta', () => {
  const con = accessFromTabs({ tabs: ['torre'], model_quoter: true });
  assert.ok(con.permissions.includes('siio_cotizador_modelos'));
  assert.ok(con.permissions.includes('modulo_siio_gerencial'));
  const sinTorre = accessFromTabs({ tabs: ['dashboard'], model_quoter: true });
  assert.ok(!sinTorre.permissions.includes('siio_cotizador_modelos'));
  assert.throws(() => accessFromTabs({ tabs: ['torre'], read_only: true, model_quoter: true }), /Solo consulta/);
  assert.equal(tabsFromProfile({ role: 'gerencia', permissions: ['modulo_siio_gerencial', 'siio_cotizador_modelos'] }).model_quoter, true);
  assert.equal(tabsFromProfile({ role: 'gerencia', permissions: ['modulo_siio_gerencial'] }).model_quoter, false);
});

test('el menú y la ruta piden la Torre más el permiso de capacidad', () => {
  const nav = leer('src/navPermissions.ts');
  assert.match(nav, /if \(page === 'modelos'\) return canUseServiceModelQuoter\(profile\);/);
  assert.match(nav, /hasModuleAccess\(profile, 'modulo_siio_gerencial'\)[\s\S]{0,200}permissions\?\.includes\('siio_cotizador_modelos'\)/);
});

test('el servidor exige el permiso en las dos rutas y no expone nombres de tiendas', () => {
  const servidor = leer('server/index.js');
  assert.match(servidor, /function requireServiceModelAccess\(profile\) \{\s*requireModuleAction\(profile, 'siio'\);/);
  assert.match(servidor, /!hasPermission\(profile, SERVICE_MODEL_PERMISSION\)/);
  for (const ruta of ["app.get('/api/siio/cotizador-modelos'", "app.post('/api/siio/cotizador-modelos/escenarios'"]) {
    const inicio = servidor.indexOf(ruta);
    assert.ok(inicio > 0, ruta);
    assert.match(servidor.slice(inicio, inicio + 400), /requireServiceModelAccess\(profile\)/, ruta);
  }
  const get = servidor.slice(servidor.indexOf("app.get('/api/siio/cotizador-modelos'"), servidor.indexOf("app.post('/api/siio/cotizador-modelos/escenarios'"));
  assert.doesNotMatch(get, /store_name|store_code/);
  assert.equal(servidor, leer('api/[...path].js'));
});

test('las tablas son solo del servidor y el permiso existe en la base', () => {
  const sql = leer('supabase/migrations/235_siio_cotizador_modelos.sql');
  assert.match(sql, /insert into public\.psi_access_permissions\(code, name, description, active\) values\s*\('siio_cotizador_modelos'/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.psi_service_model_stores, public\.psi_service_model_scenarios from public, anon, authenticated;/);
});
