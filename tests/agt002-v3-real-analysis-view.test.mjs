import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Task: real five-phase UI consuming `integral_analysis` (optional) — replaces the
// synthetic UNITS/fixture preview. No hardcoded institution/expediente name (never
// "Rama Judicial" or any other specific entity), human questions and GO/NO-GO stay in
// their own separate components (this view never renders a form, a question, or a
// GO/NO-GO action), and the component is a pure no-op (renders nothing) when
// `integral_analysis` is absent.

const componentPath = new URL('../src/tenders/components/TenderIntegralAnalysisV3View.tsx', import.meta.url);
const cssPath = new URL('../src/tenders/components/tender-integral-analysis-v3.css', import.meta.url);
const source = readFileSync(componentPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');

test('the view consumes analysis.integral_analysis, never a local fixture array', () => {
  assert.match(source, /analysis\?\.integral_analysis/, 'must read integral_analysis off the real analysis prop');
  assert.match(source, /analysis_units/);
  assert.doesNotMatch(source, /\bconst\s+UNITS\s*[:=]/, 'no local UNITS fixture array');
  assert.doesNotMatch(source, /REQ-DES-001|REQ-HAB-004|REQ-TEC-008|LIC-SYN|Entidad Pública Demo/i, 'no leftover synthetic fixture ids/labels');
});

test('renders nothing when integral_analysis is absent (optional consumption)', () => {
  assert.match(source, /if\s*\(\s*!(?:integral|analysisUnits|units)\b[^)]*\)\s*(?:\{\s*)?return\s+null/s);
});

test('never hardcodes an institution/expediente name (e.g. Rama Judicial)', () => {
  assert.doesNotMatch(source, /rama\s+judicial/i);
  assert.doesNotMatch(source, /consejo\s+superior/i);
});

test('the institutional five-phase order is presentational labels only, closed over the real category enum', () => {
  const orderedPhases = ['Descarte', 'Habilitantes', 'Técnico', 'Financiero / ejecución', 'Estratégico'];
  let previous = -1;
  for (const phase of orderedPhases) {
    const position = source.indexOf(`'${phase}'`);
    assert.ok(position > previous, `${phase} must appear once and in institutional order`);
    previous = position;
  }
  for (const category of ['discard', 'habilitating', 'technical', 'financial_execution', 'strategic']) {
    assert.match(source, new RegExp(category));
  }
});

test('renders the five independent evidence axes and both commercial/legal readings from real unit fields', () => {
  for (const axis of ['presence', 'review', 'validity', 'applicability', 'compliance']) assert.match(source, new RegExp(`\\b${axis}\\b`));
  assert.match(source, /commercial_impact/);
  assert.match(source, /legal_assessment/);
  assert.match(source, /evidence_refs/);
  assert.match(source, /missing_evidence/);
});

test('never duplicates the human-question or GO/NO-GO decision surfaces (the human-review disclaimer copy is exempt)', () => {
  assert.doesNotMatch(source, /\bquestions\b/);
  assert.doesNotMatch(source, /<form|onSubmit|\bfetch\s*\(|supabase|\bapi\s*[<(]/);
  assert.doesNotMatch(source, /decidir|autorizar|aprobar/i, 'must never itself offer a GO/NO-GO decision action, only describe it as out of scope');
});

test('keeps the human-review guard copy visible', () => {
  for (const label of ['Validación humana pendiente', 'No decide GO']) assert.match(source, new RegExp(label.replace(/[/]/g, '\\/')));
});

test('css exists and stays generic (no fixture-specific selectors)', () => {
  assert.match(css, /\.agt002-v3-/);
  assert.match(css, /@media/);
});

test('the obsolete synthetic hidden-route preview is fully removed', () => {
  const tendersModuleSource = readFileSync(new URL('../src/tenders/TendersModule.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(tendersModuleSource, /agt002-v3/);
  assert.doesNotMatch(tendersModuleSource, /TenderAnalysisV3Preview/);
});

test('the real view is wired into the actual tender dossier, next to the existing v2 analysis section (not a dangling/orphaned component)', () => {
  const mainSource = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(mainSource, /TenderIntegralAnalysisV3View/);
  const analysisSectionIndex = mainSource.indexOf('<TenderAnalysisSection');
  const integralViewIndex = mainSource.indexOf('<TenderIntegralAnalysisV3View');
  assert.ok(analysisSectionIndex >= 0 && integralViewIndex > analysisSectionIndex, 'the integral v3 view must render after the existing v2 analysis section, never replacing it');
  assert.match(mainSource, /<TenderIntegralAnalysisV3View analysis=\{analysis\}/);
});
