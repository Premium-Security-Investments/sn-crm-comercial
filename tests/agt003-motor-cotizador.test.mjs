// AGT-003 — motor de los cotizadores (vigilancia y tecnología). Juan, 2026-11-10 y 2026-11-11.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GUARD_RATES, QuoteInputError, coveredDays, militaryToHours, quoteGuardPost, quoteTechLine, quoteTotals, splitDayNight,
} from '../src/vigia/quote-engine.js';

// La fórmula de la página que usaban los comerciales (crimson-carolann-62.tiiny.site), copiada de su código el
// 2026-11-10, para comparar. Los guardas sólo sumaban $500 a la base de 24 h.
function paginaAnterior(factor, smlmv, pct, dias, hI, hF, guardas) {
  const P_DIA = 0.4759, P_NOCHE = 0.5241, J_DIA = 13, J_NOCHE = 11, A = 6, B = 19;
  let d = 0, n = 0;
  if (hI <= hF) { d = Math.max(0, Math.min(hF, B) - Math.max(hI, A)); n = (hF - hI) - d; }
  else { d = Math.max(0, Math.min(24, B) - Math.max(hI, A)) + Math.max(0, Math.min(hF, B) - Math.max(0, A)); n = ((24 - hI) + hF) - d; }
  const base = smlmv * factor + guardas * 500;
  const vd = d > 0 ? base * P_DIA / 30 * dias / J_DIA * d : 0;
  const vn = n > 0 ? base * P_NOCHE / 30 * dias / J_NOCHE * n : 0;
  const subtotal = (vd + vn) * (1 + pct);
  return { subtotal, total: subtotal + subtotal * 0.10 * 0.19 };
}
const TODOS = ['lunes_a_viernes', 'sabados', 'domingos', 'festivos'];
const SIN_SEGURO = { ...DEFAULT_GUARD_RATES, lifeInsurancePerGuard: 0 };

test('horas militares: válidas, 24 horas e imposibles', () => {
  assert.equal(militaryToHours('0630'), 6.5);
  assert.equal(militaryToHours('6'), 6);
  assert.equal(militaryToHours('18:30'), 18.5);
  assert.equal(militaryToHours('2400'), 24);
  assert.throws(() => militaryToHours('0675'), /minutos van de 00 a 59/);
  assert.throws(() => militaryToHours('2430'), /pasa de 2400/);
  assert.throws(() => militaryToHours('seis'), QuoteInputError);
});

test('día y noche: la noche empieza a las 7 p. m.; inicio igual a fin es un turno de 24 horas', () => {
  assert.deepEqual(splitDayNight(6, 18), { dayHours: 12, nightHours: 0, totalHours: 12 });
  assert.deepEqual(splitDayNight(18, 6), { dayHours: 1, nightHours: 11, totalHours: 12 });
  assert.deepEqual(splitDayNight(0, 24), { dayHours: 13, nightHours: 11, totalHours: 24 });
  assert.deepEqual(splitDayNight(6, 6), { dayHours: 13, nightHours: 11, totalHours: 24 }, '0600 a 0600 ya no da cero');
  assert.deepEqual(splitDayNight(22, 2), { dayHours: 0, nightHours: 4, totalHours: 4 });
});

test('días: 20 de lunes a viernes, 4 sábados, 4 domingos, 2 festivos', () => {
  assert.equal(coveredDays(TODOS), 30);
  assert.equal(coveredDays(['lunes_a_viernes']), 20);
  assert.equal(coveredDays(['lunes_a_viernes', 'sabados']), 24);
  assert.throws(() => coveredDays([]), /al menos un tipo de día/);
  assert.throws(() => coveredDays(['martes']), /no reconocido/);
});

test('sin el seguro, el motor da lo mismo que la página anterior (24 h, 12 h día, 12 h noche, 20 días)', () => {
  const casos = [
    [{ start: '0000', end: '2400', dayTypes: TODOS }, 0, 24, 30],
    [{ start: '0600', end: '1800', dayTypes: TODOS }, 6, 18, 30],
    [{ start: '1800', end: '0600', dayTypes: TODOS }, 18, 6, 30],
    [{ start: '0700', end: '1900', dayTypes: ['lunes_a_viernes'] }, 7, 19, 20],
  ];
  for (const [post, hI, hF, dias] of casos) {
    const nuevo = quoteGuardPost({ ...post, guards: 1, modality: 'con_arma' }, SIN_SEGURO);
    const viejo = paginaAnterior(10.21, 1750905, 0.10, dias, hI, hF, 0);
    assert.ok(Math.abs(nuevo.subtotal - viejo.subtotal) <= 1, `${post.start}-${post.end}: ${nuevo.subtotal} vs ${viejo.subtotal}`);
    assert.ok(Math.abs(nuevo.total - viejo.total) <= 1);
  }
});

