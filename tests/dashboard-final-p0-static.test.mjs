import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

// Mi día del comercial (MyDayHome), rediseño del 2026-10-22: una línea de estado, "Ahora" (lo que espera decisión
// y lo agendado para hoy, en un solo bloque), el chat compacto, "Esta semana" y la meta del mes.
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

const now = myDay.indexOf('<NowQueue');
const week = myDay.indexOf('<WeekList');
const goal = myDay.indexOf('<h3>Meta del mes</h3>');
assert.ok(now > 0 && now < week && week < goal, 'orden de las tres preguntas: qué hago ahora, qué viene, cómo voy');
assert.match(myDay, /<h2 className="my-day-headline">\{headline\}<\/h2>/, 'una sola frase de estado encabeza la pantalla');
assert.doesNotMatch(myDay, /executive-hero|<span className="eyebrow">Mi día<\/span>|Hola, \{/, 'sin saludo ni píldora: gastaban un cuarto de la pantalla (Juan, 2026-10-22)');
assert.doesNotMatch(myDay, /Buen momento para prospectar/, 'prospectar ya no es un bloque suelto: es la acción secundaria del vacío de "Ahora"');
assert.match(myDay, /<a href="#\/goals">Ver mi meta<\/a>/);
assert.doesNotMatch(myDay, /<summary>Ver más<\/summary>|KPIs mensuales|Detalle por etapa/, 'Mi día corto: sin "Ver más" (Juan, 2026-10-08)');
assert.match(myDay, /Crea tu primera oportunidad/, 'sin oportunidades: invitación a crear la primera');
assert.doesNotMatch(myDay, /dashboard/i, 'el comercial no tiene Dashboard: Mi día no lo enlaza');
for (const removed of ['Mi prioridad de hoy', 'Mis oportunidades críticas', 'personalFollowUpCards', 'Mi avance contra meta']) {
  assert.ok(!main.includes(removed), `duplicado retirado: ${removed}`);
}
assert.ok(!myDay.includes('className="grid kpis') && !myDay.includes('Oportunidades del consultor'), 'Mi día no repite la grilla de KPIs ni la lista completa');
assert.ok(!main.includes('Score comercial configurable'), 'Score comercial configurable sigue fuera de la UI');
for (const marker of ['.goal-vs-actual-grid', '.goal-progress-card', '.now-queue{', '.week-row{', '.goal-track{']) assert.ok(css.includes(marker), `styles.css missing marker: ${marker}`);
// La jerarquía es la propuesta aprobada: "Ahora" es la única superficie con sombra; el resto son filas planas.
assert.match(css, /\.now-queue\{background:#fff;border:1px solid #dfe6f1;border-radius:18px;box-shadow:/, '"Ahora" es la única superficie elevada');
assert.doesNotMatch(css, /\.week-row\{[^}]*box-shadow:0 1/, '"Esta semana" no lleva sombra: son filas planas');

console.log('dashboard final P0 static checks passed');
