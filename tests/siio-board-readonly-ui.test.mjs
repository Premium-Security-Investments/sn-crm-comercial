import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync(new URL('../src/siio/SiioDashboard.tsx', import.meta.url), 'utf8');
const boardReadonly = readFileSync(new URL('../src/siio/SiioBoardReadonlyView.tsx', import.meta.url), 'utf8');

assert.match(dashboard, /currentProfile\.role === 'junta'[\s\S]{0,600}?return <SiioBoardReadonlyView payload=\{payload\} status=\{status\} onRetry=\{load\} \/>/, 'Junta must branch before the management dashboard and render its dedicated read-only view.');
assert.match(dashboard, /useEffect\(\(\) => \{[\s\S]{0,220}if \(!isManagementRole\(currentProfile\.role\) && currentProfile\.role !== 'junta'\) return;[\s\S]{0,120}void load\(\);/, 'Junta must load the reduced bootstrap payload instead of being blocked before loading.');

assert.match(boardReadonly, /payload\.boardReports/, 'The Junta view must consume only boardReports from bootstrap.');
assert.match(boardReadonly, /period_month/, 'The Junta view must render each report period.');
assert.match(boardReadonly, /report\.status/, 'The Junta view must render each report status.');
assert.match(boardReadonly, /report\.summary/, 'The Junta view must render each report summary.');
assert.match(boardReadonly, /Cargando reportes publicados/, 'The Junta view must provide a loading state.');
assert.match(boardReadonly, /No hay informes publicados/, 'The Junta view must provide an empty state.');
assert.match(boardReadonly, /onRetry/, 'The Junta view must provide an error retry action.');
assert.doesNotMatch(boardReadonly, /SiioNavigation|SiioExecutiveView|SiioManagementTrackingView|SiioSourcesIntelligenceView|SiioAgentsView|SiioBoardDraftAction/, 'The dedicated Junta branch must not mount operational SIIO surfaces.');
assert.doesNotMatch(boardReadonly, /Preparar informe de Junta|<button[^>]*>[^<]*(?:Crear|Editar|Guardar|Eliminar)/i, 'The dedicated Junta branch must not offer operational mutations or Board-draft preparation.');

console.log('SIIO Junta read-only UI contract passed');
