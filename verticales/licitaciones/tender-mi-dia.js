// Mi día de quien trabaja licitaciones (Juan, 2026-11-15; maqueta aprobada: «me gusta, vamos con eso»).
//
// Regla de fondo: Mi día es una sección de ALERTAS para no dejar pasar nada importante; cada licitación se trabaja en la
// página de su proceso. Por eso no trae listas completas del expediente: sólo lo que vence o es crítico, cada cosa con
// el proceso al que lleva. Dos niveles que conviven:
//   1. Lo general — las cuatro actividades permanentes: Observar, Presentar, Tramitar y Unirnos.
//   2. El día a día — lo que hace la persona: hoy y cada día de la semana (con «Hecho»), «Mis pendientes» (lo crítico
//      del expediente, los trámites y los avisos del cronograma, sin fecha de la entidad), la próxima semana y, aparte,
//      lo que publica la entidad (respuestas, adendas, audiencias).
// En el día, «Presentar» es sólo el cierre; la tarjeta Presentar cuenta los cierres con sus críticos abiertos y no pierde
// un cierre de fecha dudosa: lo muestra «por confirmar en SECOP» (Juan, 2026-11-25).
//
// Antes, «Licitaciones: esta semana» mezclaba 23 hitos (17 de la entidad) y la cabecera decía «Hoy está despejado».
// Módulo puro: el servidor le pasa los procesos abiertos, la pestaña Requisitos y lo marcado como hecho.

import { tenderSemanaDia, tenderSemanaTieneHora } from './tender-semana.js';

export const MI_DIA_SEMANA_DIAS = 7;
export const MI_DIA_PRESENTAR_DIAS = 15;

export const MI_DIA_ACTIVIDADES = Object.freeze({
  observar: 'Observar',
  presentar: 'Presentar',
  tramitar: 'Tramitar',
  unirnos: 'Unirnos',
});

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const isDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Nombre corto: las de la Rama Judicial sólo se distinguen al final del nombre (Manizales, Pereira, altas cortes). */
export function nombreCorto(entity) {
  return String(entity || '').replace(/[\u0080-\u009f]/g, ' - ').replace(/\s+/g, ' ').trim()
    .replace(/^Rama Judicial\s*-?\s*Dirección Seccional de Administración Judicial de (.+)$/i, 'Rama Judicial · Seccional $1')
    .replace(/^Rama Judicial\s*-?\s*Dirección Ejecutiva de Administración Judicial$/i, 'Rama Judicial · Dirección Ejecutiva');
}

// Lo que hace la persona, por tipo de plazo del cronograma. Lo demás lo publica la entidad.
const ACCION_POR_TIPO = {
  PROJECT_OBSERVATIONS: { actividad: 'observar', texto: 'Radicar observaciones al proyecto' },
  OBSERVATIONS: { actividad: 'observar', texto: 'Radicar observaciones al definitivo' },
  EVALUATION_OBSERVATIONS: { actividad: 'observar', texto: 'Radicar observaciones al informe de evaluación' },
  SUBMISSION: { actividad: 'presentar', texto: 'Presentar la oferta (cierre)' },
};
const MANIFESTACION = /manifestaci[oó]n de inter[eé]s/i;
// La manifestación para limitar la convocatoria a Mipymes/Mypes no es para participar: Seguridad Nacional es gran
// empresa y no la hace (Popayán LP 01, 25-nov). Queda como fecha de la entidad, no como tarea.
const LIMITAR_A_MIPYMES = /limitar|mi?pymes?|mypes?/i;
// «Solo en unión temporal: …» es como Vig-IA dice que no vamos solos.
const SOLO_CON_ALIADO = /^\s*solo (?:en|con) (?:uni[oó]n temporal|consorcio|aliad)/i;
const RESUELTO = new Set(['resuelto', 'no_por_ahora']);

function accionDe(deadline) {
  if (ACCION_POR_TIPO[deadline?.kind]) return ACCION_POR_TIPO[deadline.kind];
  const label = String(deadline?.label || '');
  if (MANIFESTACION.test(label) && !LIMITAR_A_MIPYMES.test(label)) return { actividad: 'presentar', texto: 'Manifestar interés' };
  return null;
}

/** La clave estable con la que se marca «Hecho»: el proceso, el tipo de plazo y su fecha. */
export function miDiaClave(opportunityId, kind, value) {
  return `${opportunityId}|${kind}|${value}`;
}

function ordenar(a, b) {
  return a.day.localeCompare(b.day)
    || Number(b.tiene_hora) - Number(a.tiene_hora)
    || (a.tiene_hora && b.tiene_hora ? Date.parse(a.value) - Date.parse(b.value) : 0)
    || String(a.proceso).localeCompare(String(b.proceso));
}

