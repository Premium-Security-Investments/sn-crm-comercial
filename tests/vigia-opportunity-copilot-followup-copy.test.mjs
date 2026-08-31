import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../src/vigia/VigiaOpportunityCopilot.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

// AGT-003 exact copy: eyebrow renders "Vig-IA Comercial" without an extra suffix, title
// "Próximo seguimiento", and the generation CTA names the current-context boundary.
assert.ok(
  component.includes('<span className="eyebrow">{VIGIA_VISIBLE_NAMES.commercial}</span>'),
  'eyebrow debe mostrar únicamente el nombre visible de Vig-IA Comercial',
);
assert.equal(component.includes('copiloto comercial</span>'), false, 'eyebrow no debe incluir el sufijo "· copiloto comercial"');
assert.ok(component.includes('>Próximo seguimiento<'), 'título debe ser exactamente "Próximo seguimiento"');
assert.ok(
  component.includes(">{ready ? 'Actualizar borrador' : 'Preparar próximo seguimiento'}<"),
  'botón debe distinguir generar/actualizar con una única CTA de preparación de seguimiento',
);
assert.ok(
  component.includes('>Analiza el contexto y propone un siguiente paso de seguimiento</p>'),
  'texto de ayuda debe ser exactamente "Analiza el contexto y propone un siguiente paso de seguimiento" (sin punto final)',
);

// Contrast: the base .eyebrow rule is tuned for dark hero backgrounds (pale-blue
// text on a near-transparent white pill). This panel has a light background, so it
// needs the same readable override already proven in .login-card .eyebrow and the
// licitaciones module scopes.
const ruleMatch = styles.match(/\.vigia-opportunity-copilot \.eyebrow[^{]*\{([^}]*)\}/);
assert.ok(ruleMatch, 'styles.css debe definir un override de contraste para .vigia-opportunity-copilot .eyebrow');
const body = ruleMatch[1];
assert.doesNotMatch(body, /rgba\(255,255,255,\.12\)/, 'No debe reutilizar el fondo casi transparente de baja legibilidad');
assert.doesNotMatch(body, /#dbeafe/, 'No debe reutilizar el texto azul pálido de baja legibilidad sobre fondo claro');
assert.match(body, /background:#eaf2ff/, 'Debe usar el fondo claro legible ya usado en el resto de la app');
assert.match(body, /color:#174ea6/, 'Debe usar el texto azul oscuro legible ya usado en el resto de la app');

console.log('Vig-IA opportunity copilot follow-up copy + contrast checks passed');
