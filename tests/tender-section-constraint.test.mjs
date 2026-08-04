import assert from 'node:assert/strict';

process.env.VERCEL = '1';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';

for (const [index, backendPath] of ['../server/index.js', '../api/[...path].js'].entries()) {
  const backend = await import(`${backendPath}?section-constraint=${index}`);
  assert.equal(typeof backend.normalizeTenderPersistenceSection, 'function', `${backendPath} debe normalizar la sección antes del upsert.`);
  assert.equal(backend.normalizeTenderPersistenceSection('hacer'), 'hacer');
  assert.equal(backend.normalizeTenderPersistenceSection('revisar'), 'revisar');
  assert.equal(backend.normalizeTenderPersistenceSection('prioridad_baja'), 'prioridad_baja');
  assert.equal(backend.normalizeTenderPersistenceSection('descartar'), 'prioridad_baja', 'El valor legado no puede romper la corrida ni representar descarte automático.');
  assert.equal(backend.normalizeTenderPersistenceSection('valor_desconocido'), 'prioridad_baja', 'Una clasificación desconocida debe degradar de forma conservadora.');
  assert.equal(backend.normalizeTenderPersistenceSection(null), 'prioridad_baja', 'Una clasificación ausente debe degradar de forma conservadora.');
}

console.log('tender persistence sections respect the database constraint');
