import type { Presupuesto, UnidadEjecucion } from './SiioTorreAvancys';
import { Badge } from './SiioUi';

// Presupuesto contra ejecución: el «Mapa de ejecución» de Finanzas (hoja AnVal11) calculado con Avancys y con el
// mapeo y el presupuesto de Parámetros. Sólo se compara un mes cerrado: con la nómina a medias los rubros no dicen nada.

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;
const millones = (valor: number) => `${valor < 0 ? '−' : ''}$${Math.round(Math.abs(valor) / 1e6).toLocaleString('es-CO')} M`;
const porcentaje = (valor: number | null) => (valor === null ? '—' : `${valor.toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`);
const puntos = (valor: number | null) => (valor === null ? '—' : `${valor > 0 ? '+' : valor < 0 ? '−' : ''}${Math.abs(valor).toLocaleString('es-CO', { maximumFractionDigits: 1 })} pts`);
// Un rubro se marca cuando se pasa medio punto del ingreso: en vigilancia medio punto son decenas de millones al mes.
const TOLERANCIA = 0.5;

// El mes que se compara: el elegido si está cerrado; si no, el último cerrado antes de él.
export function mesComparable(presupuesto: Presupuesto | null, mes: string) {
  const meses = Object.values(presupuesto?.meses || {}).filter(fila => fila.estado === 'cerrado' && fila.mes <= mes).sort((a, b) => a.mes.localeCompare(b.mes));
  return meses[meses.length - 1] || null;
}

export function SiioPresupuesto({ presupuesto, mes }: { presupuesto: Presupuesto | null; mes: string }) {
  if (!presupuesto) return null;
  if (!presupuesto.disponible) return <section className="siio-presupuesto" aria-label="Presupuesto contra ejecución">
    <h3>Presupuesto contra ejecución</h3>
    <p className="siio-secondary">No se pudo calcular: {presupuesto.motivo}</p>
  </section>;
  const fila = mesComparable(presupuesto, mes);
  if (!fila) return <section className="siio-presupuesto" aria-label="Presupuesto contra ejecución">
    <h3>Presupuesto contra ejecución</h3>
    <p className="siio-secondary">Todavía no hay un mes cerrado en Avancys hasta {nombreMes(mes)} para comparar.</p>
  </section>;
  const sinConfirmar = presupuesto.sin_confirmar || [];
  return <section className="siio-presupuesto" aria-label="Presupuesto contra ejecución">
    <h3>Presupuesto contra ejecución</h3>
    {fila.mes !== mes ? <p className="siio-pulse-footnote">{nombreMes(mes)} no está cerrado en la contabilidad: se compara {nombreMes(fila.mes)}, el último mes cerrado.</p> : null}
    <Unidad nombre="Vigilancia" mes={fila.mes} u={fila.vigilancia} />
    <Unidad nombre="Tecnología" mes={fila.mes} u={fila.tecnologia} />
    <p className="siio-pulse-footnote">
      Cada rubro es el % del ingreso de su unidad, como en el Mapa de ejecución de Finanzas; el de vigilancia lleva la provisión de mes vencido. No incluye los ajustes de cierre que no están en Avancys.
    </p>
    {sinConfirmar.length ? <p className="siio-pulse-footnote"><Badge tone="amber">Sin confirmar</Badge> El presupuesto y el mapeo de cuentas se sembraron del Excel; Finanzas los confirma en Parámetros.</p> : null}
    {fila.sin_mapeo_cuentas ? <p className="siio-pulse-footnote">
      {fila.sin_mapeo_cuentas === 1 ? '1 cuenta con movimiento no tiene rubro' : `${fila.sin_mapeo_cuentas} cuentas con movimiento no tienen rubro`}: {fila.sin_mapeo.map(item => `${item.cuenta} (${millones(item.valor)})`).join(', ')}. Se asignan en Parámetros.
    </p> : null}
  </section>;
}

function Unidad({ nombre, mes, u }: { nombre: string; mes: string; u: UnidadEjecucion }) {
  if (!u.ingresos) return <p className="siio-secondary">{nombre}: sin ingresos registrados en {nombreMes(mes)}.</p>;
  const pasados = u.rubros.filter(rubro => rubro.diferencia !== null && rubro.diferencia >= TOLERANCIA);
  return <div className="siio-presupuesto-unidad">
    <h4>{nombre}</h4>
    <p>
      En {nombreMes(mes)} dejó <strong>{porcentaje(u.rentabilidad)}</strong>
      {u.rentabilidad_presupuesto !== null ? <> contra <strong>{porcentaje(u.rentabilidad_presupuesto)}</strong> presupuestado</> : null}.
      {pasados.length ? <> Se pasan {pasados.length === 1 ? 'un rubro' : `${pasados.length} rubros`}: {pasados.map(rubro => rubro.etiqueta.toLowerCase()).join(', ')}.</> : null}
    </p>
    <div className="siio-table-wrap"><table>
      <thead><tr><th>Rubro</th><th>Presupuesto</th><th>Ejecutado</th><th>Diferencia</th><th>Valor del mes</th></tr></thead>
      <tbody>{u.rubros.filter(rubro => rubro.ejecutado || rubro.presupuesto).map(rubro => <tr key={rubro.clave} className={rubro.diferencia !== null && rubro.diferencia >= TOLERANCIA ? 'siio-fila-alerta' : undefined}>
        <td>{rubro.etiqueta}</td>
        <td>{porcentaje(rubro.presupuesto)}</td>
        <td>{porcentaje(rubro.pct)}</td>
        <td>{puntos(rubro.diferencia)}</td>
        <td>{millones(rubro.ejecutado)}</td>
      </tr>)}</tbody>
      <tfoot><tr><th>Ingresos de {nombre.toLowerCase()}</th><th /><th /><th /><th>{millones(u.ingresos)}</th></tr></tfoot>
    </table></div>
  </div>;
}
