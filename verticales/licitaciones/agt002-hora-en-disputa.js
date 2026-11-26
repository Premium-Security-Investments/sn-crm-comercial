// AGT-002 — hora en disputa: cuando las fuentes de la entidad no coinciden en la hora de un plazo, manda la más
// temprana (Juan, 2026-11-26). El caso: Rama Medellín LP002-2026. El pliego y el aviso fijan las observaciones al
// proyecto el 26-nov a las 11:00 a. m.; SECOP dice 11:59 p. m. Vig-IA lo vio, lo escribió en una contradicción
// («11:59 p. m. frente a 11:00 a. m. del 26 de noviembre») y hasta anotó que se trabajaba con las 11:00 a. m., pero
// guardó el plazo con la hora de SECOP, y Mi día le mostró a Katherine 11:59 p. m.
//
// Esta regla no depende de que el modelo acierte: se aplica al leer el análisis guardado (que es inmutable). Si un
// plazo cita una contradicción y en esa contradicción, en el tramo que nombra el mismo día del plazo, aparecen dos
// horas o más, el plazo se adelanta a la más temprana y queda marcado «hora por confirmar». Nunca se atrasa un plazo.

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// «11:00 a. m.», «11:59 p.m.», «12:00 m.» (mediodía). La hora va de 1 a 12.
const HORA = /\b(\d{1,2}):(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?|m\.)(?![a-záéíóúñ])/gi;
const VALOR = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const arr = value => (Array.isArray(value) ? value : []);
const dos = n => String(n).padStart(2, '0');

/** Día y minutos del día en hora de Bogotá de un valor ISO con hora, o null. */
function enBogota(value) {
  const match = VALOR.exec(String(value || '').trim());
  if (!match) return null;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  const local = new Date(at - 5 * 3_600_000);
  return { dia: local.getUTCDate(), mes: local.getUTCMonth(), anio: local.getUTCFullYear(), minutos: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

/** Minutos desde la medianoche de una hora escrita en español, o null. */
function minutosDe(hora, minuto, sufijo) {
  const h = Number(hora); const m = Number(minuto);
  if (!(h >= 1 && h <= 12) || !(m >= 0 && m <= 59)) return null;
  const s = sufijo.toLowerCase().replace(/[\s.]/g, '');
  if (s === 'm') return h === 12 ? 12 * 60 + m : null;
  if (s === 'am') return (h % 12) * 60 + m;
  if (s === 'pm') return ((h % 12) + 12) * 60 + m;
  return null;
}

/** Las horas que un texto atribuye al día dado («del 26 de noviembre»), tramo por tramo (separados por «;»). */
export function agt002HorasDelDia(texto, dia, mes) {
  const fecha = new RegExp(`\\b${dia}\\s+de\\s+${MESES[mes]}\\b`, 'i');
  const horas = new Set();
  for (const tramo of String(texto || '').split(';')) {
    if (!fecha.test(tramo)) continue;
    for (const match of tramo.matchAll(HORA)) {
      const minutos = minutosDe(match[1], match[2], match[3]);
      if (minutos !== null) horas.add(minutos);
    }
  }
  return [...horas].sort((a, b) => a - b);
}

/**
 * Devuelve el plazo con la hora más temprana de las fuentes y `hora_por_confirmar`, si una contradicción que el
 * plazo cita da dos horas o más para ese día. Si no, devuelve el plazo tal cual.
 * `claims`: los del análisis guardado (claim_id, claim_type, evidence_status, display_text).
 */
export function agt002AplicarHoraMasTemprana(deadline, claims) {
  const propia = enBogota(deadline?.value);
  if (!propia) return deadline;
  const citadas = new Set(arr(deadline?.source_claim_ids).map(String));
  if (!citadas.size) return deadline;
  const horas = new Set([propia.minutos]);
  let enDisputa = false;
  for (const claim of arr(claims)) {
    if (!citadas.has(String(claim?.claim_id))) continue;
    if (claim?.evidence_status !== 'CONTRADICTED' && claim?.claim_type !== 'contradiction') continue;
    const delDia = agt002HorasDelDia(claim.display_text, propia.dia, propia.mes);
    if (delDia.length >= 2) enDisputa = true;
    for (const minutos of delDia) horas.add(minutos);
  }
  if (!enDisputa) return deadline;
  const ordenadas = [...horas].sort((a, b) => a - b);
  const temprana = ordenadas[0];
  const value = temprana < propia.minutos
    ? `${propia.anio}-${dos(propia.mes + 1)}-${dos(propia.dia)}T${dos(Math.floor(temprana / 60))}:${dos(temprana % 60)}:00-05:00`
    : deadline.value;
  return { ...deadline, value, hora_por_confirmar: true, horas_en_fuentes: ordenadas.map(m => `${dos(Math.floor(m / 60))}:${dos(m % 60)}`) };
}
