// Estado de resultados automático, con las mismas líneas que Finanzas arma a mano en el Excel del
// PYG (hoja "PYG NIIF"), pero en vivo desde la contabilidad de Avancys.
//
// Decisión de Juan del 2026-11-13: "usted deje montado el modelo; poco a poco vamos a afinar y le
// diremos a las áreas que ingresen bien la información en Avancys". Por eso el modelo dice siempre
// de dónde sale cada cifra y qué no pudo clasificar: eso es lo que las áreas tienen que corregir.
//
// Reconstrucción de agosto de 2026 contra el Excel (detalle en el handoff del 2026-11-13): 9 de 17
// líneas cuadran exacto. Las diferencias son la provisión de ingresos mes vencido (aquí se calcula),
// parte de la nómina y parte de equipos y costos indirectos, todavía sin explicar.
//
// Fuente: `account.move.line` publicado, agrupado por cuenta y mes (una sola consulta). Los valores
// van con signo de resultado: ingresos positivos, costos y gastos negativos.

export const LINEAS = Object.freeze([
  { clave: 'ing_vigilancia', etiqueta: 'Servicio de vigilancia', grupo: 'ingresos', cuentas: '4155 y 4175 de vigilancia' },
  { clave: 'ing_monitoreo', etiqueta: 'Servicio de monitoreo', grupo: 'ingresos', cuentas: '4155 y 4175 de monitoreo y telemática' },
  { clave: 'ing_comercializacion', etiqueta: 'Comercialización', grupo: 'ingresos', cuentas: '4135 y sus devoluciones' },
  { clave: 'mod_vigilancia', etiqueta: 'Mano de obra directa vigilancia', grupo: 'costos', cuentas: '7201–7204', personal: true },
  { clave: 'moi_vigilancia', etiqueta: 'Mano de obra indirecta vigilancia', grupo: 'costos', cuentas: '7301–7304', personal: true },
  { clave: 'cif_vigilancia', etiqueta: 'Costos indirectos de operación', grupo: 'costos', cuentas: 'resto de 72 y 73' },
  { clave: 'equipos', etiqueta: 'Equipos (medios tecnológicos)', grupo: 'costos', cuentas: '71' },
  { clave: 'mod_tecnicos', etiqueta: 'Mano de obra técnicos y monitores', grupo: 'costos', cuentas: '7250', personal: true },
  { clave: 'cif_mt', etiqueta: 'Costos indirectos medios tecnológicos', grupo: 'costos', cuentas: '7320, 735035, 735045, 735060, 735065, 735095' },
  { clave: 'personal_vigilancia', etiqueta: 'Gastos de personal vigilancia', grupo: 'gastos', cuentas: '5105', personal: true },
  { clave: 'generales_vigilancia', etiqueta: 'Gastos generales vigilancia', grupo: 'gastos', cuentas: 'resto de 51' },
  { clave: 'personal_mt', etiqueta: 'Gastos de personal medios tecnológicos', grupo: 'gastos', cuentas: '5205', personal: true },
  { clave: 'generales_mt', etiqueta: 'Gastos generales medios tecnológicos', grupo: 'gastos', cuentas: 'resto de 52' },
  { clave: 'otros_ingresos', etiqueta: 'Otros ingresos', grupo: 'no_operacional', cuentas: '42' },
  { clave: 'financieros', etiqueta: 'Gastos financieros', grupo: 'no_operacional', cuentas: '5305' },
  { clave: 'otros_gastos', etiqueta: 'Otros gastos no operacionales', grupo: 'no_operacional', cuentas: 'resto de 53' },
  { clave: 'renta', etiqueta: 'Impuesto de renta', grupo: 'impuestos', cuentas: '54' },
]);

const MEDIOS_TECNOLOGICOS = /MONITOR|TELEMAT|ELECTR[OÓ]NIC|GPS|GPRS|VALOR AGREGADO/i;
const CIF_MT = ['735035', '735045', '735060', '735065', '735095'];

