import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const analysisPath = new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url);
const typesPath = new URL('../src/tenders/types.ts', import.meta.url);
const analysis = readFileSync(analysisPath, 'utf8');
const types = readFileSync(typesPath, 'utf8');

// --- Types: the closed Task33 contract (legal_evidence/legal_findings) must be typed. ---
assert.match(types, /legal_findings\?:/, 'TenderDocumentAnalysis debe tipar legal_findings.');
assert.match(types, /legal_evidence\?:/, 'TenderDocumentAnalysis debe tipar legal_evidence.');
assert.match(types, /'tender_requirement'/, 'El tipo de clasificación jurídica debe incluir tender_requirement.');
assert.match(types, /'legal_obligation'/, 'El tipo de clasificación jurídica debe incluir legal_obligation.');
assert.match(types, /'company_evidence'/, 'El tipo de clasificación jurídica debe incluir company_evidence.');
assert.match(types, /'inference'/, 'El tipo de clasificación jurídica debe incluir inference.');
assert.match(types, /'human_legal_review'/, 'El tipo de clasificación jurídica debe incluir human_legal_review.');
assert.match(types, /official_url/, 'El tipo de cita jurídica debe incluir official_url.');
assert.match(types, /article_or_section/, 'El tipo de cita jurídica debe incluir article_or_section.');
assert.match(types, /corpus_version/, 'El tipo de cita jurídica debe incluir corpus_version.');
assert.match(types, /verified_at/, 'El tipo de cita jurídica debe incluir verified_at.');
assert.match(types, /citation_allowlist/, 'El tipo de evidencia jurídica debe incluir citation_allowlist.');
assert.match(types, /abstention_state/, 'El tipo de evidencia jurídica debe incluir abstention_state.');

// The closed legal package remains typed and auditable, but the exhaustive panel is not part
// of the compact operative decision brief.
assert.doesNotMatch(analysis, /analysis\??\.legal_findings|analysis\??\.legal_evidence/, 'TenderAnalysisSection no debe leer el paquete jurídico para renderizarlo.');
assert.doesNotMatch(analysis, /LegalFindingsPanel|Evidencia jurídica|Fuente oficial comprobada|Fuente pendiente de comprobación|Interpretación pendiente de revisión humana|Hallazgo pendiente de validación jurídica/, 'La vista operativa no debe exponer el panel jurídico exhaustivo ni sus estados técnicos.');
assert.match(analysis, /No registra ni autoriza GO \/ NO GO/, 'El brief compacto debe conservar la autoridad humana sin repetir el panel jurídico.');

console.log('agt002 legal findings UI checks passed');
