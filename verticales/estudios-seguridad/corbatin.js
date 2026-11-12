// Estudios de Seguridad Física: el corbatín de cada riesgo y los datos de cada control (migración 215; NTC-IEC/ISO
// 31010:2020, B.4.2; Juan, 2026-11-12: "las 2 primeras propuestas suyas también son lógicas ya que vienen de la norma").
//
// El corbatín pone el evento en el centro; a la izquierda, las causas con los controles que lo EVITAN; a la derecha, las
// consecuencias con los controles que REDUCEN EL DAÑO. Muestra qué causa no tiene defensa. No se escribe dos veces: los
// controles son los renglones de "Control existente" y "Control propuesto", las causas y consecuencias, los renglones de
// sus campos. Cada control puede llevar cinco datos (Juan, 2026-11-12: "esta bien"):
//   momento       antes del evento (evita) o después (reduce el daño): el lado del corbatín;
//   causa         frente a qué causa actúa (sólo los de antes; sin causa, cubre todas);
//   verificado    si el analista lo vio funcionar en el recorrido (sólo los existentes);
//   depende_de    otro control del que depende (p. ej. el CCTV, de alguien que mire el monitor);
//   puede_fallar  qué lo hace fallar (factor de escalamiento de la norma);
//   lo_sostiene   qué lo mantiene (capacitación, mantenimiento, inspección: funciones de gestión de la norma).
// Todo es opcional: un control sin datos queda "sin clasificar" y nada se bloquea.

const TIPOS = new Set(['existente', 'propuesto']);
const MOMENTOS = new Set(['antes', 'despues']);
const MAX_DETAILS = 40;
const fail = message => Object.assign(new Error(message), { status: 400 });

/** Los renglones de un campo de texto, sin la numeración ("1. ", "2) ", "- "). */
export function itemsOf(text) {
  return String(text || '').split(/\r?\n/).map(line => line.replace(/^\s*(?:\d+\s*[.)-]|[-•*])\s*/, '').trim()).filter(Boolean);
}

const key = text => String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
const short = (value, field) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw fail(`${field}: texto.`);
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length > 300) throw fail(`${field}: máximo 300 caracteres.`);
  return clean || null;
};

/**
 * Limpia los datos de los controles contra los textos del riesgo. Los de un renglón que ya no existe (se editó el
 * control) se descartan sin error; los que no traen ningún dato, también.
 */
export function cleanControlDetails(input, row) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw fail('Datos de los controles: lista.');
  if (input.length > MAX_DETAILS) throw fail(`Datos de los controles: máximo ${MAX_DETAILS}.`);
  const lines = { existente: new Set(itemsOf(row.current_control).map(key)), propuesto: new Set(itemsOf(row.proposed_control).map(key)) };
  const causes = itemsOf(row.causes).length;
  const seen = new Set();
  const out = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') throw fail('Datos de los controles: cada uno es un objeto.');
    if (!TIPOS.has(item.tipo)) throw fail('Datos de los controles: existente o propuesto.');
    const texto = short(item.texto, 'Control');
    if (!texto || !lines[item.tipo].has(key(texto)) || seen.has(`${item.tipo}:${key(texto)}`)) continue;
    const momento = item.momento ?? null;
    if (momento !== null && !MOMENTOS.has(momento)) throw fail('Cuándo actúa el control: antes o después del evento.');
    let causa = item.causa ?? null;
    if (causa !== null) {
      causa = Number(causa);
      if (!Number.isInteger(causa) || causa < 1) throw fail('Causa: número de la causa.');
      // Causa que ya no existe (se borró un renglón) o control que actúa después: sin causa.
      if (causa > causes || momento !== 'antes') causa = null;
    }
    const verificado = item.tipo === 'existente' && typeof item.verificado === 'boolean' ? item.verificado : null;
    const clean = {
      tipo: item.tipo, texto, momento, causa, verificado,
      depende_de: short(item.depende_de, 'De qué depende'), puede_fallar: short(item.puede_fallar, 'Qué lo puede hacer fallar'), lo_sostiene: short(item.lo_sostiene, 'Qué lo sostiene'),
    };
    if (!clean.momento && clean.verificado === null && !clean.depende_de && !clean.puede_fallar && !clean.lo_sostiene) continue;
    seen.add(`${item.tipo}:${key(texto)}`);
    out.push(clean);
  }
  return out;
}

/** El corbatín de un riesgo: acepta la fila de la base o el riesgo de la versión aprobada (claves en español). */
export function bowTie(risk) {
  const pick = (db, snap) => risk[db] ?? risk[snap];
  const causesText = pick('causes', 'causas');
  const consequencesText = pick('consequences', 'consecuencias');
  const current = risk.current_control ?? risk.control_existente?.descripcion;
  const proposed = risk.proposed_control ?? risk.control_propuesto?.descripcion;
  const details = pick('control_details', 'datos_controles') || [];
  const byKey = new Map(details.map(item => [`${item.tipo}:${key(item.texto)}`, item]));
  const controls = [
    ...itemsOf(current).map(texto => ({ tipo: 'existente', texto })),
    ...itemsOf(proposed).map(texto => ({ tipo: 'propuesto', texto })),
  ].map(control => {
    const found = byKey.get(`${control.tipo}:${key(control.texto)}`) || {};
    return { momento: null, causa: null, verificado: null, depende_de: null, puede_fallar: null, lo_sostiene: null, ...found, ...control };
  });
  const causas = itemsOf(causesText).map((texto, index) => ({ numero: index + 1, texto, controles: controls.filter(item => item.momento === 'antes' && item.causa === index + 1) }));
  const general = controls.filter(item => item.momento === 'antes' && !item.causa);
  const covered = (cause, tipo) => cause.controles.some(item => !tipo || item.tipo === tipo) || general.some(item => !tipo || item.tipo === tipo);
  return {
    evento: risk.title ?? risk.riesgo,
    causas,
    antes_todas: general,
    despues: controls.filter(item => item.momento === 'despues'),
    sin_clasificar: controls.filter(item => !item.momento),
    consecuencias: itemsOf(consequencesText),
    detallado: controls.some(item => item.momento),
    // Sólo con los controles ya ubicados: si nadie dijo cuándo actúan, no se sabe qué causa queda sin defensa.
    sin_defensa_hoy: controls.some(item => item.momento) ? causas.filter(cause => !covered(cause, 'existente')).map(cause => cause.numero) : [],
    sin_ningun_control: controls.some(item => item.momento) ? causas.filter(cause => !covered(cause)).map(cause => cause.numero) : [],
  };
}

/** Una línea de texto con los datos de un control, para el informe y la ficha. */
export function controlNote(control) {
  return [
    control.tipo === 'propuesto' ? 'propuesto' : control.verificado === true ? 'verificado en el recorrido' : control.verificado === false ? 'no verificado' : null,
    control.depende_de ? `depende de: ${control.depende_de}` : null,
    control.puede_fallar ? `puede fallar si: ${control.puede_fallar}` : null,
    control.lo_sostiene ? `lo sostiene: ${control.lo_sostiene}` : null,
  ].filter(Boolean).join('; ');
}
