import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

// The base .eyebrow rule is tuned for dark hero backgrounds (near-transparent white
// pill + pale-blue text, e.g. "#dbeafe" on "rgba(255,255,255,.12)"). Inside the
// licitaciones module several white panels reuse that same bare class — "REVISIÓN
// DOCUMENTAL" (TenderDocumentSection) and "PASO PREVIO A LA DECISIÓN HUMANA"
// (TenderAnalysisSection) among them — making the label nearly invisible. Every
// white-panel scope in the licitaciones module must get a readable override,
// reusing the same light-background pair (#eaf2ff / #174ea6) already proven
// elsewhere in the app (e.g. .login-card .eyebrow).
const scopes = [
  '.tenders-page .eyebrow',
  '.tender-document-section .eyebrow',
  '.tender-analysis-section .eyebrow',
  '.tender-go-no-go-panel .eyebrow',
  '.tender-offer-status-panel .eyebrow',
  '.tender-document-panel .eyebrow',
];
for (const scope of scopes) {
  assert.ok(styles.includes(scope), `styles.css debe definir un override de contraste para ${scope}`);
}

const ruleMatch = styles.match(/\.tenders-page \.eyebrow[^{]*\{([^}]*)\}/);
assert.ok(ruleMatch, 'Debe existir la regla de contraste agrupada para el alcance de licitaciones');
const body = ruleMatch[1];
for (const scope of scopes) assert.ok(ruleMatch[0].includes(scope), `La regla agrupada debe incluir ${scope}`);
assert.doesNotMatch(body, /rgba\(255,255,255,\.12\)/, 'No debe reutilizar el fondo casi transparente de baja legibilidad');
assert.doesNotMatch(body, /#dbeafe/, 'No debe reutilizar el texto azul pálido de baja legibilidad sobre fondo claro');
assert.match(body, /background:#eaf2ff/, 'Debe usar el fondo claro legible ya usado en el resto de la app');
assert.match(body, /color:#174ea6/, 'Debe usar el texto azul oscuro legible ya usado en el resto de la app');

console.log('tender eyebrow contrast checks passed');
