// AGT-003 — Estado del contrato de cada cliente (Juan, 2026-11-26). Módulo puro: sin red, sin base, sin reloj implícito.
//
// Sirve para tres cosas: las alertas de vencimiento (Mi día y Dashboard), ver qué clientes reciben servicio sin
// contrato vigente, y las comisiones (la regla base 2026 paga la vigilancia 12 meses desde que se firma el contrato o su
// renovación).
//
// El archivo de contratos trae, además de las fechas, una columna de revisión escrita por una persona («SIN CONTRATO
// VIGENTE», «SE RENOVO», «REVISAR COMERCIAL»…). Esa revisión manda sobre la fecha: hay contratos con fin en 2028
// marcados «sin contrato vigente». Si no hay revisión que decida, decide la fecha de fin.

export const DIAS_POR_VENCER = 90;

export const ESTADOS_CONTRATO = Object.freeze({
  por_vencer: 'Vence pronto',
  vencido: 'Vencido',
  sin_contrato: 'Sin contrato vigente',
  revisar: 'Revisar con comercial',
  renovado: 'Renovado: faltan las fechas nuevas',
  sin_fecha: 'Sin fecha de fin',
  vigente: 'Vigente',
});

// Orden en que se muestran: lo que pide acción primero.
export const ORDEN_ESTADOS = Object.freeze(['por_vencer', 'vencido', 'sin_contrato', 'revisar', 'renovado', 'sin_fecha', 'vigente']);

const DIA_MS = 86_400_000;
const dia = valor => (valor ? String(valor).slice(0, 10) : null);
const diasEntre = (desde, hasta) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / DIA_MS);

/** Estado de un contrato y los días hasta su fin (negativos si ya venció). `hoy` es AAAA-MM-DD, hora de Colombia. */
export function estadoContrato({ fecha_fin, observacion } = {}, hoy) {
  const revision = String(observacion || '').toUpperCase();
  const fin = dia(fecha_fin);
  const dias = fin ? diasEntre(hoy, fin) : null;
  if (/SE RENOV/.test(revision)) return { estado: 'renovado', dias };
  if (/(SIN|NO TIENE|PERO NO)\s+CONTRATO/.test(revision)) return { estado: 'sin_contrato', dias };
  if (/REVISAR/.test(revision)) return { estado: 'revisar', dias };
  if (!fin) return { estado: 'sin_fecha', dias: null };
  if (dias < 0) return { estado: 'vencido', dias };
  if (dias <= DIAS_POR_VENCER) return { estado: 'por_vencer', dias };
  return { estado: 'vigente', dias };
}

/** Desde cuándo corre la comisión de vigilancia: la firma del contrato o de su última renovación, la más reciente. */
export function inicioDeComision({ fecha_inicio, fecha_ultima_renovacion } = {}) {
  const fechas = [dia(fecha_inicio), dia(fecha_ultima_renovacion)].filter(Boolean).sort();
  return fechas.length ? fechas[fechas.length - 1] : null;
}

/**
 * Une el archivo con lo que sabe Avancys de cada cliente. Las fechas de Avancys mandan cuando existen (su lugar es
 * Avancys); si no, quedan las del archivo. Cada fila dice de dónde salieron sus fechas.
 *
 * @param {object[]} archivo  Filas de psi_client_contracts.
 * @param {Record<string, { comercial_id: number|null, comercial: string|null, fecha_inicio: string|null, fecha_fin: string|null }>} avancys  Por NIT.
 */
export function contratosDeClientes(archivo = [], avancys = {}, hoy) {
  return archivo.map(fila => {
    const deAvancys = avancys[fila.nit] || null;
    const conAvancys = Boolean(deAvancys && (deAvancys.fecha_inicio || deAvancys.fecha_fin));
    const fechas = conAvancys
      ? { fecha_inicio: deAvancys.fecha_inicio, fecha_ultima_renovacion: null, fecha_fin: deAvancys.fecha_fin }
      : { fecha_inicio: dia(fila.fecha_inicio), fecha_ultima_renovacion: dia(fila.fecha_ultima_renovacion), fecha_fin: dia(fila.fecha_fin) };
    // Con fechas de Avancys la revisión del archivo ya no decide: es de antes de que Avancys las tuviera.
    const { estado, dias } = estadoContrato({ fecha_fin: fechas.fecha_fin, observacion: conAvancys ? null : fila.observacion }, hoy);
    return Object.freeze({
      nit: fila.nit,
      razon_social: fila.razon_social || null,
      comercial_id: deAvancys?.comercial_id ?? null,
      comercial: deAvancys?.comercial ?? null,
      ...fechas,
      inicio_comision: inicioDeComision(fechas),
      estado,
      dias,
      observacion: fila.observacion || null,
      fuente: conAvancys ? 'Avancys' : fila.fuente,
    });
  }).sort((a, b) => ORDEN_ESTADOS.indexOf(a.estado) - ORDEN_ESTADOS.indexOf(b.estado)
    || (a.dias ?? 99999) - (b.dias ?? 99999)
    || String(a.razon_social).localeCompare(String(b.razon_social), 'es'));
}

/** Cuántos hay en cada estado. */
export function resumenContratos(contratos = []) {
  const resumen = Object.fromEntries(ORDEN_ESTADOS.map(estado => [estado, 0]));
  for (const c of contratos) resumen[c.estado] = (resumen[c.estado] || 0) + 1;
  return resumen;
}
