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

// Móvil: dentro del breakpoint existente del panel Vig-IA, la alerta compacta de error
// (.vigia-copilot-error) debe apilarse en columna, alinear al inicio, y su botón secundario
// debe resetear el margin-left automático (usado en escritorio para empujarlo a la derecha)
// y ocupar el ancho disponible en vez de quedar apretado en una fila angosta.
const mobileLine = styles.split('\n').find(
  line => line.includes('@media(max-width:720px)') && line.includes('.vigia-opportunity-copilot>header'),
);
assert.ok(mobileLine, 'debe existir el breakpoint móvil existente del panel Vig-IA (max-width:720px)');
assert.match(
  mobileLine,
  /\.vigia-copilot-error\{[^}]*flex-direction:column[^}]*\}/,
  '.vigia-copilot-error debe apilarse en columna dentro del breakpoint móvil',
);
assert.match(
  mobileLine,
  /\.vigia-copilot-error\{[^}]*align-items:flex-start[^}]*\}/,
  '.vigia-copilot-error debe alinear su contenido al inicio dentro del breakpoint móvil',
);
assert.match(
  mobileLine,
  /\.vigia-copilot-error \.secondary\{[^}]*margin-left:0[^}]*\}/,
  'el botón secundario de .vigia-copilot-error debe resetear margin-left en móvil',
);
assert.match(
  mobileLine,
  /\.vigia-copilot-error \.secondary\{[^}]*width:100%[^}]*\}/,
  'el botón secundario de .vigia-copilot-error debe usar width:100% en móvil',
);

// Cascada: a igual especificidad, la regla que aparece más tarde en el source gana.
// El bloque @media(max-width:720px) debe aparecer DESPUÉS de las reglas base de
// .vigia-copilot-error y .vigia-copilot-error .secondary para que sus valores móviles
// (align-items:flex-start, margin-left:0) no sean sobrescritos por las reglas base
// (align-items:center, margin-left:auto).
const mobileBlockOffset = styles.indexOf(mobileLine);
const baseErrorRuleOffset = styles.indexOf('.vigia-copilot-error{display:flex;align-items:center');
const baseSecondaryRuleOffset = styles.indexOf('.vigia-copilot-error .secondary{margin-left:auto');
assert.ok(mobileBlockOffset !== -1, 'debe ubicarse el offset del bloque mobile en el source CSS');
assert.ok(baseErrorRuleOffset !== -1, 'debe ubicarse el offset de la regla base .vigia-copilot-error en el source CSS');
assert.ok(baseSecondaryRuleOffset !== -1, 'debe ubicarse el offset de la regla base .vigia-copilot-error .secondary en el source CSS');
assert.ok(
  mobileBlockOffset > baseErrorRuleOffset,
  `el bloque @media(max-width:720px) (offset ${mobileBlockOffset}) debe aparecer DESPUÉS de la regla base .vigia-copilot-error (offset ${baseErrorRuleOffset}) para ganar la cascada`,
);
assert.ok(
  mobileBlockOffset > baseSecondaryRuleOffset,
  `el bloque @media(max-width:720px) (offset ${mobileBlockOffset}) debe aparecer DESPUÉS de la regla base .vigia-copilot-error .secondary (offset ${baseSecondaryRuleOffset}) para ganar la cascada`,
);

console.log('Vig-IA opportunity copilot follow-up copy + contrast checks passed');
