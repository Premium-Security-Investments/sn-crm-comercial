// AGT-003 — Motor de cálculo de los cotizadores (Juan, 2026-11-10 y 2026-11-11).
//
// Regla única para el servidor y las pantallas. Módulo puro: sin red, sin base, sin reloj implícito, y no altera lo
// que recibe. Las tarifas NO viven aquí: llegan como parámetro (las define Juan en la pantalla de tarifas, con su
// vigencia), así que el día que la Superintendencia publique las de 2027 no se toca código.
//
// Dos tipos de cotización, que pueden ir juntos en una misma propuesta:
//   · Vigilancia: puestos de guardas. Se cobra cada mes.
//   · Tecnología: equipos, insumos y mano de obra. Se paga una vez.
//
// Reglas de vigilancia, definidas con Juan y con el área de tarifas (2026-11-11):
//   1. Base de 24 h al mes = SMLMV × factor de la Superintendencia (10,21 desde el 15 de julio de 2026).
//   2. Reparto de la Superintendencia: 47,59 % día (13 h, de 06:00 a 19:00) y 52,41 % noche (11 h). Se cobra por las
//      horas que cubre el puesto. La jornada nocturna empieza a las 7 p. m. (reforma laboral).
//   3. Días: el mes son 20 de lunes a viernes + 4 sábados + 4 domingos + 2 festivos = 30. El comercial marca qué cubre
//      el puesto y se cobra en proporción sobre 30.
//   4. Modalidad (% de la Superintendencia): 8 % sin arma, 10 % con arma, 11 % canino.
//   5. Seguro de vida: valor por guarda al mes, COMPLETO, sin prorratear por horas, días ni turno. Lleva la modalidad y
//      el IVA como el resto del servicio. (La página anterior lo prorrateaba con la base de 24 h.)
//   6. AIU = 10 % del subtotal; IVA = 19 % del AIU; total = subtotal + IVA.
//   7. No hay mínimo de horas ni de valor por puesto.
//   Un puesto de "0600 a 0600" es de 24 horas (la página anterior lo cotizaba en $0, sin aviso).
//
// Reglas de tecnología (Juan, 2026-11-11): precio = costo / (1 − margen), con margen del 35 % para todo por ahora; IVA
// del 19 % sobre todo el subtotal, sin AIU. La base de la comisión de un proyecto es el precio de venta de los EQUIPOS
// antes de IVA, sin insumos ni mano de obra.

export const GUARD_DAY_TYPES = Object.freeze([
  Object.freeze({ code: 'lunes_a_viernes', label: 'Lunes a viernes', days: 20 }),
  Object.freeze({ code: 'sabados', label: 'Sábados', days: 4 }),
  Object.freeze({ code: 'domingos', label: 'Domingos', days: 4 }),
  Object.freeze({ code: 'festivos', label: 'Festivos', days: 2 }),
]);
export const MONTH_DAYS = 30;
export const GUARD_MODALITIES = Object.freeze(['sin_arma', 'con_arma', 'canino']);
export const TECH_CATEGORIES = Object.freeze(['equipo', 'insumo', 'mano_de_obra']);

/** Tarifas con las que arranca el sistema (2026). En producción las reemplaza la pantalla de tarifas. */
export const DEFAULT_GUARD_RATES = Object.freeze({
  smlmv: 1750905,
  factor: 10.21,
  dayShare: 0.4759,
  nightShare: 0.5241,
  dayStartHour: 6,
  dayEndHour: 19,
  modalities: Object.freeze({ sin_arma: 0.08, con_arma: 0.10, canino: 0.11 }),
  lifeInsurancePerGuard: 500,
  aiuRate: 0.10,
  ivaRate: 0.19,
});
export const DEFAULT_TECH_RATES = Object.freeze({ margin: 0.35, ivaRate: 0.19 });

export class QuoteInputError extends Error {
  constructor(message) { super(message); this.name = 'QuoteInputError'; this.status = 400; }
}
const fail = message => { throw new QuoteInputError(message); };

/**
 * Hora militar ("0630", "1900", "2400", "6", "18", "06:30") → horas decimales. Rechaza lo imposible (minutos de 60 en
 * adelante, más de 24 horas) en vez de calcular con eso.
 */
export function militaryToHours(value) {
  const raw = String(value ?? '').replace(':', '').trim();
  if (!/^\d{1,4}$/.test(raw)) fail(`La hora "${value ?? ''}" no es válida. Use cuatro dígitos, por ejemplo 0630.`);
  const text = raw.length <= 2 ? `${raw.padStart(2, '0')}00` : raw.padStart(4, '0');
  const hours = Number(text.slice(0, 2));
  const minutes = Number(text.slice(2, 4));
  if (minutes > 59) fail(`La hora "${value}" tiene ${minutes} minutos: los minutos van de 00 a 59.`);
  if (hours > 24 || (hours === 24 && minutes > 0)) fail(`La hora "${value}" pasa de 2400.`);
  return hours + minutes / 60;
}

/** Horas de día y de noche entre inicio y fin. Inicio igual a fin es un turno de 24 horas. */
export function splitDayNight(startHours, endHours, { dayStartHour = 6, dayEndHour = 19 } = {}) {
  const start = startHours % 24;
  let end = endHours % 24;
  if (end === start) end = start + 24;
  else if (end < start) end += 24;
  const overlap = (a, b, c, d) => Math.max(0, Math.min(b, d) - Math.max(a, c));
  let day = 0;
  for (const offset of [0, 24]) day += overlap(start, end, dayStartHour + offset, dayEndHour + offset);
  const total = end - start;
  return { dayHours: day, nightHours: total - day, totalHours: total };
}

