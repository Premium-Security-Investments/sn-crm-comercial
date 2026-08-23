import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const analysisPath = new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url);
const technicalViewPath = new URL('../src/tenders/components/TenderIntegralAnalysisV3View.tsx', import.meta.url);
const presentationPath = new URL('../src/tenders/tenderIntegralAnalysisPresentation.ts', import.meta.url);
const typesPath = new URL('../src/tenders/types.ts', import.meta.url);
const stylesPath = new URL('../src/styles.css', import.meta.url);
const mainPath = new URL('../src/main.tsx', import.meta.url);
const analysis = readFileSync(analysisPath, 'utf8');
const technicalView = readFileSync(technicalViewPath, 'utf8');
const presentation = readFileSync(presentationPath, 'utf8');
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

// Coverage remains part of the typed analysis payload, but no surface reads it piecemeal any more.
// Readiness is a claim about the WHOLE evidence coverage of the run, and both the operative view
// and the V3 technical backup must delegate it to the same shared pure selector
// `tenderAnalysisCoverageReady(analysis?.evidence_coverage)`. Semantic-manifest strict precedence
// and the legacy inventory fallback live inside that selector, never in a component.
for (const [label, source] of [['TenderAnalysisSection', analysis], ['TenderIntegralAnalysisV3View', technicalView]]) {
  assert.match(source, /import \{[^}]*tenderAnalysisCoverageReady[^}]*\} from '\.\.\/tenderIntegralAnalysisPresentation'/s, `${label} debe importar el gate compartido.`);
  assert.match(source, /!tenderAnalysisCoverageReady\(analysis\?\.evidence_coverage\)/, `${label} debe gatear sobre toda la cobertura de evidencia.`);
  // Negative: ninguna superficie puede gatear por su cuenta sobre el inventario legado ni leer
  // ninguna rama de la cobertura directamente — eso reintroduciría la precedencia duplicada.
  assert.doesNotMatch(source, /tenderRequirementInventoryReady/, `${label} no puede llamar al predicado legado del inventario.`);
  assert.doesNotMatch(source, /evidence_coverage\?\.tender_requirement_inventory|evidence_coverage\.tender_requirement_inventory/, `${label} no puede leer el inventario legado directamente.`);
  assert.doesNotMatch(source, /evidence_coverage\?\.tender_semantic_manifest|evidence_coverage\.tender_semantic_manifest/, `${label} no puede leer el manifiesto semántico directamente.`);
  assert.doesNotMatch(source, /selected_chunks|omitted_chunks|citation_allowlist|coverage_manifest/, `${label} no puede tocar la carga cruda de cobertura.`);
}

// La precedencia (manifiesto semántico estricto primero, inventario legado sólo como respaldo)
// vive dentro del selector puro, no en los componentes.
assert.match(presentation, /export function tenderAnalysisCoverageReady/, 'el gate compartido debe existir como selector puro exportado.');
assert.match(presentation, /export function tenderRequirementInventoryReady/, 'el respaldo legado se conserva dentro del selector.');
for (const fragment of ['tender_semantic_manifest', 'tender_requirement_inventory', 'decision_ready']) {
  assert.ok(presentation.includes(fragment), `el selector compartido debe decidir sobre ${fragment}.`);
}

// La pausa fail-closed sigue siendo visible en ambas superficies cuando la cobertura no está lista.
assert.match(analysis, /coveragePaused && <section/, 'La vista operativa debe seguir rindiendo la pausa de cobertura.');
assert.match(analysis, /Análisis integral pausado/, 'La pausa operativa conserva su encabezado legible.');
assert.match(analysis, /No hay recomendación integral disponible/, 'La pausa operativa no debe insinuar cobertura integral.');
assert.match(technicalView, /Cobertura integral no disponible/, 'El respaldo técnico V3 conserva su aviso de pausa.');

// Never expose raw chunk text/hashes or the full coverage payload.
assert.doesNotMatch(analysis, /chunk\.text|chunk_hash|content_hash/, 'La franja no debe exponer texto de chunk ni hashes.');
assert.doesNotMatch(analysis, /JSON\.stringify\(\s*(?:analysis\??\.)?evidence_coverage/, 'La franja no debe serializar evidence_coverage completo en pantalla.');

// No obsolete presentation styles should remain after removing the panel.
assert.doesNotMatch(styles, /\.tender-evidence-coverage-(?:strip|omissions|list|wrapper|metrics)/, 'No deben quedar estilos obsoletos de cobertura de evidencia.');

console.log('agt002 evidence coverage UI checks passed');
