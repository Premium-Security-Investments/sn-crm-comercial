import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../src/tenders/components/TenderIntegralAnalysisV3View.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/tenders/components/tender-integral-analysis-v3.css', import.meta.url), 'utf8');

assert.doesNotMatch(component, /agt002-v3-hero/, 'V3 no debe renderizar un segundo hero dominante.');
assert.doesNotMatch(css, /\.agt002-v3-hero(?:\W|$)/, 'Los estilos del hero grande deben retirarse.');
assert.match(component, /<header className="agt002-v3-overview">/, 'V3 debe usar un encabezado discreto.');
assert.match(component, /<h2 id="agt002-v3-title">Análisis integral por requisito<\/h2>/, 'El título debe conservarse.');
assert.match(component, /<div className="agt002-v3-overview-summary">/, 'Cobertura y estado deben mostrarse de forma compacta.');
assert.match(component, /<details className="agt002-v3-run-details">/, 'Los identificadores técnicos deben quedar plegables.');
assert.match(component, /<summary>Ver trazabilidad técnica<\/summary>/, 'El control plegable debe identificar la trazabilidad técnica.');
assert.match(component, /Validación humana pendiente/, 'La autoridad humana debe seguir visible.');
assert.match(css, /\.agt002-v3-overview\{[^}]*background:#fff/s, 'El encabezado debe ser una superficie blanca sobria.');
assert.match(css, /\.agt002-v3-overview h2\{[^}]*font-size:clamp\(22px,2vw,28px\)/s, 'El título debe usar una escala discreta.');
assert.match(css, /\.agt002-v3-run-details:not\(\[open\]\) \.agt002-v3-run-meta\{display:none\}/, 'Los UUID deben permanecer ocultos hasta abrir los detalles.');
assert.match(css, /\.agt002-v3-guard span\{color:#4f5f74;/, 'La advertencia humana secundaria debe conservar contraste AA sobre blanco.');

console.log('AGT-002 V3 compact overview header checks passed');
