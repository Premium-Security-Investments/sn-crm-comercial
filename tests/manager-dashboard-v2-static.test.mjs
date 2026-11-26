import fs from 'node:fs';
import assert from 'node:assert/strict';

// Dashboard comercial (decisión del dueño, 2026-10-07): de siete secciones a tres preguntas para el director comercial.
const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const nav = fs.readFileSync(new URL('../src/navPermissions.ts', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const start = main.indexOf('function ManagerDashboardV2(');
const end = main.indexOf('\nfunction MyDayHome(', start);
assert.ok(start > 0 && end > start, 'ManagerDashboardV2 debe existir antes de MyDayHome');
const dashboard = main.slice(start, end);

for (const marker of [
  "if (page === 'dashboard2') return { page: 'dashboard2' };",
  "if (route.page === 'dashboard2') return 'Dashboard';",
  "if (route.page === 'dashboard' || route.page === 'dashboard2') return <ManagerDashboardV2 data={data} refresh={refresh} />;",
  'function ManagerDashboardV2({ data, refresh }: { data: Bootstrap; refresh: () => Promise<void> })',
]) assert.ok(main.includes(marker), `main.tsx missing: ${marker}`);

const q1 = dashboard.indexOf('<h2>¿Vamos a llegar a la meta?</h2>');
const q2 = dashboard.indexOf('<h2>¿Quién necesita ayuda?</h2>');
const q3 = dashboard.indexOf('<h2>¿Qué negocios empujar esta semana?</h2>');
assert.ok(q1 > 0 && q1 < q2 && q2 < q3, 'las tres preguntas aparecen en orden');
assert.ok(dashboard.indexOf('<DeleteRequestsPanel') < q1, 'las solicitudes de eliminación quedan arriba');
assert.match(dashboard, /\{canResolveDelete && <DeleteRequestsPanel/, 'las solicitudes de eliminación dependen del permiso');
assert.match(dashboard, /className="v2-tender-aside" href="#\/tenders\?view=oportunidades"/, 'se conserva el enlace de licitaciones aparte');

// Pregunta 1: mes, año, negociación top 5, ventas por trimestre colapsadas y calidad de datos como nota.
assert.match(dashboard, /monthlyGoalCompliance\(\{ opportunities: allCommercialOpportunities, goals: data\.goals, month \}\)/);
assert.match(dashboard, /Meta del mes/);
assert.match(dashboard, /Meta del año/);
assert.match(dashboard, /Lo que está en negociación/);
assert.match(dashboard, /\.slice\(0, 5\);/);
assert.match(dashboard, /<details className="panel dashboard-details">\s*<summary>Ventas por comercial y trimestre/);
// Contrato del 2026-11-25 (Juan): la calidad de datos va junto a las cifras, y «en negociación» sólo trae lo que cierra pronto.
assert.match(dashboard, /dashboard-quality-line/);
assert.ok(dashboard.indexOf('dashboard-quality-line') < dashboard.indexOf('Lo que está en negociación'), 'la calidad de datos va antes de las listas');
assert.match(dashboard, /activeRows\.filter\(o => o\.stage_code === 'negociacion' \|\| o\.stage_code === 'sustentacion'\)/);

// Pregunta 2: tabla de comportamiento desde el endpoint nuevo.
const behavior = main.slice(main.indexOf('function CommercialBehaviorTable('), start);
assert.match(behavior, /api<BehaviorReport & \{ lastSeenAvailable\?: boolean \}>\('\/api\/vigia\/commercial-behavior'\)/);
for (const header of ['Comercial', 'Último seguimiento', 'Pendientes de decidir', 'Agenda al día', 'Meta del mes', 'Estado']) {
  assert.ok(behavior.includes(`<th>${header}</th>`), `columna ${header}`);
}
assert.match(behavior, /title=\{row\.reason\}/, 'el estado explica el motivo al pasar el cursor');
assert.match(behavior, /behavior-explanation/, 'hay una explicación bajo la tabla');
assert.match(dashboard, /<CommercialBehaviorTable \/>/);

// Pregunta 3 (contrato del 2026-11-25): una sola lista sin repetir los de arriba; Vig-IA sólo cuando su recomendación es
// propia; renovaciones y congeladas sólo si hay; las congeladas en $0 resumidas; perdidas sin las descartadas.
for (const marker of ['Negocios para mover', 'Congeladas que vuelven en 14 días', 'Por qué perdemos (últimos 90 días)']) assert.ok(dashboard.includes(marker), marker);
for (const removed of ['Grandes y detenidos', 'Lo más urgente (Vig-IA Comercial)', 'urgentRows']) assert.ok(!dashboard.includes(removed), `ya no: ${removed}`);
assert.match(main, /api<CommercialPrioritiesPayload>\('\/api\/vigia\/priorities'\)/);
assert.match(dashboard, /!shownAbove\.has\(row\.opportunity\.id\)/, 'no repite los de la pregunta 1');
assert.match(dashboard, /\(recommendationCount\.get\(row\.priority\.recommendation\) \|\| 0\) === 1/, 'Vig-IA sólo con recomendación propia');
assert.match(dashboard, /\{teamRenewals\.length > 0 && <Panel title="Renovaciones por vencer/);
assert.match(dashboard, /returningZero/);
assert.match(dashboard, /\.filter\(o => o\.stage_code === 'perdido' && /, 'perdidas sin descartadas');
assert.match(dashboard, /limpieza de cartera, no negocios perdidos/);
// Licitaciones activas = por decidir o en curso (sin NO-GO, cerradas ni archivadas), la regla del módulo.
assert.match(dashboard, /\['por_decidir', 'en_curso'\]\.includes\(classifyOpportunityStage\(/);

// Lo retirado.
for (const removed of ['gerencial-v2-hero', 'v2HeroMetrics', 'projectionCardsV2', 'Proyección / presupuesto 2026', 'Lectura gerencial', 'Semáforos ejecutivos', 'Ranking por salud comercial', 'Tendencia comercial disponible', 'prioritiesHashFromDashboard', 'href="#/alerts']) {
  assert.ok(!dashboard.includes(removed), `el tablero ya no incluye ${removed}`);
}

assert.match(nav, /title: 'Comercial'[\s\S]{0,700}href: '#\/dashboard2', label: 'Dashboard', page: 'dashboard2'/, 'Dashboard pertenece al grupo Comercial del catálogo.');
assert.doesNotMatch(main, /href="#\/dashboard2">Dashboard/, 'main.tsx no duplica el enlace del catálogo.');
for (const marker of ['.dashboard-v2', '.v2-kpi-grid', '.v2-kpi-card', '.v2-deal-list', '.v2-deal-row', '.behavior-table', '.dashboard-three-questions']) assert.ok(css.includes(marker), `styles.css missing ${marker}`);

console.log('manager-dashboard-v2 static checks passed');
