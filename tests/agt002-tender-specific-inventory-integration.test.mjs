import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildAgt002PreviewInput } from '../agt002-preview-input.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';
import {
  computeAgt002PreviewIdempotencyKey,
  validateAgt002TenderRequirementInventoryCoverage,
} from '../agt002-preview-persistence.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const contextV2Sections = {
  ...buildAgt002OpportunityContextV2({
    opportunity: { id: 'opp-specific', owner_id: 'owner', owner_name: 'Ana', updated_at: '2026-08-23T00:00:00.000Z' },
    tender: { id: 'tender-specific', title: 'Proceso específico', entity: 'Entidad', source: 'SECOP II', updated_at: '2026-08-23T00:00:00.000Z' },
  }),
  company_dossier: buildAgt002CompanyDossier({ profile: { legal_name: 'Seguridad Nacional', updated_at: '2026-08-23T00:00:00.000Z' }, documents: [] }),
};

function previewInputFor(text) {
  return buildAgt002PreviewInput({
    snapshotId: '99999999-9999-4999-8999-999999999999',
    contextV2: true,
    documentRetrieval: true,
    contextV2Sections,
    documents: [{
      document_id: 'doc-specific', document_version_id: `ver-${hash(text).slice(0, 8)}`,
      opportunity_id: 'opp-specific', snapshot_id: null, version: 1,
      content_hash: hash(text), extracted_text: text, current: true, document_type: 'pliego', name: 'Pliego.pdf',
    }],
    deepAnalysis: {
      matrix: {
        legal: [{ id: 'legacy-fixed', label: 'Señal histórica', evidence: [{ document_id: 'doc-specific', excerpt: 'señal' }] }],
        financial: [], technical: [],
      },
    },
  });
}

// The server-owned preview packet carries the inventory alongside legacy retrieval, but the latter never defines its frontier.
{
  const input = previewInputFor('Se exige certificación de operación remota para la sede insular.');
  const inventory = input.document_evidence.tender_requirement_inventory;
  assert.ok(inventory);
  assert.equal(inventory.inventory_version, 'tender_requirement_inventory.v1');
  assert.equal(inventory.requirements.length, 1);
  assert.equal(inventory.requirements[0].supplemental_signal_ids.length, 0);
  assert.equal(inventory.analyzed_coverage.status, 'incomplete');
  assert.equal(inventory.decision_ready, false);
  assert.equal(inventory.recommendation, 'pause');
  assert.equal(inventory.human_review_required, true);
  assert.ok(Object.isFrozen(input) === false, 'packet remains a normal serialization payload while worker freeze happens at job boundary');
}