// La línea del PYG a la que va una cuenta, o null si no es de resultados.
export function lineaDeCuenta(codigo, nombre = '') {
  const c = String(codigo || '');
  const c2 = c.slice(0, 2);
  const c4 = c.slice(0, 4);
  if (!/^[4-7]/.test(c)) return null;
  if (c4 === '4135' || (c4 === '4175' && /COMERCIALIZ/i.test(nombre))) return 'ing_comercializacion';
  if (c2 === '41') return MEDIOS_TECNOLOGICOS.test(nombre) ? 'ing_monitoreo' : 'ing_vigilancia';
  if (c2 === '42') return 'otros_ingresos';
  if (['7201', '7202', '7203', '7204'].includes(c4)) return 'mod_vigilancia';
  if (['7301', '7302', '7303', '7304'].includes(c4)) return 'moi_vigilancia';
  if (c4 === '7250') return 'mod_tecnicos';
  if (c2 === '71') return 'equipos';
  if (c4 === '7320' || CIF_MT.includes(c.slice(0, 6))) return 'cif_mt';
  if (c2 === '72' || c2 === '73') return 'cif_vigilancia';
  if (c4 === '5105') return 'personal_vigilancia';
  if (c2 === '51') return 'generales_vigilancia';
  if (c4 === '5205') return 'personal_mt';
  if (c2 === '52') return 'generales_mt';
  if (c4 === '5305') return 'financieros';
  if (c2 === '53') return 'otros_gastos';
  if (c2 === '54') return 'renta';
  return null; // 6, 74–79, 55–59: no aparecen en el PYG de Finanzas; se reportan aparte.
}

// Clientes que se facturan mes vencido: el servicio de un mes se factura al siguiente, y Finanzas
// provisiona el ingreso en el mes en que se prestó. Lista tomada de la hoja "Ingresos" del PYG de
// agosto de 2026 (los 8 que Avancys reconoce por NIT; faltan tres menores). Finanzas la confirma.
export const CLIENTES_MES_VENCIDO = Object.freeze([
  '890984761', // Empresa para la Seguridad y Soluciones Urbanas
  '890919291', // Terminales de Transporte de Medellín
  '891480085', // Departamento de Risaralda
  '891411663', // ESE Hospital Santa Mónica
  '800231235', // ESE Hospital Universitario San Jorge
  '890940720', // Edificio Terminal de Buses y Taxis
  '891401705', // Ingenio Risaralda
  '900163160', // Conjunto Residencial Reservas de Milán
]);

const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function mesDeEtiqueta(etiqueta) {
  const [nombre, anio] = String(etiqueta || '').toLowerCase().trim().split(/\s+/);
  let numero = MESES_ES.indexOf(nombre);
  if (numero < 0) numero = MESES_EN.indexOf(nombre);
  return numero >= 0 && /^\d{4}$/.test(anio || '') ? `${anio}-${String(numero + 1).padStart(2, '0')}` : null;
}
export function sumarMeses(mes, cuantos) {
  const [anio, numero] = mes.split('-').map(Number);
  return new Date(Date.UTC(anio, numero - 1 + cuantos, 1)).toISOString().slice(0, 7);
}

// Saldos de resultados por línea y mes, con una sola consulta a la contabilidad.
export async function saldosPorMes(ejecutar, { desde, hasta }) {
  const grupos = (await ejecutar('account.move.line', 'read_group',
    [[['date', '>=', `${desde}-01`], ['date', '<', `${hasta}-01`], ['parent_state', '=', 'posted']], ['balance:sum'], ['account_id', 'date:month']],
    { lazy: false })) || [];
  const meses = new Map();
  for (const grupo of grupos) {
    const mes = mesDeEtiqueta(grupo['date:month']);
    if (!mes || !Array.isArray(grupo.account_id)) continue;
    const [, codigo, nombre] = String(grupo.account_id[1]).match(/^\s*(\d+)\s*(.*)$/) || [];
    if (!codigo || !/^[4-7]/.test(codigo)) continue;
    const valor = -(Number(grupo.balance) || 0);
    const fila = meses.get(mes) || { mes, lineas: Object.fromEntries(LINEAS.map(l => [l.clave, 0])), sin_clasificar: new Map() };
    const clave = lineaDeCuenta(codigo, nombre);
    if (clave) fila.lineas[clave] += valor;
    else fila.sin_clasificar.set(codigo, { cuenta: `${codigo} ${nombre}`.trim(), valor: (fila.sin_clasificar.get(codigo)?.valor || 0) + valor });
    meses.set(mes, fila);
  }
  return meses;
}

const suma = (lineas, grupo) => LINEAS.filter(l => l.grupo === grupo).reduce((total, l) => total + (lineas[l.clave] || 0), 0);

// Totales como los presenta Finanzas.
export function totales(lineas) {
  const ingresos = suma(lineas, 'ingresos');
  const costos = suma(lineas, 'costos');
  const gastos = suma(lineas, 'gastos');
  const noOperacional = suma(lineas, 'no_operacional');
  const impuestos = suma(lineas, 'impuestos');
  const personal = LINEAS.filter(l => l.personal).reduce((total, l) => total + (lineas[l.clave] || 0), 0);
  return {
    ingresos,
    costos,
    margen_bruto: ingresos + costos,
    gastos,
    utilidad_ordinaria: ingresos + costos + gastos,
    no_operacional: noOperacional,
    antes_de_impuestos: ingresos + costos + gastos + noOperacional,
    impuestos,
    utilidad_neta: ingresos + costos + gastos + noOperacional + impuestos,
    personal,
  };
}

