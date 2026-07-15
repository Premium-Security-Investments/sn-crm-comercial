import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync('src/main.tsx', 'utf8');
const dashboard = readFileSync('src/siio/SiioDashboard.tsx', 'utf8');
const navigation = readFileSync('src/siio/SiioNavigation.tsx', 'utf8');

for (const label of ['Resumen ejecutivo', 'Seguimiento gerencial', 'Fuentes e inteligencia', 'Agentes']) {
  assert.match(navigation, new RegExp(label));
}
assert.doesNotMatch(navigation, /F1-F6|Registro F2|Archivo F4|Razonamiento F5|Modo Junta/);
assert.match(dashboard, /api<SiioBootstrapPayload>\('\/api\/siio\/bootstrap'\)/);
assert.match(dashboard, /window\.addEventListener\('hashchange'/);
assert.match(dashboard, /isManagementRole\(currentProfile\.role\)/);
assert.match(main, /import \{ SiioDashboard \} from '\.\/siio\/SiioDashboard';/);
assert.match(main, /if \(route\.page === 'siio'\) return <SiioDashboard currentProfile=\{data\.currentProfile\} \/>/);
assert.doesNotMatch(main, /function SiioDashboard\(/);

const executive = readFileSync('src/siio/SiioExecutiveView.tsx', 'utf8');
const tracking = readFileSync('src/siio/SiioManagementTrackingView.tsx', 'utf8');
assert.match(executive, /period/);
assert.match(executive, /area/);
assert.match(tracking, /kind/);
assert.match(tracking, /semaphore/);
assert.match(tracking, /owner/);
assert.match(tracking, /Todos.*Decisiones.*Bloqueos.*Riesgos.*Compromisos/s);
assert.match(executive, /navigateSiioView\('seguimiento'/);
assert.match(executive, /navigateSiioView\('inteligencia'/);
assert.doesNotMatch(dashboard, /global.*filter/i);

const intelligence = readFileSync('src/siio/SiioSourcesIntelligenceView.tsx', 'utf8');
const agents = readFileSync('src/siio/SiioAgentsView.tsx', 'utf8');
for (const marker of ['Vigencia', 'Confianza', 'Tipo de fuente', 'Restricciones', 'Última revisión', 'Próxima revisión', 'Frentes relacionados', 'Pendiente de evidencia', 'Periodo pendiente', 'Evidencia', 'Fuentes', 'Periodo de origen', 'Acción recomendada']) {
  assert.match(intelligence, new RegExp(marker));
}
assert.match(intelligence, /filterSources/);
assert.match(intelligence, /deriveRecommendations/);
assert.equal((intelligence.match(/<select/g) || []).length, 3, 'intelligence must expose only its three contextual filters');
assert.match(intelligence, /source\.url \?/);
assert.doesNotMatch(intelligence, /\bonClick\b|\bapi\b/);
for (const marker of ['Propósito', 'Responsable institucional', 'Estado', 'Fuentes autorizadas', 'Acciones permitidas', 'Acciones prohibidas', 'Revisión humana obligatoria', 'Regla de auditoría', 'Siguiente gate', 'Sin escritura automática en producción']) {
  assert.match(agents, new RegExp(marker));
}
assert.match(agents, /SIIO_AGENT_CATALOG/);
assert.equal((agents.match(/<select/g) || []).length, 2, 'agents must expose only status and institutional-owner filters');
assert.match(agents, /routeState\.filters\.status/);
assert.match(agents, /routeState\.filters\.owner/);
assert.doesNotMatch(agents, /AGT-004|Asistente de Junta|\bonClick\b|\bapi\b/);
assert.match(dashboard, /SiioSourcesIntelligenceView/);
assert.match(dashboard, /SiioAgentsView/);

console.log('SIIO managerial navigation shell contract OK');