/** Días cubiertos en el mes según los tipos de día marcados. */
export function coveredDays(dayTypes) {
  const marked = new Set(Array.isArray(dayTypes) ? dayTypes : []);
  for (const code of marked) if (!GUARD_DAY_TYPES.some(type => type.code === code)) fail(`Tipo de día no reconocido: ${code}.`);
  const days = GUARD_DAY_TYPES.filter(type => marked.has(type.code)).reduce((sum, type) => sum + type.days, 0);
  if (!days) fail('Marque al menos un tipo de día que cubre el puesto.');
  return days;
}

const round = value => Math.round(value);

/**
 * Un puesto de vigilancia: `{ name, start, end, dayTypes, guards, modality }` con las tarifas vigentes.
 * Devuelve las horas, los días y el dinero del mes, cada parte por separado.
 */
export function quoteGuardPost(post = {}, rates = DEFAULT_GUARD_RATES) {
  const guards = Number(post.guards);
  if (!Number.isInteger(guards) || guards < 1 || guards > 50) fail('El número de guardas va de 1 a 50.');
  const modalityRate = rates.modalities?.[post.modality];
  if (typeof modalityRate !== 'number') fail('Escoja la modalidad: sin arma, con arma o canino.');
  const hours = splitDayNight(militaryToHours(post.start), militaryToHours(post.end), rates);
  const days = coveredDays(post.dayTypes);
  const base24h = rates.smlmv * rates.factor;
  const dayValue = hours.dayHours > 0 ? (base24h * rates.dayShare / MONTH_DAYS) * days / (rates.dayEndHour - rates.dayStartHour) * hours.dayHours : 0;
  const nightHoursInDay = 24 - (rates.dayEndHour - rates.dayStartHour);
  const nightValue = hours.nightHours > 0 ? (base24h * rates.nightShare / MONTH_DAYS) * days / nightHoursInDay * hours.nightHours : 0;
  const service = dayValue + nightValue;
  const lifeInsurance = guards * rates.lifeInsurancePerGuard;
  const subtotal = (service + lifeInsurance) * (1 + modalityRate);
  const aiu = subtotal * rates.aiuRate;
  const iva = aiu * rates.ivaRate;
  return Object.freeze({
    kind: 'vigilancia',
    name: String(post.name || '').trim() || null,
    ...hours,
    days,
    guards,
    modality: post.modality,
    modalityRate,
    service: round(service),
    lifeInsurance: round(lifeInsurance),
    subtotal: round(subtotal),
    aiu: round(aiu),
    iva: round(iva),
    total: round(subtotal + iva),
  });
}

/** Una línea de tecnología: `{ description, category, quantity, unitCost }`. El precio sale del costo y el margen. */
export function quoteTechLine(line = {}, rates = DEFAULT_TECH_RATES) {
  if (!TECH_CATEGORIES.includes(line.category)) fail('Cada línea es equipo, insumo o mano de obra.');
  const quantity = Number(line.quantity);
  const unitCost = Number(line.unitCost);
  if (!Number.isFinite(quantity) || quantity <= 0) fail('La cantidad tiene que ser mayor que cero.');
  if (!Number.isFinite(unitCost) || unitCost < 0) fail('El costo unitario no puede ser negativo.');
  if (!(rates.margin >= 0 && rates.margin < 1)) fail('El margen tiene que estar entre 0 y 1.');
  const unitPrice = unitCost / (1 - rates.margin);
  return Object.freeze({
    kind: 'tecnologia',
    description: String(line.description || '').trim() || null,
    category: line.category,
    quantity,
    unitCost,
    cost: round(unitCost * quantity),
    unitPrice: round(unitPrice),
    price: round(unitPrice * quantity),
  });
}

/**
 * Una cotización completa, que puede mezclar los dos tipos. Lo mensual (vigilancia) y lo de una sola vez (tecnología)
 * van separados: se cobran distinto, llevan IVA distinto y pagan comisión con tablas distintas.
 */
export function quoteTotals({ guardPosts = [], techLines = [] } = {}, { guardRates = DEFAULT_GUARD_RATES, techRates = DEFAULT_TECH_RATES } = {}) {
  const posts = guardPosts.map(post => quoteGuardPost(post, guardRates));
  const lines = techLines.map(line => quoteTechLine(line, techRates));
  const sum = (list, key) => list.reduce((total, item) => total + item[key], 0);
  const techSubtotal = sum(lines, 'price');
  const techIva = round(techSubtotal * techRates.ivaRate);
  return Object.freeze({
    posts: Object.freeze(posts),
    lines: Object.freeze(lines),
    monthly: Object.freeze({ subtotal: sum(posts, 'subtotal'), aiu: sum(posts, 'aiu'), iva: sum(posts, 'iva'), total: sum(posts, 'total') }),
    oneTime: Object.freeze({
      subtotal: techSubtotal,
      iva: techIva,
      total: techSubtotal + techIva,
      cost: sum(lines, 'cost'),
      // Base de la comisión de tecnología: precio de venta de los equipos, sin insumos ni mano de obra.
      equipmentPrice: sum(lines.filter(line => line.category === 'equipo'), 'price'),
    }),
  });
}
