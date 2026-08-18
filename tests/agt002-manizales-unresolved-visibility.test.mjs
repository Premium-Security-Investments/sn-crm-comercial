import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  deriveAgt002ManizalesManifestScope,
  deriveAgt002ManizalesUnresolvedManifestEntries,
} from '../agt002-manizales-manifest-wiring.js';
import { AGT002_MANIZALES_CHECKED_IN_MANIFEST } from '../agt002-manizales-manifest-source.js';
import { presentCurrentTenderAnalysis } from '../tender-analysis-foundation.js';

// AGT-002 V3 visibility defect: the canonical Manizales SA-24-2026 manifest_scope carries 25
// atomized entries, 20 analyzable and 5 unresolved_visible — but nothing surfaced the identities
// of the 5 to a human. This suite pins the deterministic, fail-closed derivation of those 5
// entries and its wiring into the read-side presentation, WITHOUT touching the engine's
// analyzable selection, the canonical run, or persistence.

const MANIZALES_MANIFEST_SOURCE = JSON.parse(
  readFileSync(new URL('../data/agt002/manizales-sa-24-2026.integral-manifest.v1.json', import.meta.url), 'utf8'),
);

const analyzableIds = MANIZALES_MANIFEST_SOURCE.entries
  .filter(entry => entry.analyzable === true)
  .map(entry => entry.requirement_id);

const EXPECTED_UNRESOLVED_REQUIREMENT_IDS = [
  'financial-working-capital',
  'legal-rce-policy',
  'legal-collective-life-policy',
  'technical-video-surveillance-scope',
  'lifecycle:cierre-prorroga',
];

// ---------------------------------------------------------------------------
// Pure derivation: exactly the 5 unresolved_visible entries, closed shape, manifest order.
// ---------------------------------------------------------------------------
test('deriveAgt002ManizalesUnresolvedManifestEntries derives exactly the 5 unresolved_visible entries in manifest order', () => {
  const entries = deriveAgt002ManizalesUnresolvedManifestEntries(MANIZALES_MANIFEST_SOURCE);

  assert.equal(entries.length, 5);
  assert.deepEqual(entries.map(entry => entry.requirement_id), EXPECTED_UNRESOLVED_REQUIREMENT_IDS);

  // Never overlaps the 20 analyzable ids the engine consumes.
  for (const entry of entries) {
    assert.equal(analyzableIds.includes(entry.requirement_id), false, `${entry.requirement_id} must not be analyzable`);
  }

  for (const entry of entries) {
    assert.deepEqual(Object.keys(entry).sort(), ['category', 'human_review_required', 'label', 'origin', 'requirement_id', 'status']);
    assert.equal(entry.status, 'unresolved_visible');
    assert.equal(entry.human_review_required, true);
    assert.equal(typeof entry.requirement_id, 'string');
    assert.equal(typeof entry.label, 'string');
    assert.ok(entry.label.trim().length > 0, 'label must be a non-empty governed human label');
    assert.equal(typeof entry.origin, 'string');
    assert.ok(entry.category === null || typeof entry.category === 'string');
  }

  // The lifecycle gate carries no category (governance abstention); the 4 governed-runtime
  // entries carry the manifest's own governed category.
  const byId = new Map(entries.map(entry => [entry.requirement_id, entry]));
  assert.equal(byId.get('lifecycle:cierre-prorroga').category, null);
  assert.equal(byId.get('lifecycle:cierre-prorroga').origin, 'lifecycle_gate');
  assert.equal(byId.get('financial-working-capital').category, 'habilitating');
  assert.equal(byId.get('legal-rce-policy').category, 'habilitating');
  assert.equal(byId.get('legal-collective-life-policy').category, 'habilitating');
  assert.equal(byId.get('technical-video-surveillance-scope').category, 'technical');
  for (const id of ['financial-working-capital', 'legal-rce-policy', 'legal-collective-life-policy', 'technical-video-surveillance-scope']) {
    assert.equal(byId.get(id).origin, 'governed_runtime');
  }

  // No raw citation text/quotes/source refs ever leak into the closed presentation shape —
  // only the governed human label, never the manifest's raw excerpt or provenance fields.
  const serialized = JSON.stringify(entries);
  assert.doesNotMatch(serialized, /char_start|char_end|quote|citations|source_refs|is_vigente|precedence/i);

  // Deterministic and idempotent against the frozen, already-validated checked-in manifest.
  assert.deepEqual(entries, deriveAgt002ManizalesUnresolvedManifestEntries(AGT002_MANIZALES_CHECKED_IN_MANIFEST));
});

