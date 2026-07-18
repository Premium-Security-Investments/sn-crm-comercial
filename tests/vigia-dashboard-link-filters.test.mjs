import assert from 'node:assert/strict';
import { parseVigiaDashboardFilters } from '../src/vigia/dashboard-link-filters.js';

const valid = { owners: ['owner-1'], stages: ['negociacion'], services: ['seguridad_fisica'] };
assert.deepEqual(
  parseVigiaDashboardFilters('#/manager?owner=owner-1&stage=negociacion&service=seguridad_fisica&active=1', valid),
  { owner: 'owner-1', stage: 'negociacion', service: 'seguridad_fisica', onlyActive: true, invalid: false },
  'deep link válido conserva filtros gobernados',
);
for (const hash of [
  '#/manager?owner=otro',
  '#/manager?stage=etapa-inventada',
  '#/manager?service=licitacion_publica',
  '#/manager?active=0',
  '#/manager?owner=owner-1&admin=true',
]) {
  const parsed = parseVigiaDashboardFilters(hash, valid);
  assert.equal(parsed.invalid, true, `${hash} debe fallar cerrado`);
  assert.equal(parsed.owner, '__invalid_vigia_filter__', `${hash} debe producir alcance vacío`);
}
assert.deepEqual(
  parseVigiaDashboardFilters('#/manager?owner=owner-1&stage=negociacion&active=1', valid),
  { owner: 'owner-1', stage: 'negociacion', service: '', onlyActive: true, invalid: false },
  'prioridad sin servicio conserva alcance de todos los servicios y no cae al default',
);
assert.deepEqual(
  parseVigiaDashboardFilters('#/manager', valid),
  { owner: '', stage: '', service: '', onlyActive: false, invalid: false },
  'ruta sin filtros conserva vista normal',
);
console.log('vigia dashboard deep-link validation passed');