test('24 horas con arma, 3 guardas: el seguro va completo y lleva modalidad e IVA', () => {
  const r = quoteGuardPost({ start: '0600', end: '0600', dayTypes: TODOS, guards: 3, modality: 'con_arma' });
  assert.equal(r.days, 30);
  assert.equal(r.lifeInsurance, 1500);
  const base = 1750905 * 10.21;
  assert.equal(r.subtotal, Math.round((base + 1500) * 1.10));
  assert.equal(r.aiu, Math.round(r.subtotal * 0.10));
  assert.equal(r.total, Math.round((base + 1500) * 1.10 * (1 + 0.10 * 0.19)));
});

test('el seguro no se prorratea: 12 h de noche con 2 guardas cobra los $1.000 completos', () => {
  const con = quoteGuardPost({ start: '1800', end: '0600', dayTypes: TODOS, guards: 2, modality: 'sin_arma' });
  const sin = quoteGuardPost({ start: '1800', end: '0600', dayTypes: TODOS, guards: 2, modality: 'sin_arma' }, SIN_SEGURO);
  assert.equal(con.subtotal - sin.subtotal, Math.round(1000 * 1.08));
});

test('modalidad y guardas se validan', () => {
  assert.throws(() => quoteGuardPost({ start: '0600', end: '1800', dayTypes: TODOS, guards: 1, modality: 'tanque' }), /modalidad/);
  assert.throws(() => quoteGuardPost({ start: '0600', end: '1800', dayTypes: TODOS, guards: 0, modality: 'canino' }), /1 a 50/);
});

// Hoja "Panasa" de TABLA_DE_COSTOS_PARKING.xlsx: costos unitarios y cantidades del Excel del comercial.
const PANASA = [
  ['equipo', 8, 981647], ['equipo', 2, 899904], ['equipo', 2, 2941673], ['equipo', 1, 3900315], ['equipo', 1, 3980000],
  ['equipo', 6, 1735093], ['equipo', 6, 290000], ['equipo', 3, 1550000], ['insumo', 1, 4500000], ['mano_de_obra', 1, 12000000],
].map(([category, quantity, unitCost]) => ({ category, quantity, unitCost }));

test('tecnología: precio = costo / 0,65 e IVA del 19 % sobre todo; coincide con el Excel de Papeles Nacionales', () => {
  const r = quoteTotals({ techLines: PANASA });
  assert.ok(Math.abs(r.oneTime.subtotal - 87257235) <= 5, `subtotal ${r.oneTime.subtotal}`);
  assert.equal(r.oneTime.cost, 56717203);
  assert.ok(Math.abs(r.oneTime.equipmentPrice - 61872620) <= 5, 'base de la comisión: venta de los equipos');
  assert.equal(r.oneTime.iva, Math.round(r.oneTime.subtotal * 0.19));
  assert.equal(quoteTechLine({ category: 'equipo', quantity: 1, unitCost: 650 }).unitPrice, 1000);
  assert.throws(() => quoteTechLine({ category: 'servicio', quantity: 1, unitCost: 1 }), /equipo, insumo o mano de obra/);
});

test('cotización mixta: lo mensual y lo de una vez van separados', () => {
  const r = quoteTotals({
    guardPosts: [{ start: '0600', end: '0600', dayTypes: TODOS, guards: 3, modality: 'con_arma' }],
    techLines: [{ category: 'equipo', quantity: 2, unitCost: 650 }, { category: 'mano_de_obra', quantity: 1, unitCost: 325 }],
  });
  assert.equal(r.posts.length, 1);
  assert.equal(r.monthly.total, r.posts[0].total);
  assert.equal(r.oneTime.subtotal, 2500);
  assert.equal(r.oneTime.equipmentPrice, 2000);
  assert.equal(r.oneTime.total, 2500 + 475);
});
