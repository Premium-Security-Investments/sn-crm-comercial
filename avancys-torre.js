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

// Días que se le dan a Contabilidad para registrar un mes antes de darlo por cerrado si no lo
// bloquea en Avancys. El 2026-11-13 octubre llegaba al 88 % de la nómina sin estar completo, y la
// Torre mostró un margen de 22 % que no existía.
export const DIAS_PARA_CERRAR = 30;
const ultimoDia = mes => {
  const [anio, numero] = mes.split('-').map(Number);
  return new Date(Date.UTC(anio, numero, 0)).toISOString().slice(0, 10);
};
const sumarDias = (fecha, dias) => new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86400000).toISOString().slice(0, 10);

// El estado de cada mes. Cerrado: Contabilidad lo bloqueó en Avancys (fecha de bloqueo del periodo)
// o ya pasaron DIAS_PARA_CERRAR desde que terminó y su nómina está completa (al menos el 85 % de la
// mediana de los demás meses). Lo demás es parcial y se muestra como proyección.
export function marcarMeses(meses, mesActual, { hoy = null, bloqueo = null } = {}) {
  const pasados = meses.filter(fila => fila.mes < mesActual);
  return meses.map(fila => {
    if (fila.mes >= mesActual) return { ...fila, estado: 'parcial', motivo: 'Mes en curso' };
    const fin = ultimoDia(fila.mes);
    if (bloqueo && bloqueo >= fin) return { ...fila, estado: 'cerrado', motivo: null };
    if (hoy && hoy < sumarDias(fin, DIAS_PARA_CERRAR)) {
      return { ...fila, estado: 'parcial', motivo: 'Contabilidad todavía está registrando el mes' };
    }
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
  // Fecha de bloqueo del periodo en Avancys: cuando Contabilidad la usa, manda sobre la regla de días.
  let bloqueo = null;
  try {
    const [empresa] = (await ejecutar('res.company', 'search_read', [[]], { fields: ['period_lock_date'], limit: 1 })) || [];
    bloqueo = empresa?.period_lock_date || null;
  } catch { bloqueo = null; }
  // ¿Hay turnos programados en Avancys? Sin programación no hay costo por puesto ni por cliente: la Torre lo dice
  // en «¿Las fuentes están al día?». El módulo está instalado; si la consulta falla, no se afirma nada.
  let programaciones = null;
  try {
    const cuenta = await ejecutar('hr.roster.programacion', 'search_count', [[]]);
    programaciones = Number.isFinite(cuenta) ? cuenta : null;
  } catch { programaciones = null; }
  const meses = marcarMeses(pyg.map(fila => ({
    mes: fila.mes,
    ingresos: fila.totales.ingresos,
    personal: fila.totales.personal,
    otros_costos: fila.totales.antes_de_impuestos - fila.totales.ingresos - fila.totales.personal,
    margen: fila.totales.antes_de_impuestos,
  })), mesActual, { hoy: ahora().toISOString().slice(0, 10), bloqueo });
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
  // Saldo por cuenta de cada mes: no va a la pantalla; con él el servidor arma el presupuesto contra ejecución.
  const saldosCuentas = {};
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
    const { cuentas, ...resto } = fila;
    saldosCuentas[fila.mes] = { cuentas: cuentas || {}, ajuste_ingresos: fila.provision?.ajuste || 0, estado };
    pygConEstado.push({ ...resto, estado, motivo: estadoDe.get(fila.mes)?.motivo || null, proyeccion });
  }
  return {
    meses,
    lineas_pyg: LINEAS,
    pyg: pygConEstado,
    mes_cerrado: mesCerrado,
    mes_anterior: cerrados.at(-2)?.mes || null,
    primera_linea: primerDia,
    bloqueo_contable: bloqueo,
    programaciones_avancys: programaciones,
    clientes,
    cartera,
    saldos_cuentas: saldosCuentas,
  };
}

// ¿Nos están pagando? La cartera sale de la contabilidad, no de las facturas: las partidas abiertas de
// las cuentas de clientes (1305), con su fecha de vencimiento. Así entra la cartera que venía de
// Yeminus, que se cargó el 2026-07-31 como «saldos iniciales» (un asiento por factura original, con
// su vencimiento) y que las facturas de Avancys no muestran. `amount_residual` viene con IVA.
// Las consignaciones recibidas que nadie ha aplicado a un cliente (13051500) van aparte: es plata que
// entró y no se identificó.
const LINEAS_CONTABLES = 'account.move.line';
export const CUENTA_CONSIGNACIONES = '13051500';
export const MAX_DEUDORES = 10;
const diaMenos = (hoy, dias) => new Date(Date.parse(`${hoy}T00:00:00Z`) - dias * 86400000).toISOString().slice(0, 10);
const abiertas = [['parent_state', '=', 'posted'], ['reconciled', '=', false], ['amount_residual', '!=', 0]];
const deClientes = [['account_id.code', '=like', '1305%'], ['account_id.code', '!=', CUENTA_CONSIGNACIONES], ['account_id.internal_type', '=', 'receivable']];
// El tercero sale como «[SEDE] [NIT] NOMBRE»: se agrupa por NIT para juntar las sedes de un mismo cliente.
const nitDeNombre = nombre => (String(nombre).match(/\[(\d{6,})\]/) || [])[1] || null;
const nombreLimpio = nombre => String(nombre).replace(/^(\s*\[[^\]]*\]\s*)+/, '').trim();

