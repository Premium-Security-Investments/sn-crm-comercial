import type { Presupuesto } from './SiioTorreAvancys';
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
  const v = fila.vigilancia;
  const pasados = v.rubros.filter(rubro => rubro.diferencia !== null && rubro.diferencia >= TOLERANCIA);
  const sinConfirmar = presupuesto.sin_confirmar || [];
  return <section className="siio-presupuesto" aria-label="Presupuesto contra ejecución">
    <h3>Presupuesto contra ejecución · vigilancia</h3>
    <p>
      En {nombreMes(fila.mes)} la vigilancia dejó <strong>{porcentaje(v.rentabilidad)}</strong>
      {v.rentabilidad_presupuesto !== null ? <> contra <strong>{porcentaje(v.rentabilidad_presupuesto)}</strong> presupuestado</> : null}.
      {pasados.length ? <> Se pasan {pasados.length === 1 ? 'un rubro' : `${pasados.length} rubros`}: {pasados.map(rubro => rubro.etiqueta.toLowerCase()).join(', ')}.</> : null}
    </p>
    {fila.mes !== mes ? <p className="siio-pulse-footnote">{nombreMes(mes)} no está cerrado en la contabilidad: se compara {nombreMes(fila.mes)}, el último mes cerrado.</p> : null}
    <div className="siio-table-wrap"><table>
      <thead><tr><th>Rubro</th><th>Presupuesto</th><th>Ejecutado</th><th>Diferencia</th><th>Valor del mes</th></tr></thead>
      <tbody>{v.rubros.map(rubro => <tr key={rubro.clave} className={rubro.diferencia !== null && rubro.diferencia >= TOLERANCIA ? 'siio-fila-alerta' : undefined}>
        <td>{rubro.etiqueta}</td>
        <td>{porcentaje(rubro.presupuesto)}</td>
        <td>{porcentaje(rubro.pct)}</td>
        <td>{puntos(rubro.diferencia)}</td>
        <td>{millones(rubro.ejecutado)}</td>
      </tr>)}</tbody>
      <tfoot><tr><th>Ingresos de vigilancia</th><th /><th /><th /><th>{millones(v.ingresos)}</th></tr></tfoot>
    </table></div>
    <p className="siio-pulse-footnote">
      Tecnología, {nombreMes(fila.mes)}: ingresos {millones(fila.tecnologia.ingresos)}, rentabilidad {porcentaje(fila.tecnologia.rentabilidad)}. Sus rubros se abren cuando Finanzas confirme los nombres.
      {' '}Cada rubro es el % del ingreso de vigilancia, con la provisión de mes vencido, como en el Mapa de ejecución de Finanzas; no incluye los ajustes de cierre que no están en Avancys.
    </p>
    {sinConfirmar.length ? <p className="siio-pulse-footnote"><Badge tone="amber">Sin confirmar</Badge> El presupuesto y el mapeo de cuentas se sembraron del Excel; Finanzas los confirma en Parámetros.</p> : null}
    {fila.sin_mapeo_cuentas ? <p className="siio-pulse-footnote">
      {fila.sin_mapeo_cuentas === 1 ? '1 cuenta con movimiento no tiene rubro' : `${fila.sin_mapeo_cuentas} cuentas con movimiento no tienen rubro`}: {fila.sin_mapeo.map(item => `${item.cuenta} (${millones(item.valor)})`).join(', ')}. Se asignan en Parámetros.
    </p> : null}
  </section>;
}
