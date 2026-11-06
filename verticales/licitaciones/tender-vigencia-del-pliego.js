// Mejora 4 (encargo desde Terminal, 2026-11-04): la vigencia de cada documento se mide contra la regla de ESTE pliego.
//
// En TT-SPO-07: el RUP del 28-sep quedó fuera de la ventana de 30 días del pliego, y el expediente decía que el pliego
// no fijaba ventana; la certificación de multas y sanciones del 18-jun venció a los 90 días hábiles y nadie lo notó; el
// REDAM traía «válida hasta 01-12-2026» impreso y se iba a reexpedir sin necesidad.
//
// Aquí: la regla se lee del texto del requisito («no mayor a 90 días hábiles», «30 días calendario antes del cierre»,
// «tres (3) meses», «vigente al cierre») y se compara con las fechas del documento cargado. Criterio acordado con Juan
// (§8.4): si el pliego no dice la regla claro, «por confirmar»; nunca una fecha adivinada. Módulo puro.

const fold = value => String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const WORDS = { uno: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, ocho: 8, diez: 10, doce: 12, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, sesenta: 60, noventa: 90 };
const DAY = 86_400_000;

// «no mayor a noventa (90) días hábiles», «expedido dentro de los 30 días calendario anteriores», «máximo 3 meses».
const AGE_RULE = /(?:no (?:mayor|superior)(?: a| de)?|no (?:exceda|supere)|dentro de (?:los )?(?:ultimos )?|maxim[oa] (?:de )?|antelacion (?:no mayor|maxima)(?: a| de)?|con (?:una )?(?:fecha de )?expedicion (?:no mayor|inferior)(?: a| de)?|inferior a)\s*(?:los\s+)?(?:([a-z]+)\s*)?\(?(\d{1,3})?\)?\s*(dias?|meses?)\s*(habiles|calendario|corridos)?/;
const AT_CLOSE = /vigente (?:a|en|para) (?:la )?(?:fecha (?:de|del) )?(?:cierre|presentacion)|vigencia (?:igual o )?(?:superior|posterior) (?:a|al) (?:la fecha (?:de|del) )?cierre/;

function utcDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}
const iso = time => new Date(time).toISOString().slice(0, 10);

/** Domingo de Pascua (algoritmo anónimo gregoriano), como instante UTC. */
function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}
const nextMonday = time => { const weekday = new Date(time).getUTCDay(); return weekday === 1 ? time : time + ((8 - weekday) % 7) * DAY; };

const holidayCache = new Map();
/** Festivos de Colombia (Ley 51 de 1983, «Ley Emiliani»): fijos, trasladados al lunes y los que dependen de la Pascua. */
export function festivosDeColombia(year) {
  if (holidayCache.has(year)) return holidayCache.get(year);
  const fixed = [[1, 1], [5, 1], [7, 20], [8, 7], [12, 8], [12, 25]].map(([month, day]) => Date.UTC(year, month - 1, day));
  const moved = [[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]].map(([month, day]) => nextMonday(Date.UTC(year, month - 1, day)));
  const e = easter(year);
  const easterBased = [e - 3 * DAY, e - 2 * DAY, e + 43 * DAY, e + 64 * DAY, e + 71 * DAY];
  const set = new Set([...fixed, ...moved, ...easterBased].map(iso));
  holidayCache.set(year, set);
  return set;
}
const isBusinessDay = time => { const weekday = new Date(time).getUTCDay(); return weekday !== 0 && weekday !== 6 && !festivosDeColombia(new Date(time).getUTCFullYear()).has(iso(time)); };

/** Días hábiles entre dos fechas (después de `from`, hasta `to` inclusive). */
export function diasHabilesEntre(from, to) {
  const start = utcDay(from), end = utcDay(to);
  if (start === null || end === null) return null;
  let count = 0;
  for (let time = start + DAY; time <= end; time += DAY) if (isBusinessDay(time)) count += 1;
  return count;
}

/** El primer día en que un documento nuevo, expedido ese día, todavía sirve al cierre con esa regla. */
function expedirDesde(regla, closeTime) {
  if (regla.unidad === 'meses') { const date = new Date(closeTime); date.setUTCMonth(date.getUTCMonth() - regla.cantidad); return iso(date.getTime()); }
  if (!regla.habiles) return iso(closeTime - regla.cantidad * DAY);
  let time = closeTime, counted = 0;
  while (counted < regla.cantidad) { if (isBusinessDay(time)) counted += 1; time -= DAY; }
  return iso(time);
}