/**
 * processes: [{ opportunity_id, entity, ref, responsable, offer_status, deadlines: [{ kind, value, label }],
 *   recomendacion, close_date, cronograma_faltante, criticos: [{ titulo, consecuencia, target_date, responsable }] }]
 * requisitos: los focos de la pestaña Requisitos (buildRequirementFocus). hechos: [{ item_key, done_at, done_by_name }].
 */
export function buildTenderMiDia({ processes = [], requisitos = [], hechos = [], today } = {}) {
  if (!isDay(today)) throw new Error('buildTenderMiDia: falta la fecha de hoy (YYYY-MM-DD).');
  const finSemana = addDays(today, MI_DIA_SEMANA_DIAS - 1);
  const finProxima = addDays(today, 2 * MI_DIA_SEMANA_DIAS - 1);
  const finPresentar = addDays(today, MI_DIA_PRESENTAR_DIAS - 1);
  const hechoPorClave = new Map((hechos || []).map(row => [row.item_key, row]));

  const acciones = [];
  const entidad = [];
  const pendientes = [];
  const porConfirmar = [];
  const unirnos = [];
  for (const process of processes || []) {
    const proceso = nombreCorto(process.entity) || process.ref || 'Licitación';
    const base = { opportunity_id: process.opportunity_id, proceso, ref: process.ref || null };
    const seen = new Set();
    const presentada = process.offer_status === 'presentada';
    // Lo crítico del expediente se trabaja en el proceso; al lado del cierre sólo va cuántos quedan abiertos.
    const criticos = presentada ? [] : (process.criticos || []).map(item => String(item?.titulo || '').trim()).filter(Boolean);
    for (const deadline of process.deadlines || []) {
      const day = tenderSemanaDia(deadline?.value);
      // Una fecha que una fuente posterior contradice (Barranquilla, 15-nov) no va al día; pero un cierre no se pierde:
      // sale en la tarjeta Presentar «por confirmar en SECOP», con el enlace al proceso.
      if (deadline?.certainty === 'CONTRADICTED') {
        if (deadline.kind === 'SUBMISSION' && !presentada && day && day >= today && day <= finPresentar) {
          porConfirmar.push({ ...base, key: miDiaClave(process.opportunity_id, deadline.kind, deadline.value), actividad: 'presentar',
            texto: 'Presentar la oferta (cierre)', value: deadline.value, day, tiene_hora: tenderSemanaTieneHora(deadline.value),
            dias: daysBetween(today, day), responsable: process.responsable || null, por_confirmar: true,
            criticos: criticos.length, criticos_titulos: criticos.slice(0, 5), hecho: null });
        }
        continue;
      }
      if (!day || day < today || day > finProxima) continue;
      const accion = accionDe(deadline);
      // Ya presentada, el cierre no es una acción suya; sin oferta, el informe de evaluación no se observa.
      if (accion?.actividad === 'presentar' && presentada) continue;
      if (deadline.kind === 'EVALUATION_OBSERVATIONS' && !presentada) continue;
      const key = miDiaClave(process.opportunity_id, deadline.kind, deadline.value);
      if (seen.has(key)) continue;
      seen.add(key);
      const tiene_hora = tenderSemanaTieneHora(deadline.value);
      if (accion) {
        const hecho = hechoPorClave.get(key) || null;
        acciones.push({ ...base, key, actividad: accion.actividad, texto: accion.texto, value: deadline.value, day, tiene_hora,
          dias: daysBetween(today, day), responsable: process.responsable || null,
          ...(deadline.kind === 'SUBMISSION' ? { criticos: criticos.length, criticos_titulos: criticos.slice(0, 5) } : {}),
          hecho: hecho ? { at: hecho.done_at || null, por: hecho.done_by_name || null } : null });
      } else if (day <= finSemana) {
        entidad.push({ ...base, key, texto: String(deadline.label || deadline.kind || 'Fecha del cronograma').trim(), value: deadline.value, day, tiene_hora });
      }
    }
    // Mis pendientes: lo que no tiene fecha de la entidad pero alguien debe resolver.
    const contradichas = (process.deadlines || []).filter(deadline => deadline?.certainty === 'CONTRADICTED');
    if (contradichas.length) {
      pendientes.push({ ...base, actividad: 'presentar', texto: `Confirmar el cronograma en SECOP: ${contradichas.length === 1 ? 'una fecha del análisis está contradicha' : `${contradichas.length} fechas del análisis están contradichas`}`,
        responsable: process.responsable || null, vencido_hace: null, destino: 'proceso' });
    }
    for (const item of presentada ? [] : process.criticos || []) {
      const target = isDay(String(item.target_date || '').slice(0, 10)) ? String(item.target_date).slice(0, 10) : null;
      const texto = `${item.titulo}${item.consecuencia === 'no_subsanable' ? ' (no se subsana)' : ' (causa rechazo)'}`;
      pendientes.push({ ...base, actividad: 'presentar', texto, responsable: item.responsable || process.responsable || null,
        vencido_hace: target && target < today ? daysBetween(target, today) : null, destino: 'proceso' });
    }
    if (process.cronograma_faltante) {
      pendientes.push({ ...base, actividad: 'observar', texto: 'Falta el cronograma de SECOP: subir «Información del procedimiento»',
        responsable: process.responsable || null, vencido_hace: null, destino: 'proceso' });
    }
    const cierre = (process.deadlines || []).filter(d => d?.kind === 'SUBMISSION').map(d => tenderSemanaDia(d.value)).filter(Boolean).sort()[0]
      || (isDay(String(process.close_date || '').slice(0, 10)) ? String(process.close_date).slice(0, 10) : null);
    if (SOLO_CON_ALIADO.test(String(process.recomendacion || '')) && (!cierre || cierre >= today)) {
      unirnos.push({ ...base, cierre, motivo: String(process.recomendacion).replace(SOLO_CON_ALIADO, '').replace(/^[:\s]+/, '').slice(0, 200) });
    }
  }
  acciones.sort(ordenar);
  entidad.sort(ordenar);
  unirnos.sort((a, b) => String(a.cierre || '9').localeCompare(String(b.cierre || '9')));

  // Tramitar: las tarjetas de Requisitos que frenan algún proceso abierto y no están resueltas; lo «sin dato en la
  // ficha» se cuenta aparte porque se resuelve cargando el dato, no con un trámite.
  const focos = (requisitos || []).filter(focus => (focus.upcoming || []).length && !RESUELTO.has(focus.status));
  const tramitar = focos.map(focus => ({ key: focus.key, titulo: focus.title, estado: focus.status,
    sin_dato: (focus.upcoming || []).every(item => item.unknown), procesos: (focus.upcoming || []).length,
    primer_cierre: focus.upcoming?.[0]?.deadline || null }));
  for (const focus of tramitar.filter(item => item.estado === 'iniciar' || item.estado === 'en_tramite')) {
    pendientes.push({ opportunity_id: null, proceso: null, ref: null, actividad: 'tramitar',
      texto: `${focus.titulo} (${focus.estado === 'en_tramite' ? 'en trámite' : 'iniciar trámite'})`, responsable: null,
      vencido_hace: null, destino: 'requisitos' });
  }
  const semana = acciones.filter(item => item.day <= finSemana);
  const proxima = acciones.filter(item => item.day > finSemana);
  const dias = [];
  for (let n = 0; n < MI_DIA_SEMANA_DIAS; n += 1) {
    const day = addDays(today, n);
    const items = semana.filter(item => item.day === day);
    if (n === 0 || items.length) dias.push({ day, dias: n, items });
  }

  const observarSemana = semana.filter(item => item.actividad === 'observar');
  const observarProxima = proxima.filter(item => item.actividad === 'observar');
  // Presentar es sólo el cierre de un proceso al que vamos; la manifestación de interés va al día, no a esta tarjeta.
  const cierres = [...acciones.filter(item => item.texto === 'Presentar la oferta (cierre)' && item.day <= finPresentar), ...porConfirmar]
    .sort(ordenar);
  const abiertas = list => list.filter(item => !item.hecho);
  const primero = abiertas(semana)[0] || null;
  const manifestaciones = abiertas(semana).filter(item => item.texto === 'Manifestar interés');

  return {
    today,
    hasta: finSemana,
    frase: {
      observaciones: abiertas(observarSemana).length,
      manifestaciones: manifestaciones.map(item => ({ proceso: item.proceso, opportunity_id: item.opportunity_id })),
      cierres: abiertas(semana.filter(item => item.texto === 'Presentar la oferta (cierre)')).length,
      primero: primero ? { proceso: primero.proceso, texto: primero.texto, value: primero.value, day: primero.day, tiene_hora: primero.tiene_hora, opportunity_id: primero.opportunity_id } : null,
    },
    actividades: {
      observar: { esta_semana: observarSemana.length, proxima: observarProxima.length, items: observarSemana.slice(0, 4),
        proximo: abiertas(observarSemana)[0] || abiertas(observarProxima)[0] || null },
      presentar: { cierres: cierres.length, items: cierres.slice(0, 4) },
      tramitar: { por_tramitar: tramitar.filter(item => item.estado === 'iniciar' || item.estado === 'en_tramite').length,
        sin_dato: tramitar.filter(item => item.sin_dato).length, total: tramitar.length, items: tramitar.slice(0, 3) },
      unirnos: { total: unirnos.length, items: unirnos.slice(0, 4) },
    },
    dias,
    pendientes,
    proxima,
    entidad,
  };
}
