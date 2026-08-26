// Deterministic local visual QA for AGT-002 "Análisis para decidir".
//
// Bundles and renders the REAL TenderDecisionExperience component with React SSR, inlines the
// checked-in global/component CSS, validates flag-off fallback plus three flag-on states, and
// captures desktop/mobile PNGs with headless Chromium. No network, DB, provider, auth session,
// clock, randomness, or persisted flag is involved.
//
// Usage: node scripts/agt002-decision-axis-visual-qa.mjs

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const qaDir = resolve(root, 'dist/_qa/agt002-decision-axis');
const outDir = resolve(root, 'docs/verification/screenshots');
mkdirSync(qaDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const bundledPath = resolve(qaDir, 'TenderDecisionExperience.mjs');
await esbuild.build({
  entryPoints: [resolve(root, 'src/tenders/components/TenderDecisionExperience.tsx')],
  outfile: bundledPath,
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  packages: 'external',
  plugins: [{
    name: 'ignore-component-css-side-effects',
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
    },
  }],
});
const { TenderDecisionExperience } = await import(`${bundledPath}?qa=agt002-decision-axis-v1`);

const AXES = ['legal', 'experiencia_financiera', 'imposibilidad_tecnica_grave', 'plazo', 'viabilidad_economica'];
const READY_COVERAGE_BLOCK = Object.freeze({
  status: 'complete',
  total_source_units: 5,
  dispositioned_source_units: 5,
  requirement_count: 5,
});

function finding({
  id,
  requirementId,
  status,
  category,
  title,
  summary,
}) {
  return {
    id,
    requirement_id: requirementId,
    label: title,
    reviewed_status: status,
    rationale: 'Detalle gobernado disponible únicamente en auditoría.',
    evidence_refs: [{ type: 'manifest_requirement', requirement_id: requirementId }],
    material_impediment_category: category,
    presentation: {
      title,
      summary,
      missing: status === 'supported' ? null : 'Validación humana vigente.',
      action_required: status === 'supported' ? 'Conservar soporte trazable.' : 'Revisar el soporte con la persona responsable.',
    },
    question_responses: [],
  };
}

function axisBucket(axis, state = 'No evaluado', findings = []) {
  return {
    axis,
    state,
    findings,
    counts: {
      blocker: findings.filter(item => item.reviewed_status === 'blocker').length,
      decision_question: findings.filter(item => item.reviewed_status === 'decision_question').length,
      supported: findings.filter(item => item.reviewed_status === 'supported').length,
    },
  };
}

