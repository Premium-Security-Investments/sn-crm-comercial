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
  "if (route.page === 'dashboard2') return 'Dashboard comercial';",
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
assert.match(dashboard, /dashboard-footnote">Calidad de datos/);

// Pregunta 2: tabla de comportamiento desde el endpoint nuevo.
const behavior = main.slice(main.indexOf('function CommercialBehaviorTable('), start);
assert.match(behavior, /api<BehaviorReport & \{ lastSeenAvailable\?: boolean \}>\('\/api\/vigia\/commercial-behavior'\)/);
for (const header of ['Comercial', 'Último seguimiento', 'Seguimientos semana / 30 d', 'Decisiones semana', 'Pendientes de decidir', '% agenda al día', 'Último ingreso al CRM', 'Meta %', 'Estado']) {
  assert.ok(behavior.includes(`<th>${header}</th>`), `columna ${header}`);
}
assert.match(behavior, /title=\{row\.reason\}/, 'el estado explica el motivo al pasar el cursor');
assert.match(behavior, /behavior-explanation/, 'hay una explicación bajo la tabla');
assert.match(dashboard, /<CommercialBehaviorTable \/>/);

// Pregunta 3: grandes detenidos, congeladas que vuelven, motivos de pérdida y urgentes de prioridades (asíncrono).
for (const marker of ['Grandes y detenidos', 'Congeladas que vuelven en 14 días', 'Por qué perdemos (últimos 90 días)', 'Lo más urgente (Vig-IA Comercial)']) assert.ok(dashboard.includes(marker), marker);
assert.match(main, /api<CommercialPrioritiesPayload>\('\/api\/vigia\/priorities'\)/);
assert.match(dashboard, /priorities\.status === 'error' \? <p className="muted">Las prioridades no están disponibles/, 'si fallan las prioridades el tablero sigue');

// Lo retirado.
for (const removed of ['gerencial-v2-hero', 'v2HeroMetrics', 'projectionCardsV2', 'Proyección / presupuesto 2026', 'Lectura gerencial', 'Semáforos ejecutivos', 'Ranking por salud comercial', 'Tendencia comercial disponible', 'prioritiesHashFromDashboard', 'href="#/alerts']) {
  assert.ok(!dashboard.includes(removed), `el tablero ya no incluye ${removed}`);
}

assert.match(nav, /title: 'Comercial'[\s\S]{0,700}href: '#\/dashboard2', label: 'Dashboard comercial', page: 'dashboard2'/, 'Dashboard comercial pertenece al grupo Comercial del catálogo.');
assert.doesNotMatch(main, /href="#\/dashboard2">Dashboard comercial/, 'main.tsx no duplica el enlace del catálogo.');
for (const marker of ['.dashboard-v2', '.v2-kpi-grid', '.v2-kpi-card', '.v2-deal-list', '.v2-deal-row', '.behavior-table', '.dashboard-three-questions']) assert.ok(css.includes(marker), `styles.css missing ${marker}`);

console.log('manager-dashboard-v2 static checks passed');
