// El cronograma se actualiza desde la Mesa con el aviso de cambio de SECOP (Juan, 2026-11-20, DEAJ LP-07-2026).
//
// Juan pegó en la Mesa el aviso «Presentación de Ofertas ha cambiado desde '26/11/2026 9:00:00 AM' hasta '27/11/2026
// 9:00:00 AM' …» y pidió «la idea es que actualice el cronograma completo». La Mesa sólo sabía corregir la fecha de la
// oportunidad: el cierre con hora (el que lee Mi día) siguió en el 26, la respuesta a observaciones y las adendas siguieron
// en el 20, y el ajuste nocturno del cierre lo habría devuelto al 26 porque el último análisis todavía decía eso.
//
// Regla: el aviso lo pega una persona y el servidor lo toma LITERAL del chat (nunca de lo que diga el modelo). Con él
//   1. mueve el cierre con su hora, en la licitación y en la oportunidad, y lo marca como corrección de la Mesa para que
//      el ajuste nocturno no lo deshaga mientras no haya un análisis más nuevo (tender-cierre-pliego.js);
//   2. guarda el aviso en el expediente como documento de la entidad, que pide el reanálisis: así el resto del cronograma
//      (respuestas, adendas, audiencias) llega a Mi día por el mismo camino que la impresión de SECOP.

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const FECHA = String.raw`(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP])\.?\s*M\.?`;
const CAMBIO = new RegExp(String.raw`([^\n\t'’]+?)\s+ha cambiado desde\s+['’]${FECHA}[^'’]*['’]\s+hasta\s+['’]${FECHA}[^'’]*['’]`, 'gi');
const CIERRE = /^presentaci[oó]n de (?:las )?ofertas$/i;
export const AGT002_MESA_MAX_CAMBIOS = 20;

const dos = n => String(n).padStart(2, '0');
// Colombia no tiene horario de verano: UTC−5 todo el año.
const enBogota = utc => `${new Date(Date.parse(utc) - 5 * 3600_000).toISOString().slice(0, 19)}-05:00`;