function analysisFixture(mode) {
  const paused = mode === 'paused';
  const total = paused ? 11345 : 5;
  const resolved = paused ? 8 : 5;
  const axes = Object.fromEntries(AXES.map(axis => [axis, axisBucket(axis)]));

  if (!paused) {
    if (mode === 'post-go') {
      axes.legal = axisBucket('legal', 'Impedimento material', [finding({
        id: 'finding-legal-blocker',
        requirementId: 'legal-objective-disability',
        status: 'blocker',
        category: 'inhabilidad_incompatibilidad',
        title: 'Restricción jurídica confirmada',
        summary: 'El soporte curado confirma una restricción material para revisión humana.',
      })]);
    }
    axes.experiencia_financiera = axisBucket('experiencia_financiera', 'Por confirmar', [finding({
      id: 'finding-financial-question',
      requirementId: 'financial-working-capital',
      status: 'decision_question',
      category: 'capacidad_financiera_insuficiente',
      title: 'Capital de trabajo mínimo',
      summary: 'La capacidad debe validarse con evidencia vigente.',
    })]);
    axes.plazo = axisBucket('plazo', 'Favorable con evidencia', [finding({
      id: 'finding-deadline-supported',
      requirementId: 'deadline-non-extendable',
      status: 'supported',
      category: 'plazo_objetivamente_imposible',
      title: 'Plazo contractual verificable',
      summary: 'El soporte gobernado permite sustentar el plazo para revisión humana.',
    })]);
  }

  const evidenceCoverage = paused
    ? {
      tender_requirement_inventory: {
        inventory_version: 'tender_requirement_inventory.v1',
        decision_ready: false,
        expedient_coverage: { status: 'partial', total_source_units: total, dispositioned_source_units: resolved, requirement_count: resolved },
        analyzed_coverage: { status: 'incomplete', total_source_units: total, dispositioned_source_units: resolved, requirement_count: resolved },
      },
    }
    : {
      tender_requirement_inventory: {
        inventory_version: 'tender_requirement_inventory.v1',
        decision_ready: true,
        expedient_coverage: READY_COVERAGE_BLOCK,
        analyzed_coverage: READY_COVERAGE_BLOCK,
      },
    };

  const allFindings = Object.values(axes).flatMap(bucket => bucket.findings);
  return {
    run_id: `run-${mode}`,
    snapshot_id: `snapshot-${mode}`,
    producer: 'AGT-002',
    method: 'agent_ai',
    status: 'completed',
    current: true,
    critical_open_count: 0,
    recommendation: paused ? 'hold' : 'conditional',
    summary: paused ? 'Cobertura parcial: el análisis no está listo para decidir.' : 'Lectura material disponible para revisión humana.',
    evidence_coverage: evidenceCoverage,
    decision_review: {
      artifact_type: 'agt002_generic_decision_review',
      review_findings: [],
      blockers: allFindings.filter(item => item.reviewed_status === 'blocker'),
      decision_questions: allFindings.filter(item => item.reviewed_status === 'decision_question'),
      supported: allFindings.filter(item => item.reviewed_status === 'supported'),
      preparation: [],
      not_applicable: [],
      counts: {
        blockers: allFindings.filter(item => item.reviewed_status === 'blocker').length,
        decision_questions: allFindings.filter(item => item.reviewed_status === 'decision_question').length,
        supported: allFindings.filter(item => item.reviewed_status === 'supported').length,
        preparation: 0,
        not_applicable: 0,
      },
    },
    decision_axis_analysis: {
      contract_version: 'agt002-decision-axis-analysis@1',
      global_state: paused ? 'paused' : 'ready_for_human_review',
      paused_reason: paused ? 'coverage_not_decision_ready' : null,
      coverage: {
        decision_ready: !paused,
        total_source_units: total,
        dispositioned_source_units: resolved,
        unresolved_source_units: total - resolved,
      },
      axes,
      preparation: [],
      counts: { material_findings: paused ? 0 : allFindings.length, ordinary_reclassified: 0 },
    },
  };
}

const profile = Object.freeze({
  id: 'profile-local-qa',
  full_name: 'Revisión local',
  role: 'director',
  permissions: ['licitaciones'],
  active: true,
  identity_type: 'human',
});
const request = async () => ({ decision: null, history: [], preparation: null });
const commonProps = {
  opportunityId: 'opportunity-local-qa',
  opportunityName: 'Expediente local determinista',
  questionResponses: [],
  currentProfile: profile,
  request,
  canAnswerQuestions: true,
  onSaveQuestionResponse: async () => {},
  onDecisionChanged: () => {},
  onDecisionNavigationStateChanged: () => {},
  onOpenHelpDesk: () => {},
  commercialContext: { amountLabel: '$1.000', closeLabel: 'Sin fecha', city: null, sector: null, commercialFitPositives: [] },
};