// Extraction gaps are part of the authoritative inventory. An illegible current document may
// not simultaneously appear as analyzable content or let expediente coverage become complete.
{
  const input = previewInputFor('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  const inventory = input.document_evidence.tender_requirement_inventory;
  assert.equal(inventory.expedient_coverage.status, 'partial');
  assert.equal(inventory.coverage_ledger.analyzable_count, 0);
  assert.equal(inventory.coverage_ledger.unresolved_visible_count, 1);
  assert.equal(inventory.requirements.length, 0);
  assert.equal(inventory.source_units[0].reason, 'illegible_document');
}

// The inventory identity is part of idempotency. An addendum/document hash change cannot reuse the prior run key.
{
  const before = previewInputFor('El plazo es de doce meses.');
  const after = previewInputFor('Adenda: el plazo es de dieciocho meses.');
  const common = { snapshotId: before.snapshot_id, policyVersion: 'policy', model: 'model' };
  const beforeKey = computeAgt002PreviewIdempotencyKey({ ...common, inventoryVersion: before.document_evidence.tender_requirement_inventory.inventory_version, inventoryHash: before.document_evidence.tender_requirement_inventory.inventory_hash, snapshotHash: before.document_evidence.tender_requirement_inventory.snapshot_hash });
  const afterKey = computeAgt002PreviewIdempotencyKey({ ...common, inventoryVersion: after.document_evidence.tender_requirement_inventory.inventory_version, inventoryHash: after.document_evidence.tender_requirement_inventory.inventory_hash, snapshotHash: after.document_evidence.tender_requirement_inventory.snapshot_hash });
  assert.notEqual(beforeKey, afterKey);
}

// Persistence revalidates inventory coverage and rejects a forged citation/hash before any RPC.
{
  const inventory = structuredClone(previewInputFor('Se exige plan de contingencia documental.').document_evidence.tender_requirement_inventory);
  inventory.requirements[0].citations[0].unit_hash = hash('forged');
  assert.throws(() => validateAgt002TenderRequirementInventoryCoverage(inventory), /cita|hash|inventario/i);
}

// Every executable entrypoint binds inventory identity before reserving, gates that binding on
// the exact AGT002_DOCUMENT_RETRIEVAL signal, and enforces the reserved identity at persistence.
for (const relativePath of ['../api/[...path].js', '../server/index.js']) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /documentGaps:\s*\[\]/, `${relativePath} must never erase durable/extraction gaps at an inventory boundary`);
  assert.match(source, /import \{ loadAgt002TenderRequirementDocumentGaps \} from '\.\.\/agt002-tender-requirement-gaps\.js';/);
  const claimIndexes = [...source.matchAll(/await claimAgt002PreviewRun\(/g)].map(match => match.index);
  assert.equal(claimIndexes.length, 2, `${relativePath} must keep both direct AGT-002 claim paths covered`);
  for (const claimIndex of claimIndexes) {
    const preClaim = source.slice(Math.max(0, claimIndex - 2_400), claimIndex);
    assert.match(preClaim, /tenderRequirementInventoryIdentity\(buildAgt002TenderRequirementInventory\(/);
    assert.match(preClaim, /\.\.\.inventoryIdentity/);
    // Retrieval off => no evidence_coverage in the envelope => the reservation must stay
    // inventory-free, or claim-vs-persist identity can never agree again.
    assert.match(preClaim, /const documentRetrieval = agt002AnalysisConfig\.AGT002_DOCUMENT_RETRIEVAL === true;/);
    assert.match(preClaim, /const inventoryIdentity = documentRetrieval\s*\n?\s*\? tenderRequirementInventoryIdentity\(/);
    // Blocker: retrieval off must also skip the strict retrieval-shaped document adapter —
    // forcing every document through it regardless of the signal would reject legitimate
    // non-retrieval documents before the provider is ever called, breaking supported
    // non-retrieval behavior.
    assert.match(preClaim, /const analysisDocuments = documentRetrieval\s*\n?\s*\? adaptAgt002RetrievalDocuments\(/);
  }
  const enqueueStart = source.indexOf('async function enqueueAgt002CanonicalReanalysis');
  const enqueueEnd = source.indexOf('const integralV3Governance', enqueueStart);
  const enqueuePreamble = source.slice(enqueueStart, enqueueEnd);
  assert.match(enqueuePreamble, /const documentRetrieval = agt002AnalysisConfig\.AGT002_DOCUMENT_RETRIEVAL === true;/);
  assert.match(enqueuePreamble, /const inventoryIdentity = documentRetrieval\s*\n?\s*\? tenderRequirementInventoryIdentity\(buildAgt002TenderRequirementInventory\(/);
  assert.match(enqueuePreamble, /\.\.\.inventoryIdentity/);

  // The requirement at the persistence boundary is the SAME signal, never a hardcoded true:
  // a hardcoded true rejects every legitimate retrieval-off run before any RPC.
  const directRegistrations = source.match(/registerAgt002PreviewAnalysis\(database, \{[^\n]+\}\)/g) ?? [];
  assert.equal(directRegistrations.length, 2, `${relativePath} must guard both direct persistence paths`);
  for (const registration of directRegistrations) {
    assert.match(registration, /requireTenderRequirementInventory: documentRetrieval/, `${relativePath} must gate the inventory requirement on the retrieval signal`);
    // Blocker 5: claim -> persist identity enforcement is never dropped from a production path.
    assert.match(registration, /expectedIdempotencyKey: idempotencyKey/, `${relativePath} must enforce the reserved identity at persistence`);
  }
  assert.doesNotMatch(source, /requireTenderRequirementInventory: true/, `${relativePath} must not hardcode the inventory requirement`);
}

// The durable worker path derives the same gate from its own frozen, governed flags, and keeps
// enforcing the reserved identity it was enqueued with.
{
  const executorSource = readFileSync(new URL('../agt002-reanalysis-executor.js', import.meta.url), 'utf8');
  assert.match(executorSource, /expectedIdempotencyKey: job\.idempotencyKey/);
  assert.match(executorSource, /requireTenderRequirementInventory: input\.analysis_flags\.AGT002_DOCUMENT_RETRIEVAL === true/);
}

// UI: a V3 payload without a verifiable inventory, or with an inventory present but not
// `decision_ready: true`, is paused traceability, never integral coverage. The gate requires
// BOTH presence of the governed inventory AND `decision_ready === true`. The P0 contract pins
// that flag to false on every real run today (segmentation is not semantic analysis yet), so
// this deliberately keeps every current production run paused until a later server-side
// analyzer marks a snapshot's inventory ready — that is the fail-closed contract, not a defect.
{
  const analysisSectionSource = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');
  assert.match(analysisSectionSource, /const inventoryPaused = hasIntegralV3Payload && !tenderRequirementInventoryReady\(tenderInventory\)/);
  assert.match(analysisSectionSource, /Análisis integral pausado/);
  assert.match(analysisSectionSource, /!hasIntegralV3Payload && analysis/);

  const technicalViewSource = readFileSync(new URL('../src/tenders/components/TenderIntegralAnalysisV3View.tsx', import.meta.url), 'utf8');
  assert.match(technicalViewSource, /if \(!tenderRequirementInventoryReady\(inventory\)\)/);
  assert.match(technicalViewSource, /Cobertura integral no disponible/);
  // El aviso de pausa antecede a TODA derivación de cobertura (resumen, fases, unidades): sin
  // inventario listo, ninguna lectura integral puede rendirse.
  for (const derivation of ['tenderIntegralAnalysisSummary(integral)', 'tenderIntegralPhaseGroups(integral)', 'agt002-v3-workbench']) {
    assert.ok(
      technicalViewSource.indexOf('if (!tenderRequirementInventoryReady(inventory))') < technicalViewSource.indexOf(derivation),
      `inventory pause must pre-empt ${derivation}`,
    );
  }
  // El consumo opcional se conserva: sin payload V3 la vista no rinde nada, ni siquiera la pausa.
  assert.ok(
    technicalViewSource.indexOf('if (!integral || !units || units.length === 0) return null;') < technicalViewSource.indexOf('if (!tenderRequirementInventoryReady(inventory))'),
    'an absent V3 payload must render nothing at all, not an inventory pause banner',
  );

  // Ambas superficies delegan el gate a la misma función pura, que sí debe leer decision_ready:
  // la presencia del inventario nunca sustituye a decision_ready === true.
  const presentationSource = readFileSync(new URL('../src/tenders/tenderIntegralAnalysisPresentation.ts', import.meta.url), 'utf8');
  assert.match(presentationSource, /export function tenderRequirementInventoryReady/);
  assert.match(presentationSource, /if \(inventory\.decision_ready !== true\) return false;/, 'el predicado de listo debe exigir decision_ready === true');
}

console.log('AGT-002 tender-specific inventory preview/persistence integration passed');
