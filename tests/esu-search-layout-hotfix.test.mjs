import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchEsuProcesses } from '../esu-direct-crawl.js';

// Fake /procesos/view/<id> hrefs on a host outside ESU_FETCH_POLICY's allowlist: safeOfficialFetch
// rejects the host synchronously (no DNS/socket ever opens), yet the id keeps fetchEsuProcesses'
// internal seen-row lookup (keyed by parseEsuProcessId) working so detail enrichment resolves to
// null instead of crashing on an undefined source row.
const INDEX_ROW = {
  url: 'https://example.invalid/procesos/view/9990001',
  cells: ['1', 'IDX-2099-001', 'Servicio de vigilancia física en sede administrativa', 'Selección abreviada', '2099-01-15', '2099-03-20', 'Convocado', 'Juan Pérez', 'Ver'],
};

const SEARCH_ROW = {
  url: 'https://example.invalid/procesos/view/9990002',
  cells: ['1', 'SRCH-2099-002', 'Servicio de vigilancia y seguridad privada en instalaciones', '2099-02-01T00:00:00', '2099-04-15T00:00:00', 'Convocado', '92121700 - Servicios de vigilancia y seguridad privada', 'Vigilancia física, Seguridad electrónica', '', 'Ver'],
};

test('9-cell index-page rows keep type/date/date/status/functionary mapped correctly', async () => {
  const tenders = await fetchEsuProcesses({
    fetchIndexPages: async () => [INDEX_ROW],
    searchProcesses: async () => [],
  });
  const tender = tenders.find(t => t.ref === 'IDX-2099-001');
  assert.ok(tender, 'index row should survive fetchEsuProcesses');
  assert.equal(tender.category, 'Selección abreviada');
  assert.equal(tender.published, '2099-01-15');
  assert.equal(tender.deadline, '2099-03-20');
  assert.equal(tender.status, 'Convocado');
  assert.equal(tender.raw.funcionario, 'Juan Pérez');
});

test('10-cell /procesos/buscar rows map published/deadline/status without UNSPSC shift', async () => {
  const tenders = await fetchEsuProcesses({
    fetchIndexPages: async () => [],
    searchProcesses: async () => [SEARCH_ROW],
  });
  const tender = tenders.find(t => t.ref === 'SRCH-2099-002');
  assert.ok(tender, 'search row should survive fetchEsuProcesses');
  assert.equal(tender.published, '2099-02-01T00:00:00');
  assert.equal(tender.deadline, '2099-04-15T00:00:00');
  assert.equal(tender.status, 'Convocado');
  assert.ok(!String(tender.status).includes('92121700'), 'status must not contain the UNSPSC code from the search layout');
});