const scenarios = [
  {
    id: 'flag-off',
    title: 'Flag apagado · fallback vigente',
    props: {
      ...commonProps,
      decisionAxisSurfaceEnabled: false,
      analysis: analysisFixture('ready'),
      decisionState: { phase: 'ready', value: null },
    },
  },
  {
    id: 'paused-bogota',
    title: 'Flag activo · cobertura parcial Bogotá',
    props: {
      ...commonProps,
      decisionAxisSurfaceEnabled: true,
      analysis: analysisFixture('paused'),
      decisionState: { phase: 'ready', value: null },
    },
  },
  {
    id: 'ready',
    title: 'Flag activo · revisión humana',
    props: {
      ...commonProps,
      decisionAxisSurfaceEnabled: true,
      analysis: analysisFixture('ready'),
      decisionState: { phase: 'ready', value: null },
    },
  },
  {
    id: 'post-go',
    title: 'Flag activo · GO humano registrado',
    props: {
      ...commonProps,
      decisionAxisSurfaceEnabled: true,
      analysis: analysisFixture('post-go'),
      decisionState: {
        phase: 'ready',
        value: {
          id: 'decision-local-qa',
          opportunity_id: 'opportunity-local-qa',
          analysis_run_id: 'run-post-go',
          decision: 'go',
          justification: 'Decisión humana de fixture; no persistida.',
          decided_by: 'profile-local-qa',
          decided_at: '2026-08-25T12:00:00.000Z',
        },
      },
    },
  },
];

const globalCss = readFileSync(resolve(root, 'src/styles.css'), 'utf8');
const componentCss = readFileSync(resolve(root, 'src/tenders/components/tender-decision-axis-surface.css'), 'utf8');
const shellCss = `
  :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;color:#10213d;background:#e9eef3}
  *{box-sizing:border-box}body{margin:0;padding:28px;background:#e9eef3}main{max-width:1240px;margin:0 auto}
  .qa-context{margin:0 0 18px;padding:14px 18px;border-radius:14px;background:#10213d;color:white}
  .qa-context small{display:block;margin-top:4px;color:#cbd5e1}
`;

function count(markup, needle) {
  return markup.split(needle).length - 1;
}
function requireCheck(condition, message, failures) {
  if (!condition) failures.push(message);
}
function locateChromium() {
  const candidates = [process.env.CHROMIUM_BIN, '/snap/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
  const match = candidates.find(candidate => candidate && existsSync(candidate));
  if (!match) throw new Error('No se encontró Chromium; defina CHROMIUM_BIN.');
  return match;
}

const chromium = locateChromium();
const rendered = new Map();
const evidenceLines = [
  'AGT-002 — QA visual determinista de Análisis para decidir',
  '',
  'Alcance: fixture React SSR local; sin red, base de datos ni sesión autenticada.',
  `Chromium: ${execFileSync(chromium, ['--version'], { encoding: 'utf8' }).trim()}`,
  '',
];

for (const scenario of scenarios) {
  const markup = renderToStaticMarkup(createElement(TenderDecisionExperience, scenario.props));
  rendered.set(scenario.id, markup);
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${scenario.title}</title><style>${globalCss}\n${componentCss}\n${shellCss}</style></head><body><main><header class="qa-context"><strong>${scenario.title}</strong><small>Fixture local determinista · no autenticado · sin persistencia</small></header>${markup}</main></body></html>`;
  const htmlPath = resolve(outDir, `agt002-decision-axis-${scenario.id}.html`);
  const pngPath = resolve(outDir, `agt002-decision-axis-${scenario.id}.png`);
  writeFileSync(htmlPath, html, 'utf8');
  execFileSync(chromium, [
    '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=1440,2600', `--screenshot=${pngPath}`, `file://${htmlPath}`,
  ], { stdio: 'ignore' });
  evidenceLines.push(`${scenario.id}: HTML+PNG · sha256 ${createHash('sha256').update(markup).digest('hex')}`);
}

// Extra mobile capture of the ready state to exercise the <=640px layout.
const readyHtmlPath = resolve(outDir, 'agt002-decision-axis-ready.html');
const mobilePngPath = resolve(outDir, 'agt002-decision-axis-ready-mobile.png');
execFileSync(chromium, [
  '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--window-size=390,2800', `--screenshot=${mobilePngPath}`, `file://${readyHtmlPath}`,
], { stdio: 'ignore' });
evidenceLines.push('ready-mobile: PNG 390px · regla <=640px ejercitada');

// Deterministic scratch bundle only; the QA deliverables already live under docs/verification/screenshots.
rmSync(qaDir, { recursive: true, force: true });

const failures = [];
const off = rendered.get('flag-off');
const paused = rendered.get('paused-bogota');
const ready = rendered.get('ready');
const postGo = rendered.get('post-go');
const flagOn = [paused, ready, postGo].join('\n');

