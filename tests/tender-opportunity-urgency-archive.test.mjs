import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../supabase/migrations/124_tender_opportunity_archive.sql', import.meta.url), 'utf8');
const view = fs.readFileSync(new URL('../src/tenders/TenderOpportunitiesView.tsx', import.meta.url), 'utf8');
const rpc = fs.readFileSync(new URL('../verticales/licitaciones/tender-offer-archive-rpc.js', import.meta.url), 'utf8');
const stage = fs.readFileSync(new URL('../verticales/licitaciones/tender-opportunity-stage.js', import.meta.url), 'utf8');

test('las oportunidades convertidas se ordenan por cierre y las archivadas salen del activo', () => {
  assert.match(migration, /order by o\.expected_close_date asc nulls last/i);
  assert.match(migration, /p_filter = 'archivadas'/i);
  assert.match(migration, /o\.archived_at is null/i);
  assert.match(migration, /o\.archived_at is not null/i);
  assert.match(view, /sortTenderOpportunitySummaries/);
  assert.match(view, /'Ver archivadas'/);
});

test('archivar conserva trazabilidad y exige estado previo a presentar', () => {
  assert.match(migration, /archived_at/);
  assert.match(migration, /archive_note/);
  assert.match(migration, /psi_tender_opportunity_archive_events/);
  assert.match(migration, /en_preparacion.*lista_para_presentar/s);
  assert.match(rpc, /LICITACIONES_GO_NO_GO_APPROVE/);
  assert.match(rpc, /Debe indicar por qué no nos presentamos/);
  assert.match(view, /: 'Archivar'\}/, 'el botón dice solo Archivar; el motivo se pide al hacer clic (Juan, 2026-10-13)');
  assert.match(view, /window\.confirm/);
  assert.match(view, /window\.prompt/);
  assert.match(stage, /opportunity_archived/);
});
