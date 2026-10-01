// Helper puro de días hábiles de Colombia, usado por el eje D (Tiempo) de
// tender-fit-v2. Sin reloj ni aleatoriedad: misma entrada, misma salida siempre.
// Los festivos se calculan algorítmicamente para cualquier año (Pascua +
// reglas de traslado de la Ley Emiliani), de modo que el fixture exportado en
// tender-fit-v2-parameters.js (COLOMBIA_HOLIDAYS_2026) sea un caso particular
// que debe coincidir exactamente con este cálculo.

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function parseIsoDate(dateIso) {
  if (typeof dateIso !== 'string') {
    throw new TypeError(`fecha inválida: se esperaba un string YYYY-MM-DD, se recibió ${typeof dateIso}`);
  }
  const match = ISO_DATE_RE.exec(dateIso);
  if (!match) {
    throw new TypeError(`fecha inválida: "${dateIso}" no tiene el formato YYYY-MM-DD`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) {
    throw new TypeError(`fecha inválida: "${dateIso}" tiene un mes fuera de rango (01-12)`);
  }
  const maxDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  if (day < 1 || day > maxDay) {
    throw new TypeError(`fecha inválida: "${dateIso}" tiene un día fuera de rango para ese mes/año`);
  }
  return { year, month, day };
}

function toUtcSerial({ year, month, day }) {
  return Date.UTC(year, month - 1, day);
}

function serialToIso(serial) {
  const date = new Date(serial);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function weekdayOf(serial) {
  return new Date(serial).getUTCDay(); // 0=domingo ... 6=sábado
}

// Algoritmo de Gauss/Meeus-Jones-Butcher para el Domingo de Pascua (calendario gregoriano).
function computeEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 25);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toUtcSerial({ year, month, day });
}

// Traslada al lunes siguiente (Ley Emiliani); si ya cae en lunes, no se mueve.
function shiftToNextMonday(serial) {
  const weekday = weekdayOf(serial);
  const daysToAdd = (8 - weekday) % 7;
  return serial + daysToAdd * 86_400_000;
}

const holidaySetCache = new Map();

function computeHolidaySet(year) {
  const cached = holidaySetCache.get(year);
  if (cached) return cached;

  const easter = computeEasterSunday(year);
  const dayMs = 86_400_000;

  const fixedNonShiftable = [
    toUtcSerial({ year, month: 1, day: 1 }),
    toUtcSerial({ year, month: 5, day: 1 }),
    toUtcSerial({ year, month: 7, day: 20 }),
    toUtcSerial({ year, month: 8, day: 7 }),
    toUtcSerial({ year, month: 12, day: 8 }),
    toUtcSerial({ year, month: 12, day: 25 }),
  ];

  const easterBasedNonShiftable = [
    easter - 3 * dayMs, // Jueves Santo
    easter - 2 * dayMs, // Viernes Santo
  ];

  const shiftableFixed = [
    toUtcSerial({ year, month: 1, day: 6 }), // Reyes Magos
    toUtcSerial({ year, month: 3, day: 19 }), // San José
    toUtcSerial({ year, month: 6, day: 29 }), // San Pedro y San Pablo
    toUtcSerial({ year, month: 8, day: 15 }), // Asunción de la Virgen
    toUtcSerial({ year, month: 10, day: 12 }), // Día de la Raza
    toUtcSerial({ year, month: 11, day: 1 }), // Todos los Santos
    toUtcSerial({ year, month: 11, day: 11 }), // Independencia de Cartagena
  ];

  const shiftableEasterBased = [
    easter + 39 * dayMs, // Ascensión del Señor
    easter + 60 * dayMs, // Corpus Christi
    easter + 68 * dayMs, // Sagrado Corazón de Jesús
  ];

  // Ley 2578 de 2026, vigente desde el 1 de junio de 2026: Nuestra Señora
  // del Rosario de Chiquinquirá se observa el lunes siguiente al 9 de julio.
  const chiquinquiraHoliday = year >= 2026
    ? [toUtcSerial({ year, month: 7, day: 9 })]
    : [];

  const serials = [
    ...fixedNonShiftable,
    ...easterBasedNonShiftable,
    ...shiftableFixed.map(shiftToNextMonday),
    ...shiftableEasterBased.map(shiftToNextMonday),
    ...chiquinquiraHoliday.map(shiftToNextMonday),
  ];

  const isoSet = new Set(serials.map(serialToIso));
  holidaySetCache.set(year, isoSet);
  return isoSet;
}

export function isColombiaBusinessDay(dateIso) {
  const parsed = parseIsoDate(dateIso);
  const serial = toUtcSerial(parsed);
  const weekday = weekdayOf(serial);
  if (weekday === 0 || weekday === 6) return false;
  return !computeHolidaySet(parsed.year).has(dateIso);
}

export function countColombiaBusinessDays(evaluationDateIso, closingDateIso) {
  const evaluation = parseIsoDate(evaluationDateIso);
  const closing = parseIsoDate(closingDateIso);
  const evaluationSerial = toUtcSerial(evaluation);
  const closingSerial = toUtcSerial(closing);
  if (closingSerial <= evaluationSerial) return 0;

  const dayMs = 86_400_000;
  let count = 0;
  for (let serial = evaluationSerial + dayMs; serial < closingSerial; serial += dayMs) {
    if (isColombiaBusinessDay(serialToIso(serial))) count += 1;
  }
  return count;
}
