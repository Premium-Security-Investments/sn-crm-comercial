// AGT-001 / Gerencia: presupuesto contra ejecución, el «Mapa de ejecución» que Finanzas arma a mano en el Excel (hoja
// AnVal11), calculado con la contabilidad de Avancys.
//
// Cada cuenta suma en un rubro según el mapeo de Parámetros (punto 11). Rubro 0 = ingresos de vigilancia; 1–18 = los
// rubros de vigilancia; 20 = ingresos de tecnología; 21–40 = rubros de tecnología. Cada rubro se lee como % del ingreso
// de su unidad y se compara con el presupuesto del año (punto 1). La provisión de ingresos mes vencido suma al ingreso
// de vigilancia, igual que en el estado de resultados.
import { PARAMETROS_TABLE, RUBROS } from './siio-parametros.js';

const INGRESOS_VIGILANCIA = 0;
const INGRESOS_TECNOLOGIA = 20;
const MAX_SIN_MAPEO = 8;
const redondear = valor => Math.round(valor * 10) / 10;

// Puro. `meses`: { 'AAAA-MM': { cuentas: { codigo: valor }, ajuste_ingresos, estado } } con ingresos en positivo y
// costos en negativo; `mapeo`: [{ cuenta, rubro }]; `presupuestos`: { 'AAAA': { clave_rubro: { vigilancia } } }.
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
    const ingresosVigilancia = (porRubro.get(INGRESOS_VIGILANCIA) || 0) + (datos.ajuste_ingresos || 0);
    const presupuesto = presupuestos[mes.slice(0, 4)] || null;
    const rubros = RUBROS.map(rubro => {
      const ejecutado = -(porRubro.get(rubro.numero) || 0);
      const pct = ingresosVigilancia ? redondear((ejecutado / ingresosVigilancia) * 100) : null;
      const meta = presupuesto?.[rubro.clave]?.vigilancia;
      const presupuestado = Number.isFinite(meta) ? meta : null;
      return { clave: rubro.clave, etiqueta: rubro.etiqueta, ejecutado, pct, presupuesto: presupuestado, diferencia: pct !== null && presupuestado !== null ? redondear(pct - presupuestado) : null };
    });
    const costos = rubros.reduce((suma, fila) => suma + fila.ejecutado, 0);
    const presupuestoCompleto = rubros.every(fila => fila.presupuesto !== null || fila.ejecutado === 0);
    const sumaPresupuesto = rubros.reduce((suma, fila) => suma + (fila.presupuesto || 0), 0);
    let ingresosTecnologia = porRubro.get(INGRESOS_TECNOLOGIA) || 0;
    let costosTecnologia = 0;
    for (const [rubro, valor] of porRubro) if (rubro > INGRESOS_TECNOLOGIA) costosTecnologia -= valor;
    salida[mes] = {
      mes,
      estado: datos.estado || null,
      vigilancia: {
        ingresos: ingresosVigilancia,
        costos,
        rentabilidad: ingresosVigilancia ? redondear(((ingresosVigilancia - costos) / ingresosVigilancia) * 100) : null,
        rentabilidad_presupuesto: presupuesto && presupuestoCompleto ? redondear(100 - sumaPresupuesto) : null,
        rubros,
      },
      // Los rubros de tecnología no tienen nombre confirmado: por ahora sólo el total.
      tecnologia: {
        ingresos: ingresosTecnologia,
        costos: costosTecnologia,
        rentabilidad: ingresosTecnologia ? redondear(((ingresosTecnologia - costosTecnologia) / ingresosTecnologia) * 100) : null,
      },
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
