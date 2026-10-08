import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeClientProfile, profileCompleteness, hasClientProfileFields, CLIENT_PROFILE_FIELDS } from '../src/vigia/client-profile.js';
import { PROFILE_COLUMNS, statusOf } from '../scripts/agt003-client-profile-fields-migration.mjs';

test('normaliza web, LinkedIn y proveedor', () => {
  const p = normalizeClientProfile({ company_website: 'www.frontierdelcaribe.com', decision_maker_linkedin: 'linkedin.com/in/juanjosekousen', current_security_provider: '  Atlas  ', current_contract_end_date: '2027-03-31' });
  assert.equal(p.company_website, 'https://www.frontierdelcaribe.com/');
  assert.equal(p.decision_maker_linkedin, 'https://linkedin.com/in/juanjosekousen');
  assert.equal(p.current_security_provider, 'Atlas');
  assert.equal(p.current_security_provider_none, false);
  assert.equal(p.current_contract_end_date, '2027-03-31');
  assert.throws(() => normalizeClientProfile({ decision_maker_linkedin: 'facebook.com/x' }), /LinkedIn/);
  assert.throws(() => normalizeClientProfile({ company_website: 'no es web' }), /página web/);
  assert.throws(() => normalizeClientProfile({ current_contract_end_date: '31/03/2027' }), /fecha/);
});

test('"No tiene" proveedor limpia nombre y vencimiento', () => {
  const p = normalizeClientProfile({ current_security_provider: 'X', current_security_provider_none: true, current_contract_end_date: '2027-01-01' });
  assert.deepEqual([p.current_security_provider, p.current_security_provider_none, p.current_contract_end_date], [null, true, null]);
});

test('perfil completo: NIT y vencimiento no cuentan; "No tiene" sí cuenta', () => {
  const base = { economic_sector: 'Logística', company_website: 'https://a.co', decision_maker_name: 'Ana', decision_maker_title: 'Gerente', decision_maker_email: 'a@a.co', decision_maker_phone: '300', decision_maker_linkedin: 'https://linkedin.com/in/a' };
  assert.equal(profileCompleteness({ ...base, current_security_provider_none: true }).complete, true);
  assert.equal(profileCompleteness({ ...base, current_security_provider: 'Atlas' }).complete, true);
  const missing = profileCompleteness(base);
  assert.equal(missing.complete, false);
  assert.deepEqual(missing.missing, ['Proveedor actual (o "No tiene")']);
  assert.equal(profileCompleteness({}).done, 0);
});

test('sólo toca el perfil si la petición trae sus campos', () => {
  assert.equal(hasClientProfileFields({ company_name: 'X' }), false);
  assert.equal(hasClientProfileFields({ company_nit: '' }), true);
});

test('migración 113 aditiva con reversa y aplicador alineados', () => {
  const up = readFileSync('supabase/migrations/113_agt003_client_profile_fields.sql', 'utf8');
  const down = readFileSync('supabase/rollbacks/113_agt003_client_profile_fields_rollback.sql', 'utf8');
  assert.deepEqual([...PROFILE_COLUMNS].sort(), [...CLIENT_PROFILE_FIELDS].sort());
  for (const column of PROFILE_COLUMNS) {
    assert.match(up, new RegExp(`add column if not exists ${column}\\b`));
    assert.match(down, new RegExp(`drop column if exists ${column}\\b`));
  }
  assert.doesNotMatch(up, /\b(grant|drop|create\s+or\s+replace\s+view|security_invoker)\b/i, 'sin permisos, vistas ni borrados');
  assert.equal(statusOf({ columns: PROFILE_COLUMNS.length }), 'applied');
  assert.equal(statusOf({ columns: 0 }), 'absent');
  assert.equal(statusOf({ columns: 3 }), 'partial');
});