export async function carteraVencida(ejecutar, { hoy }) {
  // La fecha de vencimiento manda; una partida sin ella (notas, cruces) cuenta desde su fecha contable.
  const vence = (desde, hasta) => ['|', '&', ['date_maturity', '!=', false], ...rango('date_maturity', desde, hasta), '&', ['date_maturity', '=', false], ...rango('date', desde, hasta)];
  const rango = (campo, desde, hasta) => {
    const filtro = [];
    if (hasta !== null) filtro.push([campo, '<', hasta]);
    if (desde !== null) filtro.push([campo, '>=', desde]);
    return filtro.length === 2 ? ['&', ...filtro] : filtro.length === 1 ? filtro : [[campo, '!=', false]];
  };
  const sumar = async (filtro = []) => {
    const [grupo] = (await ejecutar(LINEAS_CONTABLES, 'read_group', [[...abiertas, ...deClientes, ...filtro], ['amount_residual:sum'], []], { lazy: false })) || [];
    return { saldo: Number(grupo?.amount_residual) || 0, facturas: grupo?.__count || 0 };
  };
  const total = await sumar();
  const vencido = await sumar(vence(null, hoy));
  const tramos = [];
  for (const [etiqueta, desde, hasta] of [['1 a 30 días', 30, 0], ['31 a 60 días', 60, 30], ['61 a 90 días', 90, 60], ['Más de 90 días', null, 90]]) {
    tramos.push({ tramo: etiqueta, ...(await sumar(vence(desde === null ? null : diaMenos(hoy, desde), diaMenos(hoy, hasta)))) });
  }
  // Lo que viene de Yeminus (antes de agosto de 2026), para decir cuánto de lo vencido es herencia.
  const heredado = await sumar([['date', '<', '2026-08-01']]);
  const [consignacion] = (await ejecutar(LINEAS_CONTABLES, 'read_group',
    [[...abiertas, ['account_id.code', '=', CUENTA_CONSIGNACIONES]], ['amount_residual:sum'], []], { lazy: false })) || [];
  const grupos = (await ejecutar(LINEAS_CONTABLES, 'read_group',
    [[...abiertas, ...deClientes, ...vence(null, hoy)], ['amount_residual:sum'], ['partner_id']], { lazy: false })) || [];
  const porCliente = new Map();
  for (const grupo of grupos) {
    if (!Array.isArray(grupo.partner_id)) continue;
    const nombre = String(grupo.partner_id[1]);
    const clave = nitDeNombre(nombre) || nombreLimpio(nombre);
    const actual = porCliente.get(clave) || { cliente: nombre, vencido: 0, facturas: 0 };
    actual.vencido += Number(grupo.amount_residual) || 0;
    actual.facturas += grupo.__count || 0;
    porCliente.set(clave, actual);
  }
  const deudores = [...porCliente.values()].filter(fila => fila.vencido > 0).sort((a, b) => b.vencido - a.vencido).slice(0, MAX_DEUDORES);
  return {
    hoy, total, vencido, tramos, deudores,
    heredado_yeminus: heredado,
    consignaciones_sin_identificar: { saldo: -(Number(consignacion?.amount_residual) || 0), partidas: consignacion?.__count || 0 },
  };
}

let guardado = null;

// Los clientes de mes vencido son los que una persona marca en la ficha del cliente (`psi_cliente_provision`); Juan
// decidió el 2026-11-13 que esa lista manda. La lista fija de avancys-pyg.js queda sólo si la base no responde.
export async function clientesMesVencido(db) {
  if (!db) return CLIENTES_MES_VENCIDO;
  try {
    const { data, error } = await db.from('psi_cliente_provision').select('avancys_ref_num').eq('activo', true);
    if (error || !Array.isArray(data)) return CLIENTES_MES_VENCIDO;
    return data.map(fila => String(fila.avancys_ref_num || '').trim()).filter(Boolean);
  } catch {
    return CLIENTES_MES_VENCIDO;
  }
}

function devengadoDeAvancys(identificaciones) {
  const lector = crearLectorAvancys();
  return mes => lector.devengadoDelMes({ mes, identificaciones });
}

export async function torreAvancys({ refrescar = false, config = configuracionDeAvancys(), fetchImpl = globalThis.fetch, ahora = () => new Date(), devengado, db = null } = {}) {
  const momento = ahora().getTime();
  if (!refrescar && guardado && momento - guardado.en < VIGENCIA_MS) return { ...guardado.datos, desde_memoria: true };
  const sesion = await abrirSesion({ config, fetchImpl, ahora });
  if (!sesion.ejecutar) return sesion.estado;
  const datos = { ...(await calcularTorre(sesion.ejecutar, { ahora, devengado: devengado || devengadoDeAvancys(await clientesMesVencido(db)) })), configurado: true, autenticado: true, origen: config.origen, medido_en: new Date(momento).toISOString() };
  guardado = { en: momento, datos };
  return { ...datos, desde_memoria: false };
}

export function olvidarTorre() { guardado = null; }
