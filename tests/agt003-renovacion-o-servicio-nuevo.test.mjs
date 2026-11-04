// AGT-003 — Cliente actual: ¿renovación o servicio nuevo? (Juan, 2026-11-03).
// Regla del servidor, formulario, ficha, tabla, filtro y migración 173.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLIENT_DEAL_FIELD, CLIENT_DEAL_TYPES, clientDealLabel, normalizeClientDeal, normalizeClientProfile } from '../src/vigia/client-profile.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('con cliente actual es obligatoria, y en una renovación también la fecha del contrato', () => {
  assert.deepEqual(CLIENT_DEAL_TYPES.map(([code]) => code), ['renovacion', 'servicio_nuevo']);
  assert.equal(clientDealLabel('renovacion'), 'Renovación');
  assert.equal(clientDealLabel('otra'), null);
  const actual = extra => normalizeClientDeal({ customer_segment: 'cliente_actual', client_deal_type: '', ...extra });
  assert.throws(() => actual({}), /renovación del contrato o un servicio nuevo/);
  assert.throws(() => actual({ client_deal_type: 'venta' }), /no válido/);
  assert.throws(() => actual({ client_deal_type: 'renovacion' }), /cuándo vence el contrato/);
  assert.throws(() => actual({ client_deal_type: 'renovacion', current_contract_end_date: '31/03/2027' }), /no es válida/);
  assert.deepEqual(actual({ client_deal_type: 'renovacion', current_contract_end_date: '2027-03-31' }), { client_deal_type: 'renovacion' });
  assert.deepEqual(actual({ client_deal_type: 'servicio_nuevo' }), { client_deal_type: 'servicio_nuevo' });
});

test('con cliente nuevo queda en nulo; si la petición no trae los dos campos no se toca', () => {
  assert.deepEqual(normalizeClientDeal({ customer_segment: 'cliente_nuevo', client_deal_type: 'renovacion' }), { client_deal_type: null });
  assert.equal(normalizeClientDeal({ customer_segment: 'cliente_actual' }), undefined, 'el chat reenvía el tipo de cliente sin este campo');
  assert.equal(normalizeClientDeal({ client_deal_type: 'renovacion' }), undefined);
  assert.equal(normalizeClientDeal(undefined), undefined);
});

test('en una renovación la fecha del contrato se guarda aunque el proveedor esté marcado "No tiene"', () => {
  const body = { current_security_provider_none: true, current_contract_end_date: '2027-03-31' };
  assert.equal(normalizeClientProfile(body).current_contract_end_date, null, 'sin renovación sigue como antes');
  assert.equal(normalizeClientProfile({ ...body, client_deal_type: 'renovacion' }).current_contract_end_date, '2027-03-31');
});

test('el servidor valida antes de guardar en los cinco caminos y lee/escribe con tolerancia a la migración', () => {
  for (const file of ['../server/index.js', '../api/[...path].js']) {
    const src = read(file);
    assert.equal((src.match(/if \(payload\.service_type_code !== 'licitacion_publica'\) normalizeClientDeal\((req\.)?body\);/g) || []).length, 5);
    assert.match(src, /select\(`id,\$\{CLIENT_DEAL_FIELD\}`\)/);
    assert.match(src, /if \(deals\.error && deals\.error\.code !== '42703'\) throw deals\.error;/, 'sin la columna, el perfil sigue');
    assert.match(src, /const deal = normalizeClientDeal\(body\);\n  if \(!deal\) return;/);
  }
  assert.equal(CLIENT_DEAL_FIELD, 'client_deal_type');
});

test('formulario, ficha, tabla y filtro de la lista', () => {
  const ui = read('../src/main.tsx');
  assert.match(ui, /<label>¿Renovación o servicio nuevo\?<Select [^\n]*required\/><\/label>/);
  assert.match(ui, /form\.client_deal_type === 'renovacion' && <label>Vence el contrato actual<input type="date" required/);
  assert.match(ui, /client_deal_type: v === 'cliente_actual' \? prev\.client_deal_type : ''/, 'al pasar a cliente nuevo se limpia');
  assert.match(ui, /<Badge>Tipo de cliente: \{customerSegmentDealLabel\(o\)\}<\/Badge>/);
  assert.match(ui, /options=\{customerSegmentFilterOptions\} empty="Clientes"/);
  assert.match(ui, /matchesCustomerSegmentFilter\(o, customerSegmentFilter\)/);
  assert.match(read('../src/vigia/client-profile.js'), /\['cliente_actual:sin_clasificar', 'Cliente Actual · Sin clasificar'\]/);
});

test('migración 173 aditiva, con check de valores y rollback', () => {
  const up = read('../supabase/migrations/173_crm_renovacion_o_servicio_nuevo.sql');
  const down = read('../supabase/rollbacks/173_crm_renovacion_o_servicio_nuevo_rollback.sql');
  assert.match(up, /add column if not exists client_deal_type text;/);
  assert.match(up, /check \(client_deal_type is null or client_deal_type in \('renovacion', 'servicio_nuevo'\)\)/);
  assert.doesNotMatch(up, /\b(grant|revoke|create\s+or\s+replace|drop\s+column)\b/i, 'sin permisos, funciones ni borrados');
  assert.match(down, /drop column if exists client_deal_type;/);
});
