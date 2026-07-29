import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const analysisSection = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');
const goNoGoPanel = readFileSync(new URL('../src/tenders/components/TenderGoNoGoDecisionPanel.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

// D. Public-facing copy must call the agent "Vig-IA"; AGT-001/AGT-002 stay only as
// internal/audit IDs inside collapsible technical details, never as the primary
// CTA or the headline of a status message.
assert.match(analysisSection, /Analizar con Vig-IA/, 'El CTA principal visible debe llamarse Vig-IA.');
assert.match(analysisSection, /<details className="tender-analysis-technical">/, 'El nombre técnico AGT-002 debe vivir en un detalle colapsable.');
const technicalStart = analysisSection.indexOf('<details className="tender-analysis-technical">');
const technicalEnd = analysisSection.indexOf('</details>', technicalStart);
const technicalBlock = analysisSection.slice(technicalStart, technicalEnd);
assert.match(technicalBlock, /Ejecutar AGT-002 Preview/, 'El identificador técnico interno debe seguir siendo auditable dentro del detalle colapsable.');
// The literal preview action name must still exist for the existing AGT-002 surface
// contract, but only inside the technical/collapsible zone above, not as visible CTA text.
assert.match(analysisSection, /Ejecutar AGT-002 Preview/, 'El identificador técnico debe seguir presente en el archivo (contrato AGT-002 preview).');
assert.match(analysisSection, /const actionLabel = failed \|\| stale \? 'Volver a analizar con Vig-IA' : analysis \? 'Actualizar con Vig-IA' : 'Analizar con Vig-IA'/, 'El CTA debe cubrir análisis, actualización y reintento usando solo Vig-IA.');
assert.match(analysisSection, /\{busy \? 'Procesando…' : actionLabel\}/, 'El botón primario debe renderizar la etiqueta canónica calculada.');

// The recommendation shown in the preliminary brief must be a translated Spanish
// business label, never a raw internal code like advance_conditionally.
assert.match(analysisSection, /tenderRecommendationLabel\(analysis\.recommendation\)/, 'La recomendación preliminar debe traducirse a una etiqueta de negocio.');
assert.doesNotMatch(analysisSection, /\{analysis\.recommendation \|\| 'Requiere revisión'\}/, 'No debe quedar el valor crudo interno de recomendación.');

// Status/help messages must speak of Vig-IA, not surface "AGT-002" as the visible actor.
assert.doesNotMatch(analysisSection, /AGT-002 produjo/, 'El mensaje de revisión humana no debe nombrar AGT-002 como actor visible.');
assert.doesNotMatch(analysisSection, /AGT-002 no estuvo disponible/, 'El mensaje de fallback no debe nombrar AGT-002 como actor visible.');
assert.match(analysisSection, /Vig-IA produjo una recomendación preliminar/, 'El mensaje de revisión humana debe nombrar a Vig-IA.');
assert.match(analysisSection, /Vig-IA no estuvo disponible/, 'El mensaje de fallback debe nombrar a Vig-IA.');

// GO/NO GO panel: the recommendation disclaimer must speak of Vig-IA, not AGT-002.
assert.doesNotMatch(goNoGoPanel, /AGT-002 recomienda/, 'El panel de decisión no debe mostrar "AGT-002 recomienda" como mensaje principal.');
assert.match(goNoGoPanel, /Vig-IA recomienda/, 'El panel de decisión debe mostrar "Vig-IA recomienda".');

// main.tsx status copy for the AGT-002-preview trigger must speak of Vig-IA.
assert.doesNotMatch(main, /'Ejecutando AGT-002 Preview con revisión humana obligatoria…'/, 'El texto de estado no debe nombrar AGT-002 como actor visible.');
assert.doesNotMatch(main, /'AGT-002 no estuvo disponible; se aplicó fallback seguro por reglas\.'/, 'El texto de estado no debe nombrar AGT-002 como actor visible.');
assert.doesNotMatch(main, /'AGT-002 Preview completado\. La recomendación requiere revisión humana\.'/, 'El texto de estado no debe nombrar AGT-002 como actor visible.');
assert.match(main, /Analizando con Vig-IA/, 'El texto de estado debe nombrar a Vig-IA.');
assert.match(main, /Vig-IA no estuvo disponible; se aplicó fallback seguro por reglas\./, 'El texto de fallback debe nombrar a Vig-IA.');
assert.match(main, /Vig-IA completó el análisis\. La recomendación requiere revisión humana\./, 'El texto de éxito debe nombrar a Vig-IA.');

console.log('tender Vig-IA language checks passed');