test('deriveAgt002ManizalesUnresolvedManifestEntries fails closed on a non-pilot / malformed source', () => {
  assert.throws(() => deriveAgt002ManizalesUnresolvedManifestEntries({ ...MANIZALES_MANIFEST_SOURCE, opportunity_id: '00000000-0000-4000-8000-000000000000' }), /manifiesto integral|Manizales|piloto/i);
  assert.throws(() => deriveAgt002ManizalesUnresolvedManifestEntries({ artifact_type: 'not-the-manifest' }), /manifiesto integral|Manizales|piloto/i);
});

// ---------------------------------------------------------------------------
// presentCurrentTenderAnalysis: read-side enrichment, gated on the exact pilot scope AND an
// integral_analysis aligned with the 20 analyzable ids — never a generic addition.
// ---------------------------------------------------------------------------
const PILOT_SCOPE = deriveAgt002ManizalesManifestScope(MANIZALES_MANIFEST_SOURCE);
const EXPECTED_UNRESOLVED_ENTRIES = deriveAgt002ManizalesUnresolvedManifestEntries(MANIZALES_MANIFEST_SOURCE);

function baseCurrentAnalysis(resultOverrides = {}) {
  return {
    run_id: 'run-1', snapshot_id: 'snap-1', producer: 'AGT-002', method: 'agent_ai', status: 'completed',
    current: true, critical_open_count: 0, created_at: '2026-08-17T10:00:00.000Z', completed_at: '2026-08-17T10:05:00.000Z',
    result: {
      integral_analysis: { coverage: { analyzed_requirement_ids: analyzableIds } },
      manifest_scope: PILOT_SCOPE,
      ...resultOverrides,
    },
  };
}

test('presentCurrentTenderAnalysis attaches manifest_unresolved_entries for the exact Manizales pilot scope', () => {
  const presented = presentCurrentTenderAnalysis(baseCurrentAnalysis());
  assert.deepEqual(presented.manifest_unresolved_entries, EXPECTED_UNRESOLVED_ENTRIES);
});

test('presentCurrentTenderAnalysis never attaches manifest_unresolved_entries when manifest_scope is absent (legacy/rules run)', () => {
  const currentAnalysis = baseCurrentAnalysis();
  delete currentAnalysis.result.manifest_scope;
  const presented = presentCurrentTenderAnalysis(currentAnalysis);
  assert.equal(Object.hasOwn(presented, 'manifest_unresolved_entries'), false);
});

test('presentCurrentTenderAnalysis never attaches manifest_unresolved_entries for a foreign/mismatched manifest_scope', () => {
  const foreignScope = { ...PILOT_SCOPE, analyzable_requirement_ids: PILOT_SCOPE.analyzable_requirement_ids.slice(0, 4), atomized_entry_count: 4 };
  const presented = presentCurrentTenderAnalysis(baseCurrentAnalysis({ manifest_scope: foreignScope }));
  assert.equal(Object.hasOwn(presented, 'manifest_unresolved_entries'), false);
});

test('presentCurrentTenderAnalysis never attaches manifest_unresolved_entries when integral_analysis is not aligned with the 20 analyzable ids', () => {
  const presented = presentCurrentTenderAnalysis(baseCurrentAnalysis({
    integral_analysis: { coverage: { analyzed_requirement_ids: analyzableIds.slice(0, 4) } },
  }));
  assert.equal(Object.hasOwn(presented, 'manifest_unresolved_entries'), false);
});

