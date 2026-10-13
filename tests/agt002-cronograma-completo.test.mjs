import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PRE_GO_SCHEMA_V2, AGT002_V2_EXTRA_DEADLINE_KINDS } from '../agt002-pre-go-analysis-v2.js';
import { buildInitialSynthesisModelSchema } from '../agt002-initial-analysis-aggregate-builder.js';

const V1 = JSON.parse(readFileSync(new URL('../schemas/agt002/pre_go_analysis.v1.schema.json', import.meta.url), 'utf8'));

test('v2: tipos de fecha por trámite y etiqueta opcional; v1 no cambia', () => {
  const deadline = PRE_GO_SCHEMA_V2.$defs.deadline;
  for (const kind of ['OBSERVATIONS', 'ADDENDA', 'SUBMISSION', 'OTHER', ...AGT002_V2_EXTRA_DEADLINE_KINDS]) assert.ok(deadline.properties.kind.enum.includes(kind), kind);
  assert.deepEqual(deadline.properties.label, { type: 'string', minLength: 1, maxLength: 200 });
  assert.ok(!deadline.required.includes('label'), 'los análisis v2 ya guardados (sin etiqueta) siguen siendo válidos');
  assert.ok(!('label' in V1.$defs.deadline.properties), 'v1 es inmutable');
  assert.deepEqual(V1.$defs.deadline.properties.kind.enum, ['OBSERVATIONS', 'ADDENDA', 'SUBMISSION', 'OTHER']);
});

test('el modelo siempre nombra el trámite de cada fecha', () => {
  const schema = buildInitialSynthesisModelSchema({ documentIds: ['00000000-0000-4000-8000-000000000001'] });
  assert.ok(schema.$defs.deadline.required.includes('label'));
  assert.ok(!PRE_GO_SCHEMA_V2.$defs.deadline.required.includes('label'), 'no contamina el esquema guardado');
});

test('instrucciones: transcribir el cronograma completo al leer y una fecha por trámite al sintetizar', () => {
  const runtime = readFileSync(new URL('../agt002-initial-analysis-runtime.js', import.meta.url), 'utf8');
  assert.match(runtime, /const MEMBER_POLICY = '[^']*transcríbalo completo en una nota propia[^']*sin resumir ni omitir filas/);
  assert.match(runtime, /const DEADLINES_POLICY = '[^']*una entrada por trámite, aunque la fecha ya haya pasado/);
  assert.match(runtime, /Nunca use OBSERVATIONS para las observaciones al informe de evaluación/);
  assert.match(runtime, /WRITING_POLICY \+ DEADLINES_POLICY \+/);
});

test('el reporte expone la etiqueta y la pantalla la usa en el cronograma', () => {
  const report = readFileSync(new URL('../agt002-initial-analysis-report.js', import.meta.url), 'utf8');
  assert.match(report, /label: typeof deadline\.label === 'string'/);
  const workspace = readFileSync(new URL('../src/tenders/workspace/TenderWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /export function TenderScheduleCard/);
  assert.match(workspace, /deadline\.label \|\| initialReportLabels\.deadlineKind\(deadline\.kind\)/);
  assert.match(workspace, /<TenderScheduleCard report=\{report\} \/>/);
  assert.match(workspace, /<TenderScheduleCard report=\{report\} compact \/>/);
});

test('después del GO el análisis sigue visible en su propia pestaña, sin el registro de la decisión', () => {
  const workspace = readFileSync(new URL('../src/tenders/workspace/TenderWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /\.\.\.\(moment === 'preparar' \? \[\{ id: 'analisis' as const, label: 'Análisis' \}\] : \[\]\)/);
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(main, /\{moment === 'preparar' && <div className="tw-panel tw-panel-analisis"><TenderDecideView report=\{tenderInitialReport\} \/><\/div>\}/);
});
