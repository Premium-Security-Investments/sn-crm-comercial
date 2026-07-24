import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const briefHelperPath = new URL('../src/tenders/tenderDecisionBrief.ts', import.meta.url);
const briefHelper = readFileSync(briefHelperPath, 'utf8');
const decisionSource = `${main}\n${briefHelper}`;
const reviewPanel = main.match(/function TenderDocumentReviewPanel[\s\S]*?\n}\nfunction TenderOfferPreparationPanel/)?.[0] || '';

for (const text of [
  'Recomendación preliminar',
  'Preanálisis por reglas SIIO',
  'Análisis asistido por Hermes — transitorio',
  'Análisis AGT-002',
  'Fortalezas',
  'Debilidades y bloqueadores',
  'Dudas abiertas',
  'Información no verificada',
  'Siguiente acción',
  'Cómo funciona',
]) {
  assert.match(decisionSource, new RegExp(text), `El brief debe incluir ${text}.`);
}

assert.doesNotMatch(reviewPanel, /Dictamen GO \/ NO GO SN/, 'La revisión no debe presentar un dictamen de GO/NO GO.');
assert.doesNotMatch(main, /const favorable = .*\/GO\//, 'La UI no debe inferir una decisión con una regex favorable.');
assert.match(main, /const strengths = analysis\?\.strengths \?\? analysis\?\.commercial_fit\?\.positives \?\? \[\]/, 'Fortalezas debe preferir la carga tipada y degradar al legado.');
assert.match(main, /const weaknesses = analysis\?\.weaknesses \?\? analysis\?\.blockers \?\? analysis\?\.commercial_fit\?\.concerns \?\? \[\]/, 'Debilidades debe mapear bloqueadores y alertas legadas sin inventar evidencia.');
assert.match(main, /const questions = analysis\?\.questions \?\? \[\]/, 'Dudas abiertas debe consumir las preguntas tipadas.');
assert.match(main, /const unverified = analysis\?\.unverified \?\? analysis\?\.company_profile_crosscheck\?\.gaps \?\? \[\]/, 'Información no verificada debe degradar a brechas del perfil.');
assert.match(main, /<details[\s\S]*?<summary>Cómo funciona<\/summary>/, 'La ayuda debe quedar colapsada por defecto.');
assert.doesNotMatch(reviewPanel, /<textarea|Escriba lo que sabe|responda las preguntas pendientes/i, 'El brief no debe incluir la caja de aclaración antes de activar el motor inteligente.');

for (const emptyState of ['Sin fortalezas', 'Sin debilidades', 'Sin dudas abiertas', 'Sin información no verificada']) {
  assert.match(main, new RegExp(emptyState), `Una sección vacía debe comunicar ${emptyState}.`);
}

const unfavorableIndex = briefHelper.indexOf("new Set(['no_go', 'cerrada_no_go', 'no_adjudicada'])");
const positiveIndex = briefHelper.indexOf("normalizedStatus === 'go' || normalizedStatus === 'adjudicada'");
assert.ok(unfavorableIndex >= 0, 'El tono debe enumerar estados desfavorables exactos.');
assert.ok(positiveIndex > unfavorableIndex, 'Los estados desfavorables deben comprobarse antes de GO para que NO GO no quede verde.');
assert.match(briefHelper, /unfavorable\.has\(normalizedStatus\) \? 'red' : normalizedStatus === 'go' \|\| normalizedStatus === 'adjudicada' \? 'green' : 'amber'/, 'El tono debe ser rojo para no_go/cerrada_no_go/no_adjudicada, verde solo para go/adjudicada y ámbar en el resto.');
assert.match(styles, /\.tender-decision-brief/, 'El brief debe tener estilos compactos dedicados.');

const bundle = buildSync({ entryPoints: [briefHelperPath.pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const helperUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const { normalizeTenderEvidence, tenderAnalysisMethodLabel, tenderDecisionStatusTone } = await import(helperUrl);
assert.deepEqual(
  normalizeTenderEvidence([' Evidencia directa ', { text: ' Hallazgo tipado ' }, { detail: 'no usar' }, { text: '   ' }, null]),
  ['Evidencia directa', 'Hallazgo tipado'],
  'El normalizador debe renderizar strings y .text, omitir objetos malformados y limpiar vacíos.',
);
assert.deepEqual(normalizeTenderEvidence([]), [], 'Una lista vacía debe llegar vacía para activar el mensaje honesto de la sección.');
assert.deepEqual(normalizeTenderEvidence({ text: 'no es lista' }), [], 'Un payload no-array debe fallar cerrado sin renderizar objetos.');
assert.equal(tenderDecisionStatusTone('NO GO'), 'red');
assert.equal(tenderDecisionStatusTone('GO condicionado'), 'amber');
assert.equal(tenderDecisionStatusTone('GO'), 'green');
assert.equal(tenderAnalysisMethodLabel('HERMES-INTERIM'), 'Análisis asistido por Hermes — transitorio');

console.log('tender decision brief UI checks passed');