/**
 * La regla de antigüedad o de vigencia que trae un pedazo de texto del pliego, o null. `cita` es el pedazo del texto
 * donde está, para que una persona la pueda contrastar.
 */
export function reglaDeVigencia(text) {
  const plain = fold(text);
  const age = AGE_RULE.exec(plain);
  if (age) {
    const cantidad = age[2] ? Number(age[2]) : WORDS[age[1]];
    if (cantidad) {
      const unidad = age[3].startsWith('mes') ? 'meses' : 'dias';
      return { tipo: 'antiguedad', cantidad, unidad, habiles: unidad === 'dias' && age[4] === 'habiles', cita: String(text).slice(Math.max(0, age.index - 40), age.index + age[0].length + 10).trim() };
    }
  }
  const atClose = AT_CLOSE.exec(plain);
  if (atClose) return { tipo: 'vigente_al_cierre', cita: String(text).slice(Math.max(0, atClose.index - 40), atClose.index + atClose[0].length + 10).trim() };
  return null;
}

/**
 * Las reglas por documento de un requisito. El texto se parte en frases: «multas y sanciones con expedición no mayor
 * a 90 días hábiles; armamento no mayor a 60 días calendario» da una regla para cada documento, no la primera para
 * todos. `match` es el que reconoce documentos de la empresa en un texto (`matchCompanyDocumentClasses`).
 */
export function reglasPorDocumento(text, match) {
  const reglas = new Map();
  for (const frase of String(text || '').split(/(?<=[;.])\s+|\n|·/)) {
    const regla = reglaDeVigencia(frase);
    if (!regla) continue;
    for (const key of match(frase)) if (!reglas.has(key)) reglas.set(key, regla);
  }
  return reglas;
}

const unidadTexto = regla => regla.unidad === 'meses' ? `${regla.cantidad} ${regla.cantidad === 1 ? 'mes' : 'meses'}` : `${regla.cantidad} días ${regla.habiles ? 'hábiles' : 'calendario'}`;

/**
 * Compara el documento con la regla del pliego al día del cierre. `estado`: `cumple`, `no_alcanza` (va en rojo) o
 * `por_confirmar` (sin regla clara, sin fecha del documento o sin cierre). Nunca adivina una fecha.
 */
export function evaluarVigencia({ regla, issuedAt = null, expiresAt = null, closeDate = null }) {
  const close = utcDay(closeDate);
  if (!regla) return { estado: 'por_confirmar', detalle: 'El pliego no fija una regla de vigencia clara para este documento: confirmarla contra el pliego.' };
  if (close === null) return { estado: 'por_confirmar', detalle: 'La licitación no tiene fecha de cierre: no se puede medir.' };
  if (regla.tipo === 'vigente_al_cierre') {
    const expires = utcDay(expiresAt);
    if (expires === null) return { estado: 'por_confirmar', detalle: 'El pliego lo pide vigente al cierre y el documento no declara vencimiento: confirmarlo.' };
    return expires >= close
      ? { estado: 'cumple', detalle: `Vigente al cierre: vence el ${iso(expires)}.` }
      : { estado: 'no_alcanza', detalle: `Vence el ${iso(expires)}, antes del cierre (${iso(close)}): el pliego lo pide vigente al cierre.` };
  }
  const issued = utcDay(issuedAt);
  const desde = expedirDesde(regla, close);
  if (issued === null) return { estado: 'por_confirmar', detalle: `El pliego pide no más de ${unidadTexto(regla)}; el documento no declara su fecha de expedición.`, expedir_desde: desde };
  const edad = regla.unidad === 'meses' ? null : regla.habiles ? diasHabilesEntre(iso(issued), iso(close)) : Math.round((close - issued) / DAY);
  const sirve = regla.unidad === 'meses' ? iso(issued) >= desde : edad <= regla.cantidad;
  const edadTexto = edad === null ? '' : ` (${edad} ${regla.habiles ? 'días hábiles' : 'días'} al cierre)`;
  return sirve
    ? { estado: 'cumple', detalle: `Expedido el ${iso(issued)}${edadTexto}: dentro de los ${unidadTexto(regla)} que pide el pliego.`, expedir_desde: desde }
    : { estado: 'no_alcanza', detalle: `Expedido el ${iso(issued)}${edadTexto}: pasa de los ${unidadTexto(regla)} que pide el pliego. Sirve uno expedido el ${desde} o después.`, expedir_desde: desde };
}