function instante(dia, mes, anio, hora, minuto, meridiano) {
  let h = Number(hora) % 12;
  if (/p/i.test(meridiano)) h += 12;
  const iso = `${anio}-${dos(mes)}-${dos(dia)}T${dos(h)}:${dos(minuto)}:00-05:00`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** «27/11/2026 9:00 a. m.»: como lo escribe la Mesa, en hora de Colombia. Pura. */
export function fechaDelAviso(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return '';
  const h = Number(m[4]);
  return `${Number(m[3])}-${MESES[Number(m[2]) - 1]}-${m[1]} ${h % 12 || 12}:${m[5]} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

/**
 * Los cambios de fecha de un aviso de SECOP II: [{ actividad, desde, hasta }] con `desde`/`hasta` en ISO con -05:00. Los
 * campos que no son del cronograma («El campo del proceso … ha cambiado desde 12/15/2026 …», sin comillas) no cuentan.
 * Pura.
 */
export function leerAvisoDeCambioSecop(texto) {
  const cambios = [];
  for (const m of String(texto || '').matchAll(CAMBIO)) {
    const actividad = m[1].replace(/\s+/g, ' ').trim();
    if (/^el campo del proceso/i.test(actividad)) continue;
    const desde = instante(m[2], m[3], m[4], m[5], m[6], m[7]);
    const hasta = instante(m[8], m[9], m[10], m[11], m[12], m[13]);
    if (actividad && desde && hasta) cambios.push({ actividad, desde, hasta });
    if (cambios.length >= AGT002_MESA_MAX_CAMBIOS) break;
  }
  return cambios;
}

/** El nuevo cierre que trae el aviso (la presentación de ofertas), o null. Pura. */
export function cierreDelAviso(cambios) {
  return (cambios || []).find(cambio => CIERRE.test(cambio.actividad)) || null;
}

/**
 * Mueve el cierre de la licitación a `deadlineAt` y lo marca como corrección de la Mesa (`raw.deadline_mesa`), que manda
 * hasta que haya un análisis más nuevo. Sin `deadlineAt` (sólo se sabe el día), conserva la hora que tenía; si no tenía
 * hora, sólo cambia el día.
 */
export async function moverCierreDeLaLicitacion(database, { tenderId, dia, deadlineAt = null, autorNombre, fuente, ahora = new Date() }) {
  const { data: licitacion, error } = await database.from('psi_public_tenders').select('id,deadline_at,raw').eq('id', tenderId).maybeSingle();
  if (error) throw error;
  if (!licitacion) return null;
  const raw = licitacion.raw && typeof licitacion.raw === 'object' ? licitacion.raw : {};
  let nuevo = deadlineAt;
  if (!nuevo && licitacion.deadline_at && !Number.isNaN(Date.parse(licitacion.deadline_at))) {
    const hora = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(licitacion.deadline_at));
    nuevo = `${dia}T${hora}:00-05:00`;
  }
  const cambios = {
    ...(nuevo ? { deadline_at: new Date(nuevo).toISOString() } : {}),
    raw: { ...raw, deadline: dia, deadline_mesa: { value: nuevo || dia, applied_at: ahora.toISOString(), by: autorNombre || null, fuente: fuente || null, previous_deadline_at: licitacion.deadline_at || null } },
    updated_at: ahora.toISOString(),
  };
  const { error: writeError } = await database.from('psi_public_tenders').update(cambios).eq('id', tenderId);
  if (writeError) throw writeError;
  return { anterior: licitacion.deadline_at || null, nuevo: nuevo || null };
}

function nombreDelAviso(ahora) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(ahora).map(parte => [parte.type, parte.value]));
  return `Aviso de cambio de cronograma SECOP ${partes.year}-${partes.month}-${partes.day} ${partes.hour}${partes.minute}.txt`;
}

/**
 * La acción «cronograma» de la Mesa. `textosDeLaPersona`: lo que escribió la persona en este chat, del mensaje actual hacia
 * atrás; se usa el primero que traiga un aviso de cambio. `ingerirDocumento({ opportunityId, autorId, nombre, texto })`
 * guarda el aviso en el expediente y pide el reanálisis (lo inyecta el servidor). Devuelve las líneas para la respuesta.
 */
export async function actualizarCronogramaDesdeAviso(database, { opportunityId, tenderId, autorId, autorNombre, textosDeLaPersona = [], ingerirDocumento = null, ahora = new Date(), fecha }) {
  const aviso = (textosDeLaPersona || []).find(texto => leerAvisoDeCambioSecop(texto).length > 0);
  if (!aviso) {
    return ['No actualicé el cronograma: no encontré en este chat el aviso de cambio de SECOP (las líneas «… ha cambiado desde «fecha» hasta «fecha»»). Péguelo aquí, o suba al proceso la impresión de «Información del procedimiento».'];
  }
  const cambios = leerAvisoDeCambioSecop(aviso);
  const lineas = [];
  const cierre = cierreDelAviso(cambios);
  if (cierre) {
    const dia = cierre.hasta.slice(0, 10);
    const movido = await moverCierreDeLaLicitacion(database, { tenderId, dia, deadlineAt: cierre.hasta, autorNombre, fuente: 'aviso de cambio de SECOP pegado en la Mesa', ahora });
    const { error } = await database.from('psi_sales_opportunities').update({ expected_close_date: dia }).eq('id', opportunityId);
    if (error) throw error;
    const anterior = movido?.anterior ? enBogota(movido.anterior) : cierre.desde;
    lineas.push(`Moví el cierre: de ${fechaDelAviso(anterior)} a ${fechaDelAviso(cierre.hasta)}, en la licitación y en la oportunidad.`);
  }
  const resumen = cambios.map(cambio => `${cambio.actividad}: ${fechaDelAviso(cambio.hasta)}`);
  let guardado = null;
  if (typeof ingerirDocumento === 'function') {
    const nombre = nombreDelAviso(ahora);
    const texto = `Aviso de cambio de cronograma publicado por la Entidad en SECOP II. Lo pegó ${autorNombre || 'una persona del equipo'} en la Mesa de Vig-IA el ${fecha}, tal como lo muestra SECOP:\n\n${aviso.trim()}\n`;
    try {
      const resultado = await ingerirDocumento({ opportunityId, autorId, nombre, texto });
      guardado = { nombre, pedido: Boolean(resultado?.analysis_request?.requested || resultado?.analysis_request?.already_open) };
    } catch (error) {
      console.warn('agt002_mesa_cronograma_ingest_failed', { event: 'agt002_mesa_cronograma_ingest_failed', code: String(error?.code || 'ingest_failed').slice(0, 40) });
    }
  }
  await database.rpc('psi_append_opportunity_observation_line', {
    p_opportunity_id: opportunityId,
    p_line: `Vig-IA, a pedido de ${autorNombre || 'la persona'} en la Mesa (${fecha}): cronograma actualizado con el aviso de cambio de SECOP. ${resumen.join('; ')}.`,
  });
  lineas.push(`Fechas nuevas según el aviso de SECOP: ${resumen.join('; ')}.`);
  lineas.push(guardado
    ? `Guardé el aviso en el expediente («${guardado.nombre}»)${guardado.pedido ? ' y pedí el reanálisis: cuando termine, Mi día queda con todas estas fechas' : '; el reanálisis no se pudo pedir solo, pídalo con el botón del proceso'}. Quedó la constancia en la oportunidad.`
    : 'No pude guardar el aviso en el expediente: las demás fechas llegan a Mi día cuando suba la impresión de «Información del procedimiento». Quedó la constancia en la oportunidad.');
  return lineas;
}