requireCheck(off.includes('Brief de decisión'), 'flag off: falta el brief vigente', failures);
requireCheck(!off.includes('tender-decision-axis-surface'), 'flag off: apareció la superficie nueva', failures);
requireCheck(count(off, 'Decisión GO / NO GO') === 1, 'flag off: el panel formal no aparece exactamente una vez', failures);

for (const [id, markup] of [['paused-bogota', paused], ['ready', ready], ['post-go', postGo]]) {
  requireCheck(count(markup, 'class="tender-decision-axis-surface"') === 1, `${id}: superficie no única`, failures);
  requireCheck(count(markup, 'class="tender-decision-axis-cta"') === 1, `${id}: CTA primaria no única`, failures);
  requireCheck(count(markup, 'Decisión GO / NO GO') === 1, `${id}: panel formal no único`, failures);
  requireCheck(!markup.includes('Brief de decisión'), `${id}: apareció brief competidor`, failures);
}
requireCheck(paused.includes('Análisis pausado — cobertura parcial (8 de 11.345 resueltas; 11.337 sin resolver)'), 'Bogotá: copy 8/11.345 incorrecto', failures);
requireCheck(count(paused, 'No evaluado · 0') === 5, 'Bogotá: no hay cinco ejes No evaluado', failures);
requireCheck(!paused.includes('Favorable con evidencia'), 'Bogotá: apareció Favorable con evidencia', failures);
const pausedPrimaryCta = paused.match(/<button[^>]*class="tender-decision-axis-cta"[^>]*>[\s\S]*?<\/button>/)?.[0] || '';
requireCheck(pausedPrimaryCta.includes('Ver el respaldo técnico del análisis'), 'Bogotá: la CTA primaria no lleva al respaldo técnico', failures);
requireCheck(!/Registrar\s+GO|Registrar decisión/i.test(pausedPrimaryCta), 'Bogotá: apareció una CTA GO/decisoria principal', failures);
requireCheck(ready.includes('pregunta material pendiente'), 'ready: decision_question no usa el rótulo pendiente', failures);
requireCheck(!/Capital de trabajo mínimo[\s\S]{0,600}impedimento/i.test(ready), 'ready: decision_question fue rotulado impedimento', failures);
requireCheck(postGo.includes('GO humano registrado'), 'post_go: falta autoridad humana explícita', failures);
requireCheck(postGo.includes('Abrir Mesa de ayuda'), 'post_go: falta CTA a Mesa de ayuda', failures);
for (const state of ['Favorable con evidencia', 'Impedimento material', 'Por confirmar', 'No evaluado']) {
  requireCheck(flagOn.includes(state), `falta el rótulo cerrado: ${state}`, failures);
}
requireCheck(!flagOn.includes('Sin impedimentos'), 'copy prohibido: Sin impedimentos', failures);
requireCheck(flagOn.includes('la decisión GO / NO GO permanece humana'), 'falta copy de autoridad humana', failures);

if (failures.length) {
  console.error(`VISUAL QA ASSERTIONS FAILED:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

evidenceLines.push('', 'Checks:');
evidenceLines.push('- fallback flag off sin superficie nueva; brief + panel formal únicos');
evidenceLines.push('- flag on: una superficie, una CTA primaria y un panel formal por escenario');
evidenceLines.push('- Bogotá HOLD: 8/11.345, 11.337 sin resolver, cinco ejes No evaluado, cero favorable y CTA primaria sólo a respaldo técnico');
evidenceLines.push('- cuatro estados cerrados presentes; decision_question rotulada pregunta material pendiente');
evidenceLines.push('- post_go reafirma autoridad humana y enlaza Mesa de ayuda');
evidenceLines.push('- copy prohibido "Sin impedimentos" ausente');
evidenceLines.push('', 'Resultado: PASS', '');
const evidence = evidenceLines.join('\n');
writeFileSync(resolve(outDir, 'agt002-decision-axis-qa.txt'), evidence, 'utf8');
console.log(evidence);
