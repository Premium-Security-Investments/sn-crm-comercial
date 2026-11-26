// AGT-003 — contratos de los clientes (Juan, 2026-11-26): estado, vencimiento, fuente y alcance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contratosDeClientes, estadoContrato, inicioDeComision, resumenContratos } from '../src/vigia/contratos-clientes.js';
import { crearLectorAvancys } from '../avancys-odoo-lectura.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const HOY = '2026-11-26';

test('la revisión escrita manda sobre la fecha; si no decide, decide la fecha de fin', () => {
  assert.equal(estadoContrato({ fecha_fin: '2028-05-31', observacion: 'SIN CONTRATO VIGENTE' }, HOY).estado, 'sin_contrato');
  assert.equal(estadoContrato({ fecha_fin: null, observacion: 'TIENE CARPETA PERO NO CONTRATO' }, HOY).estado, 'sin_contrato');
  assert.equal(estadoContrato({ fecha_fin: '2025-10-31', observacion: 'SE RENOVO' }, HOY).estado, 'renovado');
  assert.equal(estadoContrato({ fecha_fin: '2025-11-30', observacion: 'REVISAR COMERCIAL' }, HOY).estado, 'revisar');
  assert.equal(estadoContrato({ fecha_fin: '2025-10-31', observacion: 'OK- SE VENCIO' }, HOY).estado, 'vencido');
  assert.deepEqual(estadoContrato({ fecha_fin: '2026-12-15', observacion: 'CONTRATO VIGENTE' }, HOY), { estado: 'por_vencer', dias: 19 });
  assert.equal(estadoContrato({ fecha_fin: '2027-12-21', observacion: 'CONTRATO VIGENTE' }, HOY).estado, 'vigente');
  assert.equal(estadoContrato({ fecha_fin: null, observacion: null }, HOY).estado, 'sin_fecha');
  assert.equal(inicioDeComision({ fecha_inicio: '2011-04-16', fecha_ultima_renovacion: '2023-07-01' }), '2023-07-01');
});

test('las fechas de Avancys mandan cuando existen; cada fila dice su fuente; orden por urgencia', () => {
  const archivo = [
    { nit: '1', razon_social: 'Uno', fecha_inicio: '2020-01-01', fecha_ultima_renovacion: null, fecha_fin: '2027-12-01', observacion: 'CONTRATO VIGENTE', fuente: 'Archivo' },
    { nit: '2', razon_social: 'Dos', fecha_inicio: '2020-01-01', fecha_ultima_renovacion: null, fecha_fin: '2028-01-01', observacion: 'SIN CONTRATO VIGENTE', fuente: 'Archivo' },
  ];
  const avancys = { 2: { comercial_id: 5, comercial: 'C', fecha_inicio: '2026-01-01', fecha_fin: '2026-12-20' } };
  const r = contratosDeClientes(archivo, avancys, HOY);
  assert.equal(r[0].nit, '2', 'lo que vence pronto va primero');
  assert.equal(r[0].estado, 'por_vencer', 'con fechas de Avancys la revisión vieja del archivo ya no decide');
  assert.equal(r[0].fuente, 'Avancys');
  assert.equal(r[1].fuente, 'Archivo');
  assert.equal(resumenContratos(r).por_vencer, 1);
});

test('lector: busca el cliente por NIT en ref_num y su contrato; devuelve el comercial', async () => {
  const pedidos = [];
  const fetchImpl = async (_url, opciones) => {
    const cuerpo = JSON.parse(opciones.body);
    const { service, args } = cuerpo.params;
    let result = [];
    if (service === 'common') result = 7;
    else {
      const [, , , modelo, , posicional] = args;
      pedidos.push({ modelo, dominio: posicional[0] });
      if (modelo === 'res.partner') result = [{ id: 10, ref_num: '900645204', user_id: [5, 'Comercial Cinco'] }];
      if (modelo === 'project.project') result = [{ id: 1, partner_id: [10, 'X'], date_start: false, date: false }];
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: cuerpo.id, result }) };
  };
  const lector = crearLectorAvancys({ entorno: { AVANCYS_ODOO_URL: 'https://avancys.ejemplo.test', AVANCYS_ODOO_DATABASE: 'b', AVANCYS_ODOO_USERNAME: 'u', AVANCYS_ODOO_API_KEY: 'k' }, fetchImpl });
  const r = await lector.clientesPorNit({ nits: ['900645204-1'] });
  assert.deepEqual(pedidos[0].dominio, [['ref_num', 'in', ['900645204']]]);
  assert.deepEqual(r['900645204'], { comercial_id: 5, comercial: 'Comercial Cinco', fecha_inicio: null, fecha_fin: null });
});

test('servidor, migración y pantallas: alcance de «Mis clientes», tabla sólo del servidor, Dashboard y Mi día', () => {
  for (const file of ['../server/index.js', '../api/[...path].js']) {
    const src = read(file);
    assert.ok(src.includes("'GET /api/agt003/contratos-clientes': ['opportunities', ACTIONS.CRM_OPPORTUNITY_DETAIL_VIEW],"));
    const h = src.slice(src.indexOf("app.get('/api/agt003/contratos-clientes'"), src.indexOf('\n});', src.indexOf("app.get('/api/agt003/contratos-clientes'")));
    assert.match(h, /requireModuleAction\(currentProfile, 'opportunities'\)/);
    assert.match(h, /veTodaLaCarteraComercial\(currentProfile\) && req\.query\.alcance !== 'propios'/);
    assert.match(h, /propios\.has\(c\.comercial_id\)/, 'el comercial sólo ve sus clientes');
  }
  const sql = read('../supabase/migrations/238_agt003_contratos_clientes.sql');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.psi_client_contracts from public, anon, authenticated/);
  const main = read('../src/main.tsx');
  assert.match(main, /<ContratosClientesPanel modo="equipo" \/>/);
  assert.match(main, /<ContratosClientesPanel modo="propio" \/>\n\s*<RenewalsDue items=\{renewals\} \/>/);
});
