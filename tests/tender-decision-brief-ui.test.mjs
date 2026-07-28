import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const briefHelperPath = new URL('../src/tenders/tenderDecisionBrief.ts', import.meta.url);
const briefHelper = readFileSync(briefHelperPath, 'utf8');
let analysisSection = '';
try { analysisSection = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8'); } catch {}
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const decisionSource = `${analysisSection}\n${briefHelper}`;
const reviewPanel = main.match(/function TenderDocumentReviewPanel[\s\S]*?\n}\nfunction TenderOfferPreparationPanel/)?.[0] || '';

for (const text of [
  'Recomendación preliminar',
  'Preanálisis por reglas SIIO',
  'Análisis asistido por Hermes — transitorio',
  'Análisis Vig-IA',
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
for (const backend of [server, api]) {
  assert.doesNotMatch(backend, /Objeto\/documentos mencionan|Menciona coordinador|Menciona capital de trabajo|Menciona RUP|Menciona pólizas/, 'El análisis visible debe expresar conclusiones y pendientes, no listas de palabras detectadas.');
  assert.match(backend, /encaje preliminar con servicios de seguridad que debe confirmarse/, 'El encaje comercial debe presentarse como conclusión preliminar y verificable.');
}
assert.doesNotMatch(main, /const favorable = .*\/GO\//, 'La UI no debe inferir una decisión con una regex favorable.');
assert.match(analysisSection, /const strengths = analysis\?\.strengths \?\? analysis\?\.commercial_fit\?\.positives \?\? \[\]/, 'Fortalezas debe preferir la carga tipada y degradar al legado.');
assert.match(analysisSection, /const weaknesses = analysis\?\.weaknesses \?\? analysis\?\.blockers \?\? analysis\?\.commercial_fit\?\.concerns \?\? \[\]/, 'Debilidades debe mapear bloqueadores y alertas legadas sin inventar evidencia.');
assert.match(analysisSection, /const questions = \(analysis\?\.questions \?\? \[\]\)\.map\(normalizeQuestion\)/, 'Dudas abiertas debe consumir y normalizar las preguntas tipadas.');
assert.match(analysisSection, /const unverified = analysis\?\.unverified \?\? analysis\?\.company_profile_crosscheck\?\.gaps \?\? \[\]/, 'Información no verificada debe degradar a brechas del perfil.');
assert.match(analysisSection, /<details[\s\S]*?<summary>Cómo funciona<\/summary>/, 'La ayuda debe quedar colapsada por defecto.');
assert.match(analysisSection, /Responder duda|Actualizar respuesta/, 'El brief debe permitir responder cada duda de forma trazable.');
assert.match(analysisSection, /No autoriza GO \/ NO GO/, 'La respuesta humana no debe confundirse con una decisión GO/NO GO.');

for (const emptyState of ['Sin fortalezas', 'Sin debilidades', 'Sin dudas abiertas', 'Sin información no verificada']) {
  assert.match(analysisSection, new RegExp(emptyState), `Una sección vacía debe comunicar ${emptyState}.`);
}

const unfavorableIndex = briefHelper.indexOf("new Set(['no_go', 'cerrada_no_go', 'no_adjudicada'])");
const positiveIndex = briefHelper.indexOf("normalizedStatus === 'go' || normalizedStatus === 'adjudicada'");
assert.ok(unfavorableIndex >= 0, 'El tono debe enumerar estados desfavorables exactos.');
assert.ok(positiveIndex > unfavorableIndex, 'Los estados desfavorables deben comprobarse antes de GO para que NO GO no quede verde.');
assert.match(briefHelper, /unfavorable\.has\(normalizedStatus\) \? 'red' : normalizedStatus === 'go' \|\| normalizedStatus === 'adjudicada' \? 'green' : 'amber'/, 'El tono debe ser rojo para no_go/cerrada_no_go/no_adjudicada, verde solo para go/adjudicada y ámbar en el resto.');
assert.match(styles, /\.tender-decision-brief/, 'El brief debe tener estilos compactos dedicados.');

const bundle = buildSync({ entryPoints: [briefHelperPath.pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const helperUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const { normalizeTenderEvidence, tenderAnalysisMethodLabel, tenderDecisionStatusTone, tenderNextAction } = await import(helperUrl);
assert.deepEqual(
  normalizeTenderEvidence([' Evidencia directa ', { text: ' Hallazgo tipado ' }, { detail: 'no usar' }, { text: '   ' }, null]),
  ['Evidencia directa', 'Hallazgo tipado'],
  'El normalizador debe renderizar strings y .text, omitir objetos malformados y limpiar vacíos.',
);
assert.deepEqual(normalizeTenderEvidence([]), [], 'Una lista vacía debe llegar vacía para activar el mensaje honesto de la sección.');
assert.deepEqual(normalizeTenderEvidence({ text: 'no es lista' }), [], 'Un payload no-array debe fallar cerrado sin renderizar objetos.');
assert.deepEqual(
  normalizeTenderEvidence(['capital de trabajo', 'rup', 'señal no catalogada']),
  [
    'El análisis detectó una referencia al capital de trabajo; falta validar el valor exigido y el soporte financiero de SN.',
    'El análisis detectó una referencia al RUP o a experiencia habilitante; falta validar su vigencia y equivalencia.',
    'señal no catalogada',
  ],
  'Las señales conocidas deben convertirse en conclusiones legibles sin alterar conclusiones no catalogadas.',
);
assert.equal(tenderNextAction('Completar documentos críticos y regenerar dictamen.'), 'Completar documentos críticos y actualizar la conclusión preliminar.', 'La siguiente acción visible no debe presentar un dictamen.');
assert.equal(tenderDecisionStatusTone('NO GO'), 'red');
assert.equal(tenderDecisionStatusTone('GO condicionado'), 'amber');
assert.equal(tenderDecisionStatusTone('GO'), 'green');
assert.equal(tenderAnalysisMethodLabel('HERMES-INTERIM'), 'Análisis asistido por Hermes — transitorio');

console.log('tender decision brief UI checks passed');
