import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';

const serverModule = await import('../server/index.js');
const apiModule = await import('../api/[...path].js');

function runGateContract(clientProfileForTenderUi, entrypoint) {
  const profile = {
    id: 'profile-1',
    active: true,
    role: 'admin',
    permissions: ['modulo_oportunidades', 'licitaciones', 'licitaciones_custodia'],
  };

  const offByDefault = clientProfileForTenderUi(profile, {});
  assert.notEqual(offByDefault, profile, `${entrypoint}: off debe devolver una copia al filtrar`);
  assert.deepEqual(offByDefault.permissions, ['modulo_oportunidades', 'licitaciones_custodia'], `${entrypoint}: off debe ocultar solo el permiso UI licitaciones`);
  assert.deepEqual(profile.permissions, ['modulo_oportunidades', 'licitaciones', 'licitaciones_custodia'], `${entrypoint}: el perfil autorizado original no debe mutarse`);

  const invalidTrue = clientProfileForTenderUi(profile, { TENDER_PUBLIC_UI: 'true' });
  assert.deepEqual(invalidTrue.permissions, ['modulo_oportunidades', 'licitaciones_custodia'], `${entrypoint}: true no debe activar la UI`);

  const enabled = clientProfileForTenderUi(profile, { TENDER_PUBLIC_UI: 'on' });
  assert.equal(enabled, profile, `${entrypoint}: on conserva el perfil autorizado completo`);
  assert.ok(enabled.permissions.includes('licitaciones'), `${entrypoint}: on expone la capability licitaciones al frontend`);

  const unrelated = { ...profile, permissions: ['modulo_oportunidades'] };
  assert.equal(clientProfileForTenderUi(unrelated, {}), unrelated, `${entrypoint}: un perfil sin licitaciones conserva identidad`);
  assert.equal(clientProfileForTenderUi(null, {}), null, `${entrypoint}: perfil ausente se conserva`);
}

runGateContract(serverModule.clientProfileForTenderUi, 'server');
runGateContract(apiModule.clientProfileForTenderUi, 'api');

for (const relativePath of ['../server/index.js', '../api/[...path].js']) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  assert.match(source, /currentProfile:\s*clientProfileForTenderUi\(currentProfile,\s*environment\)/, `${relativePath}: bootstrap debe aplicar el gate al perfil enviado al cliente`);
}

console.log('tender public UI gate contract passed for server and api entrypoints');
