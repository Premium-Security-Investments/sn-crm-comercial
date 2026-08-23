import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const analysisPath = new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url);
const typesPath = new URL('../src/tenders/types.ts', import.meta.url);
const stylesPath = new URL('../src/styles.css', import.meta.url);
const mainPath = new URL('../src/main.tsx', import.meta.url);
const analysis = readFileSync(analysisPath, 'utf8');
const types = readFileSync(typesPath, 'utf8');
const styles = readFileSync(stylesPath, 'utf8');
const main = readFileSync(mainPath, 'utf8');

// --- Types: the real Task 27 contract must be typed, not left as `unknown`. ---
assert.match(types, /evidence_coverage\?:\s*TenderEvidenceCoverage\s*\|\s*null/, 'TenderDocumentAnalysis debe tipar evidence_coverage con el contrato real.');
assert.match(types, /material_omissions:\s*boolean/, 'El tipo debe incluir material_omissions.');
assert.match(types, /coverage_manifest/, 'El tipo debe incluir coverage_manifest.');
assert.match(types, /selected_chunks/, 'El tipo debe incluir selected_chunks.');
assert.match(types, /omitted_chunks/, 'El tipo debe incluir omitted_chunks.');
assert.match(types, /citation_allowlist/, 'El tipo debe incluir citation_allowlist.');
assert.doesNotMatch(types, /selected_chunks:\s*\{[^}]*text/s, 'selected_chunks nunca debe tipar un campo text (no debe persistir/mostrar texto de chunk).');

// --- Component: the evidence coverage strip must no longer render in the operative view. ---
assert.doesNotMatch(analysis, /<EvidenceCoverageStrip/, 'EvidenceCoverageStrip no debe renderizarse en la vista operativa de TenderAnalysisSection.');
assert.doesNotMatch(analysis, /referencias utilizadas/i, 'El texto "referencias utilizadas" no debe mostrarse en la vista operativa.');
assert.doesNotMatch(analysis, /requisitos con evidencia/i, 'El texto "requisitos con evidencia" no debe mostrarse en la vista operativa.');
assert.doesNotMatch(analysis, /<details[^>]*tender-evidence-coverage/);
assert.doesNotMatch(analysis, /Omitidos/);
assert.doesNotMatch(analysis, /omitted_chunks\.map|selected_chunks\.map/);
const opportunityDetail = main.slice(main.indexOf('function OpportunityDetail'), main.indexOf('const tenderDocumentTypeOptions'));
assert.doesNotMatch(opportunityDetail, /Detalles técnicos y auditoría/);
assert.doesNotMatch(opportunityDetail, /<Info\s+label=["'](?:Snapshot|Productor|Estado técnico)["']/, 'Los metadatos técnicos no deben renderizarse en el resumen.');
for (const hidden of ['Cómo funciona', 'Citas de evidencia']) {
  assert.ok(!analysis.includes(hidden) && !opportunityDetail.includes(hidden), `${hidden} no debe mostrarse en la vista operativa`);
}
assert.match(analysis, /No registra ni autoriza GO \/ NO GO/, 'Debe conservar una sola advertencia concisa de autoridad humana.');

// Coverage remains part of the typed analysis payload. The operative view may read only the
// server-validated tender inventory summary to render the fail-closed pause; it must never render
// raw chunks, omissions, hashes or the full coverage payload.
assert.match(analysis, /evidence_coverage\?\.tender_requirement_inventory/);
assert.doesNotMatch(analysis, /selected_chunks|omitted_chunks|citation_allowlist|coverage_manifest/);

// Never expose raw chunk text/hashes or the full coverage payload.
assert.doesNotMatch(analysis, /chunk\.text|chunk_hash|content_hash/, 'La franja no debe exponer texto de chunk ni hashes.');
assert.doesNotMatch(analysis, /JSON\.stringify\(\s*(?:analysis\??\.)?evidence_coverage/, 'La franja no debe serializar evidence_coverage completo en pantalla.');

// No obsolete presentation styles should remain after removing the panel.
assert.doesNotMatch(styles, /\.tender-evidence-coverage-(?:strip|omissions|list|wrapper|metrics)/, 'No deben quedar estilos obsoletos de cobertura de evidencia.');

console.log('agt002 evidence coverage UI checks passed');
