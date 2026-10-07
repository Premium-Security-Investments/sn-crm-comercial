import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

// Mi día del comercial (MyDayHome): cola de decisiones, Hacer hoy / Preparar, una línea de meta y un solo "Ver más".
const start = main.indexOf('function MyDayHome(');
const end = main.indexOf('\nfunction ', start + 10);
assert.ok(start > 0, 'MyDayHome debe existir');
const myDay = main.slice(start, end);

for (const marker of [
  'GoalVsActualDashboard',
  'CommercialPersonalDashboard',
  "data.currentProfile.role === 'comercial'",
]) assert.ok(main.includes(marker), `main.tsx missing marker: ${marker}`);
assert.ok(main.includes('function CommercialPersonalDashboard({ data, refresh }: { data: Bootstrap; refresh: () => Promise<void> }) { return <MyDayHome data={data} refresh={refresh} />; }'), 'el inicio del comercial es MyDayHome');
assert.ok(main.includes('return <CommercialPersonalDashboard data={data} refresh={refresh} />;'), 'el comercial llega a su Mi día');

const queue = myDay.indexOf('<DecisionQueue');
const groups = myDay.indexOf('<MyDayGroup title="Hacer hoy"');
const goal = myDay.indexOf('Meta del mes:');
const more = myDay.indexOf('<summary>Ver más</summary>');
assert.ok(queue > 0 && queue < groups && groups < goal && goal < more, 'orden: decidir, hacer hoy, meta, ver más');
assert.match(myDay, /<a href="#\/goals">Ver mi meta →<\/a>/);
assert.match(myDay, /Detalle por etapa/);
assert.match(myDay, /KPIs mensuales/);
assert.match(myDay, /Crea tu primera oportunidad/, 'sin oportunidades: invitación a crear la primera');
assert.doesNotMatch(myDay, /dashboard/i, 'el comercial no tiene Dashboard: Mi día no lo enlaza');
for (const removed of ['Mi prioridad de hoy', 'Mis oportunidades críticas', 'personalFollowUpCards', 'Mi avance contra meta']) {
  assert.ok(!main.includes(removed), `duplicado retirado: ${removed}`);
}
assert.ok(!myDay.includes('className="grid kpis') && !myDay.includes('Oportunidades del consultor'), 'Mi día no repite la grilla de KPIs ni la lista completa');
assert.ok(!main.includes('Score comercial configurable'), 'Score comercial configurable sigue fuera de la UI');
for (const marker of ['.goal-vs-actual-grid', '.goal-progress-card', '.my-day-goal-line', '.my-day-more']) assert.ok(css.includes(marker), `styles.css missing marker: ${marker}`);

console.log('dashboard final P0 static checks passed');
