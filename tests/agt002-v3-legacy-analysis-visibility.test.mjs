import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

assert.match(
  component,
  /const hasIntegralV3 = Boolean\(analysis\?\.integral_analysis\?\.analysis_units\?\.length\)/,
  'La vista debe detectar explícitamente un análisis integral V3 con unidades.',
);
assert.match(
  component,
  /\{!hasIntegralV3 && <header className="tender-analysis-header"/,
  'El encabezado legado debe ocultarse cuando existe V3.',
);
assert.match(
  component,
  /\{!hasIntegralV3 && analysis && analysis\.status !== 'failed' && <article className="tender-decision-brief"/,
  'El brief legado debe ocultarse cuando existe V3.',
);
assert.match(
  component,
  /className=\{`tender-analysis-section tender-detail-anchor\$\{hasIntegralV3 \? ' is-v3-compact' : ''\}`\}/,
  'Los controles operativos V3 deben usar una presentación compacta.',
);
assert.match(
  component,
  /aria-labelledby=\{hasIntegralV3 \? undefined : 'tender-analysis-title'\}/,
  'El modo compacto no debe referenciar un título oculto.',
);
assert.match(
  component,
  /aria-label=\{hasIntegralV3 \? 'Condiciones pendientes de validar' : undefined\}/,
  'El modo compacto debe conservar un nombre accesible.',
);
assert.match(component, /<div className="tender-analysis-actions">[\s\S]*showAnalysisAction/, 'El botón de actualizar debe permanecer disponible fuera del brief legado.');
assert.match(styles, /\.tender-analysis-section\.is-v3-compact\{[^}]*border:0[^}]*background:transparent/s, 'El modo V3 debe retirar visualmente la tarjeta duplicada.');

console.log('AGT-002 V3 legacy analysis visibility checks passed');
