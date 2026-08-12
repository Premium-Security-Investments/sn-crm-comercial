import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// AGT-002 integral v3 (F1/F2 follow-up, gate from CURRENT.md §2.1 "Gate siguiente" #1):
// the last missing piece before any real case can be attempted is real, read-only DB
// wiring of the two governed maps createAgt002PreviewRuntime already accepts
// (companyEvidenceRegistryEntries, categoryOverrides, evidenceClassLinkByRequirementId)
// into both production backends. This mirrors the exact static-source contract already
// proven for the legal corpus (tests/agt002-legal-corpus-server-wiring.test.mjs): no unit
// test can observe server/index.js's inline route handlers directly, so the contract is
// verified as source text, counted once per canonical flow.
// ---------------------------------------------------------------------------

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../agt002-preview-runtime.js', import.meta.url), 'utf8');

function count(source, token) {
  return source.split(token).length - 1;
}

assert.equal(server, api, 'server/index.js y api/[...path].js deben permanecer byte-idénticos');

assert.match(server, /import \{ loadAgt002CompanyEvidenceRegistryEntries \} from '\.\.\/agt002-company-evidence-classes\.js';/);
assert.match(server, /import \{ loadAgt002IntegralGovernanceOverrides \} from '\.\.\/agt002-integral-governance-overrides\.js';/);

// A single shared, fail-closed-by-default loader (mirrors loadAgt002LegalCorpusContextIfEnabled):
// returns null when the flag is off (no DB round-trip), and the real two maps + registry
// rows, scoped to the opportunity, only when AGT002_INTEGRAL_CONTRACT_V3 is on.
assert.match(server, /async function loadAgt002IntegralV3GovernanceIfEnabled\(database, opportunityId\)/);
assert.match(server, /if \(!agt002AnalysisConfig\.AGT002_INTEGRAL_CONTRACT_V3\) return null;/);
assert.match(server, /loadAgt002CompanyEvidenceRegistryEntries\(database\)/);
assert.match(server, /loadAgt002IntegralGovernanceOverrides\(database, opportunityId\)/);

// All three canonical flows (reanalysis after human answer, worker-triggered auto
// analysis, manual agent-preview endpoint) must call the same shared loader before
// constructing the runtime, and forward every field the runtime requires.
assert.equal(count(server, 'await loadAgt002IntegralV3GovernanceIfEnabled(database, opportunityId)'), 3, 'los tres flujos canónicos deben cargar la gobernanza v3 antes de construir el runtime');
assert.equal(count(server, 'companyEvidenceRegistryEntries: integralV3Governance.companyEvidenceRegistryEntries,'), 3, 'los tres runtimes deben recibir el registro real de evidencia empresarial');
assert.equal(count(server, 'categoryOverrides: integralV3Governance.categoryOverrides,'), 3, 'los tres runtimes deben recibir las anulaciones de categoría curadas');
assert.equal(count(server, 'evidenceClassLinkByRequirementId: integralV3Governance.evidenceClassLinkByRequirementId,'), 3, 'los tres runtimes deben recibir el enlace requisito -> clase de evidencia curado');
// P2-1: la procedencia gobernada (clase, rationale, versión) detrás de esas dos anulaciones
// debe llegar al runtime exactamente igual — sin ella el run persistido no puede citar
// binding/versionado/procedencia de lo que aplicó.
assert.match(server, /governanceProvenance: governanceOverrides\.provenance,/, 'el loader compartido debe exponer la procedencia gobernada junto a los dos mapas');
assert.equal(count(server, 'governanceProvenance: integralV3Governance.governanceProvenance,'), 3, 'los tres runtimes deben recibir la procedencia gobernada de las anulaciones curadas');
assert.equal(count(server, 'contextVersionId: contextVersion?.id ?? null,'), 3, 'los tres runtimes deben poder trazar la versión de contexto que consumieron');

// The runtime itself must remain DB-free: only the server layer may query Supabase,
// exactly like the legal corpus wiring already enforces.
assert.doesNotMatch(runtime, /createClient\(|\.from\(['"]psi_agt002/, 'runtime v3 no puede leer la base de datos directamente');

console.log('AGT-002 integral v3 server wiring contract (governed evidence + overrides, read-only, fail-closed) passed');
