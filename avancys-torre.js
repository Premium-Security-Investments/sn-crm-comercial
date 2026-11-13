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

import { configuracionDeAvancys, crearLectorAvancys } from './avancys-odoo-lectura.js';
import { abrirSesion, claseDeCuenta, cuentaPuc, LINEAS_ANALITICAS, rentabilidadAproximada } from './avancys-acceso.js';
import { CLIENTES_MES_VENCIDO, estadoDeResultados, ingresosContratados, LINEAS, proyectarMes, sumarMeses } from './avancys-pyg.js';

export const VIGENCIA_MS = 30 * 60 * 1000;
// Un mes cuya nómina contabilizada está por debajo de este tanto de la de los otros meses está a
// medio cerrar: el 2026-11-12 octubre tenía cerca de la mitad de la nómina de agosto y septiembre.
export const NOMINA_COMPLETA = 0.85;
const MESES = 4;

const mesDe = fecha => fecha.toISOString().slice(0, 7);
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

export async function calcularTorre(ejecutar, { ahora = () => new Date(), devengado = async () => ({ total: 0, clientes: [] }) } = {}) {
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
  // El resultado de la empresa sale de la contabilidad general con las líneas del PYG de Finanzas y
  // la provisión de ingresos mes vencido (avancys-pyg.js). Las líneas analíticas quedan para el
  // detalle por cliente: no todo el gasto pasa por ellas.
  const pyg = await estadoDeResultados(ejecutar, { desde, hasta: sumarMeses(mesActual, 1), devengado });
  const meses = marcarMeses(pyg.map(fila => ({
    mes: fila.mes,
    ingresos: fila.totales.ingresos,
    personal: fila.totales.personal,
    otros_costos: fila.totales.antes_de_impuestos - fila.totales.ingresos - fila.totales.personal,
    margen: fila.totales.antes_de_impuestos,
  })), mesActual);
  const estadoDe = new Map(meses.map(fila => [fila.mes, fila]));
  const cerrados = meses.filter(fila => fila.estado === 'cerrado');
  const mesCerrado = cerrados.at(-1)?.mes || null;
  const clientes = mesCerrado ? await rentabilidadAproximada(ejecutar, { mes: mesCerrado }) : null;
  let cartera;
  try {
    cartera = await carteraVencida(ejecutar, { hoy: ahora().toISOString().slice(0, 10) });
  } catch (error) {
    // La cartera no tumba el resultado ni los clientes: se dice que no se pudo leer.
    cartera = { error: String(error?.message || error).split('\n')[0].slice(0, 200) };
  }
  // Los meses incompletos se proyectan sobre el último mes cerrado; el mes en curso, además, con lo
  // contratado en las órdenes de servicio. Es una proyección y así se muestra.
  const base = pyg.find(fila => fila.mes === mesCerrado) || null;
  const pygConEstado = [];
  for (const fila of pyg) {
    const estado = estadoDe.get(fila.mes)?.estado || 'parcial';
    let proyeccion = null;
    if (estado === 'parcial' && base) {
      let ingresosOrdenes = null;
      if (fila.mes === mesActual) {
        try { ingresosOrdenes = await ingresosContratados(ejecutar, fila.mes); } catch { ingresosOrdenes = null; }
      }
      proyeccion = proyectarMes(fila, base, { ingresosOrdenes });
    }
    pygConEstado.push({ ...fila, estado, motivo: estadoDe.get(fila.mes)?.motivo || null, proyeccion });
  }
  return {
    meses,
    lineas_pyg: LINEAS,
    pyg: pygConEstado,
    mes_cerrado: mesCerrado,
    mes_anterior: cerrados.at(-2)?.mes || null,
    primera_linea: primerDia,
    clientes,
    cartera,
  };
}

// ¿Nos están pagando? Facturas de cliente publicadas con saldo, por antigüedad del vencimiento.
// `amount_residual` viene con IVA. La historia de Avancys empieza en agosto de 2026: lo anterior no
// está aquí.
const FACTURAS = 'account.move';
export const MAX_DEUDORES = 10;
const diaMenos = (hoy, dias) => new Date(Date.parse(`${hoy}T00:00:00Z`) - dias * 86400000).toISOString().slice(0, 10);

export async function carteraVencida(ejecutar, { hoy }) {
  const conSaldo = [['move_type', '=', 'out_invoice'], ['state', '=', 'posted'], ['amount_residual', '>', 0]];
  const sumar = async filtro => {
    const [grupo] = (await ejecutar(FACTURAS, 'read_group', [[...conSaldo, ...filtro], ['amount_residual:sum'], []], { lazy: false })) || [];
    return { saldo: Number(grupo?.amount_residual) || 0, facturas: grupo?.__count || 0 };
  };
  const total = await sumar([]);
  const vencido = await sumar([['invoice_date_due', '<', hoy]]);
  const tramos = [];
  for (const [etiqueta, desde, hasta] of [['1 a 30 días', 30, 0], ['31 a 60 días', 60, 30], ['61 a 90 días', 90, 60], ['Más de 90 días', null, 90]]) {
    const filtro = [['invoice_date_due', '<', diaMenos(hoy, hasta)]];
    if (desde !== null) filtro.push(['invoice_date_due', '>=', diaMenos(hoy, desde)]);
    tramos.push({ tramo: etiqueta, ...(await sumar(filtro)) });
  }
  const grupos = (await ejecutar(FACTURAS, 'read_group',
    [[...conSaldo, ['invoice_date_due', '<', hoy]], ['amount_residual:sum'], ['partner_id']],
    { lazy: false, orderby: 'amount_residual desc', limit: MAX_DEUDORES })) || [];
  const deudores = grupos
    .filter(grupo => Array.isArray(grupo.partner_id))
    .map(grupo => ({ cliente: String(grupo.partner_id[1]), vencido: Number(grupo.amount_residual) || 0, facturas: grupo.__count || 0 }));
  return { hoy, total, vencido, tramos, deudores };
}

let guardado = null;

function devengadoDeAvancys() {
  const lector = crearLectorAvancys();
  return mes => lector.devengadoDelMes({ mes, identificaciones: CLIENTES_MES_VENCIDO });
}

export async function torreAvancys({ refrescar = false, config = configuracionDeAvancys(), fetchImpl = globalThis.fetch, ahora = () => new Date(), devengado } = {}) {
  const momento = ahora().getTime();
  if (!refrescar && guardado && momento - guardado.en < VIGENCIA_MS) return { ...guardado.datos, desde_memoria: true };
  const sesion = await abrirSesion({ config, fetchImpl, ahora });
  if (!sesion.ejecutar) return sesion.estado;
  const datos = { ...(await calcularTorre(sesion.ejecutar, { ahora, devengado: devengado || devengadoDeAvancys() })), configurado: true, autenticado: true, origen: config.origen, medido_en: new Date(momento).toISOString() };
  guardado = { en: momento, datos };
  return { ...datos, desde_memoria: false };
}

export function olvidarTorre() { guardado = null; }
