import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const analysisPath = new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url);
const typesPath = new URL('../src/tenders/types.ts', import.meta.url);
const stylesPath = new URL('../src/styles.css', import.meta.url);
const analysis = readFileSync(analysisPath, 'utf8');
const types = readFileSync(typesPath, 'utf8');
const styles = readFileSync(stylesPath, 'utf8');

// --- Types: the real Task 27 contract must be typed, not left as `unknown`. ---
assert.match(types, /evidence_coverage\?:\s*TenderEvidenceCoverage\s*\|\s*null/, 'TenderDocumentAnalysis debe tipar evidence_coverage con el contrato real.');
assert.match(types, /material_omissions:\s*boolean/, 'El tipo debe incluir material_omissions.');
assert.match(types, /coverage_manifest/, 'El tipo debe incluir coverage_manifest.');
assert.match(types, /selected_chunks/, 'El tipo debe incluir selected_chunks.');
assert.match(types, /omitted_chunks/, 'El tipo debe incluir omitted_chunks.');
assert.match(types, /citation_allowlist/, 'El tipo debe incluir citation_allowlist.');
assert.doesNotMatch(types, /selected_chunks:\s*\{[^}]*text/s, 'selected_chunks nunca debe tipar un campo text (no debe persistir/mostrar texto de chunk).');

// --- Component: panel must exist, gated on a validated evidence_coverage, and hidden otherwise. ---
assert.match(analysis, /function\s+\w*EvidenceCoverage\w*\s*\(/, 'Debe existir un componente/función dedicada al panel de cobertura de evidencia.');
assert.match(analysis, /evidence_coverage/, 'El componente debe leer analysis.evidence_coverage.');

// Compact metrics: exactly the three required labels, no duplicated/giant KPI cards.
for (const label of ['Usados', 'Requisitos cubiertos', 'Omitidos']) {
  assert.match(analysis, new RegExp(label), `El panel debe mostrar la métrica "${label}".`);
}
assert.match(analysis, /<details\s+className="tender-evidence-coverage"/, 'Cobertura de evidencia debe ser un acordeón nativo.');
assert.match(analysis, /<summary[^>]*>[\s\S]*Cobertura de evidencia[\s\S]*tender-evidence-coverage-metrics[\s\S]*<\/summary>/, 'El encabezado cerrado debe conservar título y métricas.');
assert.doesNotMatch(analysis, /<details\s+className="tender-evidence-coverage"[^>]*\bopen\b/, 'Cobertura debe iniciar cerrada.');
const coverageRender = analysis.slice(analysis.indexOf('function EvidenceCoveragePanel'), analysis.indexOf('// Closed, client-side mirror'));
assert.ok(coverageRender.indexOf('role="alert"') < coverageRender.indexOf('<details className="tender-evidence-coverage"'), 'La alerta de omisiones materiales debe quedar visible antes del acordeón cerrado.');

// Material omissions warning: alert semantics + explicit "not comprehensive" + human review language.
assert.match(analysis, /material_omissions/, 'El panel debe condicionar la alerta a material_omissions.');
assert.match(analysis, /role=["']alert["']/, 'La alerta de omisiones materiales debe usar role=alert.');
assert.match(analysis, /no es integral|no es un análisis integral|análisis no integral/i, 'La alerta debe indicar explícitamente que el análisis no es integral.');
assert.match(analysis, /revisi[oó]n humana/i, 'La alerta debe pedir revisión humana de las omisiones.');

// Evidence links resolved against `documents` prop, safe target/rel, and readable fallback.
assert.match(analysis, /documents\.find/, 'Las referencias deben resolverse contra la prop documents por document_id.');
assert.match(analysis, /signed_url/, 'El enlace debe depender de signed_url.');
assert.match(analysis, /target=["']_blank["']/, 'Los enlaces de evidencia deben abrir en una pestaña nueva segura.');
assert.match(analysis, /rel=["']noopener noreferrer["']/, 'Los enlaces de evidencia deben incluir rel=noopener noreferrer.');

// Page/section/version/precedence/superseded surfaced compactly.
for (const field of ['page', 'section', 'version', 'precedence', 'superseded_by_addendum']) {
  assert.match(analysis, new RegExp(field), `El panel debe usar el campo ${field} del chunk seleccionado.`);
}

// Omissions summary: humanized reason, never raw chunk text/hash/payload.
assert.match(analysis, /omitted_chunks/, 'El panel debe listar omitted_chunks.');
assert.match(analysis, /budget_exhausted|lower_relevance|superseded_for_current_requirement|gap_unavailable/, 'El panel debe traducir las razones de omisión conocidas.');
assert.doesNotMatch(analysis, /chunk\.text|chunk_hash|content_hash/, 'El panel no debe exponer texto de chunk ni hashes.');
assert.doesNotMatch(analysis, /JSON\.stringify\(\s*(?:analysis\??\.)?evidence_coverage/, 'El panel no debe serializar evidence_coverage completo en pantalla.');

// Panel is compact and gated: no giant unconditional render, no empty panel without coverage.
assert.match(analysis, /analysis\?\.evidence_coverage|analysis\.evidence_coverage/, 'El render del panel debe estar condicionado a que exista evidence_coverage.');

// Preserve human authority: no GO/NO-GO or approval language introduced by this panel.
assert.doesNotMatch(analysis, /Aprobar cobertura|Autorizar cobertura|GO\s*\/\s*NO[- ]?GO.*cobertura|cobertura.*GO\s*\/\s*NO[- ]?GO/i, 'El panel de cobertura no debe introducir autorización GO/NO GO.');

// Dedicated compact styling exists (kept close to existing conventions in styles.css).
assert.match(styles, /\.tender-evidence-coverage/, 'Debe existir estilo compacto dedicado para el panel de cobertura.');

console.log('agt002 evidence coverage UI checks passed');
