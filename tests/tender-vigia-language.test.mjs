import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const analysisSection = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');
const goNoGoPanel = readFileSync(new URL('../src/tenders/components/TenderGoNoGoDecisionPanel.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

// D. Public-facing copy must call the agent "Vig-IA Licitaciones"; AGT-001/AGT-002 stay only as
// internal/audit IDs inside collapsible technical details, never as the primary
// CTA or the headline of a status message.
assert.match(analysisSection, /Analizar con \$\{VIGIA_VISIBLE_NAMES\.tenders\}/, 'El CTA principal visible debe llamarse Vig-IA Licitaciones.');
assert.doesNotMatch(analysisSection, /tender-analysis-technical|Ejecutar AGT-002 Preview/, 'El identificador técnico interno no debe renderizarse en la vista operativa.');
assert.match(analysisSection, /const actionLabel = failed \|\| stale \? `Volver a analizar con \$\{VIGIA_VISIBLE_NAMES\.tenders\}` : analysis \? `Actualizar con \$\{VIGIA_VISIBLE_NAMES\.tenders\}` : `Analizar con \$\{VIGIA_VISIBLE_NAMES\.tenders\}`/, 'El CTA debe cubrir análisis, actualización y reintento usando Vig-IA Licitaciones.');
assert.match(analysisSection, /\{busy \? 'Procesando…' : actionLabel\}/, 'El botón primario debe renderizar la etiqueta canónica calculada.');

// The recommendation shown in the preliminary brief must be a translated Spanish
// business label, never a raw internal code like advance_conditionally.
assert.match(analysisSection, /tenderRecommendationLabel\(analysis\.recommendation\)/, 'La recomendación preliminar debe traducirse a una etiqueta de negocio.');
assert.doesNotMatch(analysisSection, /\{analysis\.recommendation \|\| 'Requiere revisión'\}/, 'No debe quedar el valor crudo interno de recomendación.');

// Status/help messages must speak of Vig-IA Licitaciones, not surface "AGT-002" as the visible actor.
assert.doesNotMatch(analysisSection, /AGT-002 produjo/, 'El mensaje de revisión humana no debe nombrar AGT-002 como actor visible.');
assert.doesNotMatch(analysisSection, /AGT-002 no estuvo disponible/, 'El mensaje de fallback no debe nombrar AGT-002 como actor visible.');
assert.match(analysisSection, /No registra ni autoriza GO \/ NO GO/, 'Debe conservarse una única frase clara sobre autoridad humana.');
assert.doesNotMatch(analysisSection, /Vig-IA produjo una recomendación preliminar/, 'No debe reaparecer la explicación duplicada de productor en la vista operativa.');
assert.match(analysisSection, /\{VIGIA_VISIBLE_NAMES\.tenders\} no estuvo disponible/, 'La limitación material por fallback debe conservar una única señal visible.');

// GO/NO GO panel: the recommendation disclaimer must speak of Vig-IA Licitaciones, not AGT-002.
assert.doesNotMatch(goNoGoPanel, /AGT-002 recomienda/, 'El panel de decisión no debe mostrar "AGT-002 recomienda" como mensaje principal.');
assert.match(goNoGoPanel, /\{VIGIA_VISIBLE_NAMES\.tenders\} recomienda/, 'El panel de decisión debe mostrar "Vig-IA Licitaciones recomienda".');

// main.tsx status copy for the AGT-002-preview trigger must speak of Vig-IA Licitaciones.
assert.doesNotMatch(main, /'Ejecutando AGT-002 Preview con revisión humana obligatoria…'/, 'El texto de estado no debe nombrar AGT-002 como actor visible.');
assert.doesNotMatch(main, /'AGT-002 no estuvo disponible; se aplicó fallback seguro por reglas\.'/, 'El texto de estado no debe nombrar AGT-002 como actor visible.');
assert.doesNotMatch(main, /'AGT-002 Preview completado\. La recomendación requiere revisión humana\.'/, 'El texto de estado no debe nombrar AGT-002 como actor visible.');
assert.match(main, /Preparando análisis con \$\{VIGIA_VISIBLE_NAMES\.tenders\}/, 'El texto de estado inicial debe nombrar a Vig-IA Licitaciones.');
assert.match(main, /Análisis en curso con \$\{VIGIA_VISIBLE_NAMES\.tenders\}/, 'El texto de ejecución debe nombrar a Vig-IA Licitaciones.');
assert.match(main, /\$\{VIGIA_VISIBLE_NAMES\.tenders\} no estuvo disponible; se aplicó fallback seguro por reglas\./, 'El texto de fallback debe nombrar a Vig-IA Licitaciones.');
assert.match(main, /\$\{VIGIA_VISIBLE_NAMES\.tenders\} completó el análisis\. La recomendación requiere revisión humana\./, 'El texto de éxito debe nombrar a Vig-IA Licitaciones.');

console.log('tender Vig-IA language checks passed');