test('presentCurrentTenderAnalysis strips a forged manifest_unresolved_entries and never trusts result JSON for it', () => {
  const forged = [{ requirement_id: 'forged', label: 'forged', category: null, origin: 'forged', status: 'unresolved_visible', human_review_required: true }];

  const mismatched = baseCurrentAnalysis();
  delete mismatched.result.manifest_scope;
  mismatched.result.manifest_unresolved_entries = forged;
  const presentedMismatched = presentCurrentTenderAnalysis(mismatched);
  assert.equal(Object.hasOwn(presentedMismatched, 'manifest_unresolved_entries'), false);

  const matched = baseCurrentAnalysis({ manifest_unresolved_entries: forged });
  const presentedMatched = presentCurrentTenderAnalysis(matched);
  assert.deepEqual(presentedMatched.manifest_unresolved_entries, EXPECTED_UNRESOLVED_ENTRIES);
});

test('presentCurrentTenderAnalysis never mutates currentAnalysis.result', () => {
  const currentAnalysis = baseCurrentAnalysis();
  Object.freeze(currentAnalysis.result);
  Object.freeze(currentAnalysis);
  const presented = presentCurrentTenderAnalysis(currentAnalysis);
  assert.notEqual(presented, currentAnalysis.result);
  assert.equal(Object.hasOwn(currentAnalysis.result, 'manifest_unresolved_entries'), false);
  assert.deepEqual(presented.manifest_unresolved_entries, EXPECTED_UNRESOLVED_ENTRIES);
});

// ---------------------------------------------------------------------------
// Static: the optional type lands on TenderDocumentAnalysis, closed shape.
// ---------------------------------------------------------------------------
test('the optional manifest_unresolved_entries type exists and is carried by TenderDocumentAnalysis', () => {
  const types = readFileSync(new URL('../src/tenders/types.ts', import.meta.url), 'utf8');
  assert.match(types, /export type TenderManifestUnresolvedEntry = \{/);
  for (const field of ['requirement_id', 'label', 'category', 'origin', 'status', 'human_review_required']) {
    const entryType = types.slice(types.indexOf('export type TenderManifestUnresolvedEntry'), types.indexOf('export type TenderDocumentAnalysis'));
    assert.match(entryType, new RegExp(field), `TenderManifestUnresolvedEntry must carry ${field}`);
  }
  const docAnalysis = types.slice(types.indexOf('export type TenderDocumentAnalysis'));
  assert.match(docAnalysis, /manifest_unresolved_entries\?:\s*TenderManifestUnresolvedEntry\[\]\s*\|\s*null/, 'TenderDocumentAnalysis must carry the optional manifest_unresolved_entries');
});

// ---------------------------------------------------------------------------
// Static: the V3 view renders a compact, accessible "Pendientes sin evidencia suficiente"
// section, separate from the 20 analyzed units and never inside the workbench unit rail.
// ---------------------------------------------------------------------------
test('the V3 view renders the unresolved-visible manifest entries in a distinct accessible section', () => {
  const view = readFileSync(new URL('../src/tenders/components/TenderIntegralAnalysisV3View.tsx', import.meta.url), 'utf8');

  assert.match(view, /analysis\?\.manifest_unresolved_entries/, 'must read analysis.manifest_unresolved_entries off the real prop');
  assert.match(view, /Pendientes sin evidencia suficiente/);
  assert.match(view, /aria-labelledby/);
  assert.match(view, /entry\.requirement_id/);
  assert.match(view, /entry\.label/);
  assert.match(view, /entry\.category/);
  assert.match(view, /revisi[oó]n humana/i);

  // Must be rendered outside/before the 20-unit workbench — never inside the unit rail or the
  // existing human question/answer flow (which lives in a different component entirely).
  const unresolvedIndex = view.indexOf('Pendientes sin evidencia suficiente');
  const workbenchIndex = view.indexOf('agt002-v3-workbench');
  assert.ok(unresolvedIndex > 0, 'unresolved section must exist');
  assert.ok(unresolvedIndex < workbenchIndex, 'unresolved section must be rendered separately from the 20-unit workbench');
});

test('the V3 view CSS has a responsive rule for the unresolved-visible section', () => {
  const css = readFileSync(new URL('../src/tenders/components/tender-integral-analysis-v3.css', import.meta.url), 'utf8');
  assert.match(css, /agt002-v3-unresolved/);
  assert.match(css, /@media\(max-width:720px\)[\s\S]*agt002-v3-unresolved/, 'the unresolved section must be covered by the narrow responsive breakpoint');
});
