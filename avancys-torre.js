// Lo que la Torre de Control muestra de Avancys en la vista de gerencia (plan del 2026-11-12:
// "una sola pantalla organizada por decisiones"). Dos preguntas:
//
//   1. ¿Ganamos plata el mes pasado? Resultado de los últimos meses desde las líneas analíticas
//      (solo cuentas de resultados), con el mes en curso y los meses con la nómina a medio
//      contabilizar marcados como parciales.
//   2. ¿Qué clientes dejan y cuáles quitan plata? La rentabilidad aproximada del último mes cerrado.
//
// Calcular un mes contra Odoo tarda medio minuto, así que el resultado se guarda en memoria del
// servidor y se recalcula a pedido o cuando vence. Solo lectura y solo agregados.

import { configuracionDeAvancys } from './avancys-odoo-lectura.js';
import { abrirSesion, claseDeCuenta, cuentaPuc, LINEAS_ANALITICAS, rentabilidadAproximada } from './avancys-acceso.js';

export const VIGENCIA_MS = 30 * 60 * 1000;
// Un mes cuya nómina contabilizada está por debajo de este tanto de la de los otros meses está a
// medio cerrar: el 2026-11-12 octubre tenía cerca de la mitad de la nómina de agosto y septiembre.
export const NOMINA_COMPLETA = 0.85;
const MESES = 4;

const mesDe = fecha => fecha.toISOString().slice(0, 7);
function sumarMeses(mes, cuantos) {
  const [anio, numero] = mes.split('-').map(Number);
  return mesDe(new Date(Date.UTC(anio, numero - 1 + cuantos, 1)));
}
const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// read_group de Odoo 14 rotula los meses como "agosto 2026" (según el idioma del usuario) o "August 2026".
const MESES_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export function mesDeEtiqueta(etiqueta) {
  const [nombre, anio] = String(etiqueta || '').toLowerCase().trim().split(/\s+/);
  let numero = MESES_ES.indexOf(nombre);
  if (numero < 0) numero = MESES_EN.indexOf(nombre);
  return numero >= 0 && /^\d{4}$/.test(anio || '') ? `${anio}-${String(numero + 1).padStart(2, '0')}` : null;
}

const mediana = valores => {
  const orden = [...valores].sort((a, b) => a - b);
  if (!orden.length) return 0;
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
};

// El estado de cada mes: el mes en curso siempre es parcial; uno pasado es parcial si su nómina
// contabilizada queda por debajo del 85 % de la mediana de los demás meses pasados.
export function marcarMeses(meses, mesActual) {
  const pasados = meses.filter(fila => fila.mes < mesActual);
  return meses.map(fila => {
    if (fila.mes >= mesActual) return { ...fila, estado: 'parcial', motivo: 'Mes en curso' };
    const otros = pasados.filter(otro => otro.mes !== fila.mes).map(otro => Math.abs(otro.personal));
    const referencia = mediana(otros);
    if (referencia && Math.abs(fila.personal) < NOMINA_COMPLETA * referencia) {
      return { ...fila, estado: 'parcial', motivo: 'La nómina del mes no está completa en la contabilidad' };
    }
    return { ...fila, estado: 'cerrado', motivo: null };
  });
}

// Resultado por mes con una sola consulta: líneas analíticas agrupadas por cuenta y mes.
export async function resultadoPorMes(ejecutar, { desde, hasta }) {
  const grupos = (await ejecutar(LINEAS_ANALITICAS, 'read_group',
    [[['date', '>=', `${desde}-01`], ['date', '<', `${hasta}-01`], ['amount', '!=', 0]], ['amount:sum'], ['general_account_id', 'date:month']],
    { lazy: false })) || [];
  const meses = new Map();
  for (const grupo of grupos) {
    const mes = mesDeEtiqueta(grupo['date:month']);
    if (!mes) continue;
    const clase = claseDeCuenta(cuentaPuc(grupo.general_account_id));
    if (clase === 'balance') continue;
    const fila = meses.get(mes) || { mes, ingresos: 0, personal: 0, otros_costos: 0 };
    fila[{ ingreso: 'ingresos', personal: 'personal', otro_costo: 'otros_costos' }[clase]] += Number(grupo.amount) || 0;
    meses.set(mes, fila);
  }
  return [...meses.values()]
    .map(fila => ({ ...fila, margen: fila.ingresos + fila.personal + fila.otros_costos }))
    .sort((izq, der) => izq.mes.localeCompare(der.mes));
}

export async function calcularTorre(ejecutar, { ahora = () => new Date() } = {}) {
  const mesActual = mesDe(ahora());
  // Las líneas analíticas empiezan con una carga del año acumulado (el 2026-07-31): ese mes no es
  // un mes de operación y no se muestra.
  const primera = await ejecutar(LINEAS_ANALITICAS, 'search_read', [[]], { fields: ['date'], limit: 1, order: 'date asc' });
  const primerDia = primera?.[0]?.date || null;
  let desde = sumarMeses(mesActual, -MESES);
  if (primerDia) {
    const primerMesCompleto = primerDia.endsWith('-01') ? primerDia.slice(0, 7) : sumarMeses(primerDia.slice(0, 7), 1);
    if (primerMesCompleto > desde) desde = primerMesCompleto;
  }
  const meses = marcarMeses(await resultadoPorMes(ejecutar, { desde, hasta: sumarMeses(mesActual, 1) }), mesActual);
  const cerrados = meses.filter(fila => fila.estado === 'cerrado');
  const mesCerrado = cerrados.at(-1)?.mes || null;
  const clientes = mesCerrado ? await rentabilidadAproximada(ejecutar, { mes: mesCerrado }) : null;
  return { meses, mes_cerrado: mesCerrado, mes_anterior: cerrados.at(-2)?.mes || null, primera_linea: primerDia, clientes };
}

let guardado = null;

export async function torreAvancys({ refrescar = false, config = configuracionDeAvancys(), fetchImpl = globalThis.fetch, ahora = () => new Date() } = {}) {
  const momento = ahora().getTime();
  if (!refrescar && guardado && momento - guardado.en < VIGENCIA_MS) return { ...guardado.datos, desde_memoria: true };
  const sesion = await abrirSesion({ config, fetchImpl, ahora });
  if (!sesion.ejecutar) return sesion.estado;
  const datos = { ...(await calcularTorre(sesion.ejecutar, { ahora })), configurado: true, autenticado: true, origen: config.origen, medido_en: new Date(momento).toISOString() };
  guardado = { en: momento, datos };
  return { ...datos, desde_memoria: false };
}

export function olvidarTorre() { guardado = null; }
