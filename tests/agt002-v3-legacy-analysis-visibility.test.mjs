import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

assert.match(
  component,
  /const hasIntegralV3Payload = Boolean\(analysis\?\.integral_analysis\?\.analysis_units\?\.length\)/,
  'La vista debe detectar explícitamente un análisis integral V3 con unidades.',
);
assert.match(
  component,
  /\{!hasIntegralV3Payload && <header className="tender-analysis-header"/,
  'El encabezado legado debe ocultarse cuando existe V3.',
);
assert.match(
  component,
  /\{!decisionSurfaceElsewhere && !hasIntegralV3Payload && analysis && analysis\.status !== 'failed' && <article className="tender-decision-brief"/,
  'El brief legado debe ocultarse cuando existe V3 o cuando la superficie autoritativa vive en Decisión.',
);
assert.match(
  component,
  /return <div className=\{`tender-analysis-section tender-detail-anchor\$\{hasIntegralV3 \? ' is-v3-compact' : ''\}`\}>/,
  'La raíz del análisis debe ser un div neutro sin aria-labelledby; las secciones internas conservan sus propios títulos.',
);
assert.match(component, /<div className="tender-analysis-actions">[\s\S]*showAnalysisAction/, 'El botón de actualizar debe permanecer disponible fuera del brief legado.');
assert.match(styles, /\.tender-analysis-section\.is-v3-compact\{[^}]*border:0[^}]*background:transparent/s, 'El modo V3 debe retirar visualmente la tarjeta duplicada.');

console.log('AGT-002 V3 legacy analysis visibility checks passed');
