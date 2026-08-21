import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// AGT-002 Task 7 QA RED: contratos reproducibles para los dos gates de accesibilidad
// localizados por QA autenticada. No prueban texto incidental: fijan el nombre accesible del
// control de Seguimiento, las familias de color V3 y el landmark que deben corregirse para AA.

const root = new URL('../', import.meta.url);
const main = readFileSync(new URL('src/main.tsx', root), 'utf8');
const v3Css = readFileSync(new URL('src/tenders/components/tender-integral-analysis-v3.css', root), 'utf8');
const styles = readFileSync(new URL('src/styles.css', root), 'utf8');
const analysisSection = readFileSync(new URL('src/tenders/components/TenderAnalysisSection.tsx', root), 'utf8');

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `debe existir el bloque ${startMarker}`);
  return source.slice(start, end);
}

function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map(channel => Number.parseInt(channel, 16) / 255);
  const linear = channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground, background) {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test('Seguimiento asocia un label visible con htmlFor al id del select Tipo de actuación', () => {
  const followUp = sourceBlock(main, 'function PublicTenderFollowUp(', '\nfunction OpportunityForm(');

  assert.match(
    followUp,
    /<label\s+htmlFor="tender-follow-up-actuation-type">Tipo de actuación<\/label>/,
    'el select debe anunciar un label visible y programático, no sólo el placeholder empty',
  );
  assert.match(
    followUp,
    /<Select\s+id="tender-follow-up-actuation-type"[^>]*empty="Tipo de actuación"/,
    'el id del Select debe coincidir exactamente con el htmlFor del label visible',
  );
});

test('Seguimiento asocia un label visible con htmlFor al textarea obligatorio de la novedad', () => {
  const followUp = sourceBlock(main, 'function PublicTenderFollowUp(', '\nfunction OpportunityForm(');

  assert.match(
    followUp,
    /<label\s+htmlFor="tender-follow-up-note">Descripción de la actuación o novedad<\/label>/,
    'el textarea obligatorio debe tener un nombre visible y programático; el placeholder no reemplaza un label',
  );
  assert.match(
    followUp,
    /<textarea\s+id="tender-follow-up-note"\s+required\b/,
    'el id del textarea debe coincidir exactamente con el htmlFor del label visible',
  );
});

test('V3 declara las familias axe AA exactas sobre sus fondos reales', () => {
  const requiredPairs = [
    { selector: /\.agt002-v3-requirement dt\{[^}]*color:#526b88/, foreground: '#526b88', background: '#fbfdff' },
    { selector: /\.agt002-v3-scope dt\{[^}]*color:#526173/, foreground: '#526173', background: '#f8fbff' },
    { selector: /\.agt002-v3-overview-summary small\{[^}]*color:#526173/, foreground: '#526173', background: '#f8fbff' },
    { selector: /\.agt002-v3-unresolved \.agt002-v3-section-label\{[^}]*color:#8a5a00/, foreground: '#8a5a00', background: '#fffaf0' },
    { selector: /\.agt002-v3-phase>summary small\{[^}]*color:#5f6b7e/, foreground: '#5f6b7e', background: '#ffffff' },
    { selector: /\.agt002-v3-empty-phase\{[^}]*color:#5f6b7e/, foreground: '#5f6b7e', background: '#ffffff' },
  ];

  for (const pair of requiredPairs) {
    assert.match(v3Css, pair.selector, `V3 debe declarar ${pair.foreground} en el selector que usa fondo ${pair.background}`);
    assert.ok(
      contrastRatio(pair.foreground, pair.background) >= 4.5,
      `${pair.foreground} sobre ${pair.background} debe cumplir AA normal`,
    );
  }
  assert.match(styles, /\.tenders-page \.eyebrow,(?=[^{]*\.tender-decision-review \.eyebrow)[^{]*\{[^}]*background:#eaf2ff[^}]*color:#174ea6/, 'el override agrupado de eyebrow debe incluir revisión de decisión con #174ea6 sobre #eaf2ff');
  assert.ok(contrastRatio('#174ea6', '#eaf2ff') >= 4.5, '#174ea6 sobre #eaf2ff debe cumplir AA normal');
});

test('TenderAnalysisSection usa una raíz div neutra y no crea un landmark section redundante', () => {
  assert.match(
    analysisSection,
    /return <div className=\{`tender-analysis-section tender-detail-anchor\$\{hasIntegralV3 \? ' is-v3-compact' : ''\}`\}>/,
    'la raíz de Análisis debe ser un div neutro; los subpaneles titulados conservan sus sections semánticas',
  );
  assert.doesNotMatch(
    analysisSection,
    /return <section className=\{`tender-analysis-section[^>]*aria-labelledby=/,
    'Análisis no debe duplicar un landmark section etiquetado dentro de la ancla tender-analysis',
  );
});

test('Task 7 mobile: evita el recorte del estado de condición a 375px', () => {
  const mobileBlocks = [];
  const mediaPattern = /@media\s*\(\s*max-width\s*:\s*720px\s*\)\s*\{/g;

  for (const match of styles.matchAll(mediaPattern)) {
    let depth = 1;
    let cursor = match.index + match[0].length;

    for (; cursor < styles.length && depth > 0; cursor += 1) {
      if (styles[cursor] === '{') depth += 1;
      if (styles[cursor] === '}') depth -= 1;
    }

    mobileBlocks.push(styles.slice(match.index + match[0].length, cursor - 1));
  }

  assert.ok(
    mobileBlocks.some((block) =>
      /\.tender-question-response-card\s*>\s*header\.tender-condition-head\s*\{(?=[^}]*\bflex-direction\s*:\s*column\s*;?)(?=[^}]*\balign-items\s*:\s*stretch\s*;?)[^}]*\}/s.test(block),
    ),
    'El breakpoint max-width: 720px debe usar un selector capaz de vencer la regla base del header, apilar .tender-condition-head y estirarlo',
  );

  assert.ok(
    mobileBlocks.some((block) =>
      /\.tender-condition-state\s*\{(?=[^}]*\bwidth\s*:\s*100%\s*;?)[^}]*\}/s.test(block),
    ),
    'El breakpoint max-width: 720px debe dar width:100% explícito a .tender-condition-state',
  );
});
