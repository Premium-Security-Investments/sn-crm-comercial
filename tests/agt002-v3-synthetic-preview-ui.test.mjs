import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const moduleSource = readFileSync(new URL('../src/tenders/TendersModule.tsx', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../src/tenders/components/TenderAnalysisV3Preview.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/tenders/components/tender-analysis-v3-preview.css', import.meta.url), 'utf8');

test('the hidden tender route renders only the explicit AGT-002 v3 preview', () => {
  assert.match(moduleSource, /TenderAnalysisV3Preview/);
  assert.match(moduleSource, /get\(['"]preview['"]\)\s*===\s*['"]agt002-v3['"]/);
});

test('the preview makes its synthetic read-only human-gated status unmistakable', () => {
  for (const label of ['Datos sintéticos', 'Sólo lectura', 'Validación humana pendiente', 'No decide GO / NO GO']) {
    assert.match(preview, new RegExp(label.replaceAll('/', '\\/')));
  }
});

test('the institutional sequence and governed per-requirement views are explicit', () => {
  const orderedPhases = ['Descarte', 'Habilitantes', 'Técnico', 'Financiero / ejecución', 'Estratégico'];
  let previous = -1;
  for (const phase of orderedPhases) {
    const position = preview.indexOf(`label: '${phase}'`);
    assert.ok(position > previous, `${phase} must appear once and in institutional order`);
    previous = position;
  }
  for (const axis of ['Presencia', 'Revisión', 'Vigencia', 'Aplicabilidad', 'Sustento']) assert.match(preview, new RegExp(axis));
  for (const section of ['Impacto comercial', 'Lectura jurídica', 'Evidencia citada', 'Siguiente acción trazable']) assert.match(preview, new RegExp(section));
});

test('selection is local and the preview has no network or write surface', () => {
  assert.match(preview, /useState/);
  assert.match(preview, /setSelectedUnitId/);
  assert.doesNotMatch(preview, /\bapi\s*[<(]|\bfetch\s*\(|supabase|onSubmit|<form|<input|<textarea|Guardar|Enviar|Aprobar/);
  assert.match(css, /\.agt002-v3-preview/);
  assert.match(css, /@media/);
});
