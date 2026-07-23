import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const actionsPath = new URL('../src/tenders/tenderConfigurationActions.ts', import.meta.url);
const bundle = buildSync({ entryPoints: [actionsPath.pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const actionsUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const { createTenderConfigurationActions } = await import(actionsUrl);

const writes = [];
const request = async (path, options) => {
  writes.push({ path, method: options?.method });
  return { legal_name: 'No debe importar' };
};
const uploadToSignedUrl = async () => {
  writes.push({ path: 'storage', method: 'POST' });
  return { error: null };
};
const file = { name: 'rup.pdf', type: 'application/pdf', size: 1024 };

const readonly = createTenderConfigurationActions({ canConfigure: false, request, uploadToSignedUrl });
assert.equal(await readonly.saveCompany({ legal_name: 'Lectura' }), null, 'save read-only termina antes del request PUT');
assert.equal(await readonly.uploadRup(file), null, 'upload read-only termina antes de pedir URL o storage');
assert.deepEqual(writes, [], 'acciones de URL histórica read-only no emiten escrituras');

const writable = createTenderConfigurationActions({ canConfigure: true, request, uploadToSignedUrl });
await writable.saveCompany({ legal_name: 'Editable' });
assert.deepEqual(writes, [{ path: '/api/tender-company-profile', method: 'PUT' }], 'acción permitida conserva el PUT real');

console.log('Tender configuration read-only mutation actions regression passed');