// El estado de resultados de cada mes: contabilidad + provisión de ingresos mes vencido.
// La provisión del mes suma el servicio prestado y no facturado; la del mes anterior se resta porque
// ya se facturó en este. `devengado(mes)` devuelve { total, clientes } para CLIENTES_MES_VENCIDO.
export async function estadoDeResultados(ejecutar, { desde, hasta, devengado }) {
  const saldos = await saldosPorMes(ejecutar, { desde, hasta });
  const provisiones = new Map();
  const provisionDe = async mes => {
    if (!provisiones.has(mes)) {
      try {
        provisiones.set(mes, await devengado(mes));
      } catch (error) {
        provisiones.set(mes, { total: 0, clientes: [], error: String(error?.message || error).split('\n')[0].slice(0, 200) });
      }
    }
    return provisiones.get(mes);
  };
  const meses = [];
  for (let mes = desde; mes < hasta; mes = sumarMeses(mes, 1)) {
    const fila = saldos.get(mes);
    if (!fila) continue;
    const actual = await provisionDe(mes);
    const anterior = await provisionDe(sumarMeses(mes, -1));
    const ajuste = (actual.total || 0) - (anterior.total || 0);
    const lineas = { ...fila.lineas, ing_vigilancia: fila.lineas.ing_vigilancia + ajuste };
    meses.push({
      mes,
      lineas,
      facturado_vigilancia: fila.lineas.ing_vigilancia,
      provision: {
        del_mes: actual.total || 0,
        del_mes_anterior: anterior.total || 0,
        ajuste,
        clientes: (actual.clientes || []).filter(k => k.devengado > 0).map(k => ({ nombre: k.nombre, identificacion: k.identificacion, devengado: k.devengado })),
        error: actual.error || anterior.error || null,
      },
      totales: totales(lineas),
      sin_clasificar: [...fila.sin_clasificar.values()].filter(c => Math.abs(c.valor) >= 1).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)).slice(0, 10),
    });
  }
  return meses;
}

// Lo que se le factura a los clientes en un mes según las órdenes de servicio aprobadas y vigentes
// en ese mes. Medido el 2026-11-13: para septiembre da menos de un 3 % de diferencia con lo
// contabilizado, así que sirve para proyectar el mes en curso.
export async function ingresosContratados(ejecutar, mes) {
  const [anio, numero] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(anio, numero, 0)).toISOString().slice(0, 10);
  const [grupo] = (await ejecutar('project.service.order.line.invoice', 'read_group',
    [[['state', '=', 'aprobado'], ['fact_start_date', '<=', ultimo], ['fact_end_date', '>=', `${mes}-01`]], ['valor_mensual:sum'], []],
    { lazy: false })) || [];
  return Number(grupo?.valor_mensual) || 0;
}

const GRUPOS_DE_COSTO = new Set(['costos', 'gastos', 'no_operacional', 'impuestos']);

// Proyección de un mes que todavía no está completo en la contabilidad (el mes en curso, o uno
// pasado con la nómina a medio contabilizar). Cada costo o gasto toma lo registrado o, si es
// menos, lo del último mes cerrado: los costos se causan hacia fin de mes. Los ingresos del mes en
// curso salen de lo contratado en las órdenes de servicio, repartido como en el mes cerrado; los de
// un mes pasado son los registrados. Cada línea dice si quedó estimada.
export function proyectarMes(fila, base, { ingresosOrdenes = null } = {}) {
  const lineas = { ...fila.lineas };
  const estimadas = [];
  for (const linea of LINEAS) {
    if (!GRUPOS_DE_COSTO.has(linea.grupo)) continue;
    const registrado = fila.lineas[linea.clave] || 0;
    const referencia = base.lineas[linea.clave] || 0;
    if (Math.abs(referencia) > Math.abs(registrado)) {
      lineas[linea.clave] = referencia;
      estimadas.push(linea.clave);
    }
  }
  if (ingresosOrdenes !== null) {
    const ingresosBase = LINEAS.filter(l => l.grupo === 'ingresos').reduce((total, l) => total + (base.lineas[l.clave] || 0), 0);
    if (ingresosBase) {
      for (const linea of LINEAS.filter(l => l.grupo === 'ingresos')) {
        lineas[linea.clave] = ingresosOrdenes * (base.lineas[linea.clave] || 0) / ingresosBase;
        estimadas.push(linea.clave);
      }
    }
  }
  return { lineas, totales: totales(lineas), estimadas, base_mes: base.mes, ingresos_ordenes: ingresosOrdenes };
}
