// AGT-001 / Gerencia: presupuesto contra ejecución, el «Mapa de ejecución» que Finanzas arma a mano en el Excel (hoja
// AnVal11), calculado con la contabilidad de Avancys.
//
// Cada cuenta suma en un rubro según el mapeo de Parámetros (punto 11); los rubros de cada unidad están en
// siio-parametros.js. Cada rubro se lee como % del ingreso de su unidad y se compara con el presupuesto del año (punto 1).
import { PARAMETROS_TABLE, UNIDADES } from './siio-parametros.js';

const MAX_SIN_MAPEO = 8;
const redondear = valor => Math.round(valor * 10) / 10;

// El presupuesto de un rubro: { vigilancia: { salarios: 49 } }. Acepta también la forma sembrada primero
// ({ salarios: { vigilancia: 49 } }) mientras quede alguna fila así en la base.
function metaDe(presupuesto, unidad, clave) {
  const valor = presupuesto?.[unidad]?.[clave] ?? presupuesto?.[clave]?.[unidad];
  return Number.isFinite(valor) ? valor : null;
}

function unidadDelMes(unidad, porRubro, ajusteIngresos, presupuesto) {
  const ingresos = (porRubro.get(unidad.ingresos) || 0) + ajusteIngresos;
  const rubros = unidad.rubros.map(rubro => {
    const ejecutado = -(porRubro.get(rubro.numero) || 0);
    const pct = ingresos ? redondear((ejecutado / ingresos) * 100) : null;
    const meta = presupuesto ? metaDe(presupuesto, unidad.clave, rubro.clave) : null;
    return { clave: rubro.clave, etiqueta: rubro.etiqueta, ejecutado, pct, presupuesto: meta, diferencia: pct !== null && meta !== null ? redondear(pct - meta) : null };
  });
  const costos = rubros.reduce((suma, fila) => suma + fila.ejecutado, 0);
  const conMeta = rubros.some(fila => fila.presupuesto !== null);
  const sumaPresupuesto = rubros.reduce((suma, fila) => suma + (fila.presupuesto || 0), 0);
  return {
    ingresos,
    costos,
    rentabilidad: ingresos ? redondear(((ingresos - costos) / ingresos) * 100) : null,
    rentabilidad_presupuesto: conMeta ? redondear(100 - sumaPresupuesto) : null,
    rubros,
  };
}

// Puro. `meses`: { 'AAAA-MM': { cuentas: { codigo: valor }, ajuste_ingresos, estado } } con ingresos en positivo y
// costos en negativo; `mapeo`: [{ cuenta, rubro }]; `presupuestos`: { 'AAAA': { vigilancia: {...}, tecnologia: {...} } }.
// La provisión de mes vencido es de vigilancia y suma a su ingreso, como en el estado de resultados.
export function presupuestoContraEjecucion({ meses = {}, mapeo = [], presupuestos = {} }) {
  const rubroDe = new Map(mapeo.filter(fila => fila?.cuenta && Number.isFinite(Number(fila.rubro))).map(fila => [String(fila.cuenta), Number(fila.rubro)]));
  const salida = {};
  for (const [mes, datos] of Object.entries(meses)) {
    const porRubro = new Map();
    const sinMapeo = [];
    for (const [cuenta, valor] of Object.entries(datos.cuentas || {})) {
      const rubro = rubroDe.get(cuenta);
      if (rubro === undefined) {
        if (Math.abs(valor) >= 1) sinMapeo.push({ cuenta, valor });
        continue;
      }
      porRubro.set(rubro, (porRubro.get(rubro) || 0) + valor);
    }
    const presupuesto = presupuestos[mes.slice(0, 4)] || null;
    const [vigilancia, tecnologia] = UNIDADES;
    salida[mes] = {
      mes,
      estado: datos.estado || null,
      vigilancia: unidadDelMes(vigilancia, porRubro, datos.ajuste_ingresos || 0, presupuesto),
      tecnologia: unidadDelMes(tecnologia, porRubro, 0, presupuesto),
      sin_mapeo: sinMapeo.sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)).slice(0, MAX_SIN_MAPEO),
      sin_mapeo_cuentas: sinMapeo.length,
      presupuesto_anio: presupuesto ? mes.slice(0, 4) : null,
    };
  }
  return salida;
}

// Agrega el presupuesto contra ejecución a la respuesta de la Torre y quita los saldos por cuenta, que no van a la
// pantalla. Si falta la tabla o el mapeo, la Torre sale igual y lo dice.
export async function agregarPresupuesto(db, datos) {
  if (!datos || !datos.saldos_cuentas) return datos;
  const { saldos_cuentas: meses, ...resto } = datos;
  try {
    const { data, error } = await db.from(PARAMETROS_TABLE).select('clave,periodo,valor,estado')
      .in('clave', ['mapeo_cuentas', 'presupuesto_rubros']).is('reemplazado_at', null);
    if (error) throw error;
    const mapeo = data.find(fila => fila.clave === 'mapeo_cuentas');
    if (!mapeo) return { ...resto, presupuesto: { disponible: false, motivo: 'Falta el mapeo cuenta → rubro en Parámetros.' } };
    const presupuestos = Object.fromEntries(data.filter(fila => fila.clave === 'presupuesto_rubros').map(fila => [fila.periodo, fila.valor]));
    const sinConfirmar = data.filter(fila => fila.estado === 'sin_confirmar').map(fila => fila.clave);
    return { ...resto, presupuesto: { disponible: true, sin_confirmar: sinConfirmar, meses: presupuestoContraEjecucion({ meses, mapeo: mapeo.valor, presupuestos }) } };
  } catch (error) {
    return { ...resto, presupuesto: { disponible: false, motivo: String(error?.message || error).split('\n')[0].slice(0, 200) } };
  }
}
