import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIONS } from '../access-control.js';

const savedEnv = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL'].map(key => [key, process.env[key]]));
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';
const { requireOpportunityAction } = await import('../server/index.js');

function database({ owner, assignments = [] }) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      const rows = table === 'psi_sales_profiles' ? owner : assignments;
      const query = {
        select() { return query; },
        eq() { return query; },
        single() { return Promise.resolve({ data: rows, error: null }); },
        then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
      };
      return query;
    },
  };
}

const ownerId = 'owner-active';
const admin = { id: 'admin-id', role: 'admin', active: true, permissions: ['modulo_oportunidades'], areas: [] };
const gerencia = { id: 'gerencia-id', role: 'gerencia', active: true, permissions: ['modulo_oportunidades'], areas: [] };
const directorNorth = { id: 'director-id', role: 'director', active: true, permissions: ['modulo_oportunidades'], areas: [{ area_code: 'comercial', subarea_code: 'norte' }] };

await assert.rejects(
  () => requireOpportunityAction(database({ owner: null }), admin, ownerId, ACTIONS.CRM_OPPORTUNITY_CREATE),
  error => error?.status === 404 && /responsable/i.test(error.message),
  'missing owner must fail explicitly before assignments or action authorization',
);
await assert.rejects(
  () => requireOpportunityAction(database({ owner: { id: ownerId, active: false } }), admin, ownerId, ACTIONS.CRM_OPPORTUNITY_CREATE),
  error => error?.status === 400 && /activo/i.test(error.message),
  'inactive owner must fail explicitly before assignments or action authorization',
);

for (const profile of [admin, gerencia]) {
  const db = database({ owner: { id: ownerId, active: true }, assignments: [] });
  assert.equal(await requireOpportunityAction(db, profile, ownerId, ACTIONS.CRM_OPPORTUNITY_CREATE), true, `${profile.role} may act on an active owner`);
  assert.deepEqual(db.calls, ['psi_sales_profiles', 'psi_profile_area_assignments'], `${profile.role} resolves the active owner server-side before assignment policy`);
}

await assert.rejects(
  () => requireOpportunityAction(database({ owner: { id: ownerId, active: true }, assignments: [{ area_code: 'comercial', subarea_code: 'sur' }] }), directorNorth, ownerId, ACTIONS.CRM_OPPORTUNITY_REASSIGN),
  error => error?.status === 403,
  'director outside owner scope cannot reassign',
);
assert.equal(
  await requireOpportunityAction(database({ owner: { id: ownerId, active: true }, assignments: [{ area_code: 'comercial', subarea_code: 'norte' }] }), directorNorth, ownerId, ACTIONS.CRM_OPPORTUNITY_REASSIGN),
  true,
  'director in owner scope can reassign',
);

const source = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
for (const route of ["app.post('/api/opportunities'", "app.put('/api/opportunities/:id'", "app.put('/api/opportunity'"]) {
  const start = source.indexOf(route);
  const end = source.indexOf('\n});', start);
  const handler = source.slice(start, end);
  assert.match(handler, /requireOpportunityAction\(database, currentProfile, payload\.owner_id/, `${route} must route owner authorization through the server-side active-owner resolver`);
}

for (const [key, value] of Object.entries(savedEnv)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

console.log('Opportunity owner access regression passed');
