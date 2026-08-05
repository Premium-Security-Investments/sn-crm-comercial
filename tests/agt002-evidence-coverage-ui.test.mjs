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

// --- Component: one non-expandable compact strip, gated on a validated evidence_coverage. ---
assert.match(analysis, /function\s+\w*EvidenceCoverage\w*\s*\(/, 'Debe existir un componente/función dedicada a la franja de cobertura de evidencia.');
assert.match(analysis, /evidence_coverage/, 'El componente debe leer analysis.evidence_coverage.');
assert.match(analysis, /tender-evidence-coverage-strip/);
assert.match(analysis, /referencias utilizadas/i);
assert.match(analysis, /requisitos con evidencia/i);
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

// Panel is compact and gated: no giant unconditional render, no strip without coverage.
assert.match(analysis, /analysis\?\.evidence_coverage|analysis\.evidence_coverage/, 'El render de la franja debe estar condicionado a que exista evidence_coverage.');

// Never expose raw chunk text/hashes or the full coverage payload.
assert.doesNotMatch(analysis, /chunk\.text|chunk_hash|content_hash/, 'La franja no debe exponer texto de chunk ni hashes.');
assert.doesNotMatch(analysis, /JSON\.stringify\(\s*(?:analysis\??\.)?evidence_coverage/, 'La franja no debe serializar evidence_coverage completo en pantalla.');

// Preserve human authority: no GO/NO-GO or approval language introduced by this panel.
assert.doesNotMatch(analysis, /Aprobar cobertura|Autorizar cobertura|GO\s*\/\s*NO[- ]?GO.*cobertura|cobertura.*GO\s*\/\s*NO[- ]?GO/i, 'La franja de cobertura no debe introducir autorización GO/NO GO.');

// Dedicated compact, responsive styling exists; no leftover accordion rules.
assert.match(styles, /\.tender-evidence-coverage-strip/, 'Debe existir estilo compacto dedicado para la franja de cobertura.');
assert.match(styles, /\.tender-evidence-coverage-strip\{[^}]*flex-wrap:wrap/, 'La franja debe envolver métricas sin overflow.');
assert.match(styles, /@media\(max-width:700px\)\{\.tender-evidence-coverage-strip/, 'Debe existir ajuste responsive explícito.');
assert.doesNotMatch(styles, /\.tender-evidence-coverage-omissions|\.tender-evidence-coverage-list|\.tender-evidence-coverage-wrapper|\.tender-evidence-coverage-metrics/, 'No deben quedar reglas de acordeón/listas obsoletas.');

console.log('agt002 evidence coverage UI checks passed');
