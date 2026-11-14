import type { Presupuesto, UnidadEjecucion } from './SiioTorreAvancys';

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
  const encabezado = (texto: string) => <h2>{texto} <span className="siio-chip confirmar">Por confirmar</span></h2>;
  if (!presupuesto.disponible) return <section className="siio-panel siio-presupuesto" aria-label="Presupuesto contra ejecución">
    {encabezado('Presupuesto contra ejecución')}
    <p className="siio-secondary">No se pudo calcular: {presupuesto.motivo}</p>
  </section>;
  const fila = mesComparable(presupuesto, mes);
  if (!fila) return <section className="siio-panel siio-presupuesto" aria-label="Presupuesto contra ejecución">
    {encabezado('Presupuesto contra ejecución')}
    <p className="siio-secondary">Todavía no hay un mes cerrado en Avancys hasta {nombreMes(mes)} para comparar.</p>
  </section>;
  return <section className="siio-panel siio-presupuesto" aria-label="Presupuesto contra ejecución">
    {encabezado(`Presupuesto contra ejecución · ${nombreMes(fila.mes).split(' ')[0]}`)}
    {fila.mes !== mes ? <p className="siio-nota">{nombreMes(mes)} no está cerrado en la contabilidad: se compara {nombreMes(fila.mes)}, el último mes cerrado.</p> : null}
    <div className="siio-dos-col">
      <Unidad nombre="Vigilancia" mes={fila.mes} u={fila.vigilancia} />
      <Unidad nombre="Tecnología" mes={fila.mes} u={fila.tecnologia} />
    </div>
    <p className="siio-nota">Cada rubro es el % del ingreso de su unidad, como en el Mapa de ejecución de Finanzas; el de vigilancia lleva la provisión de mes vencido. El presupuesto y el mapeo de cuentas se sembraron del Excel de Finanzas; Finanzas los confirma en Parámetros. No incluye ajustes de cierre que no estén en Avancys.</p>
    {fila.sin_mapeo_cuentas ? <p className="siio-nota">
      {fila.sin_mapeo_cuentas === 1 ? '1 cuenta con movimiento no tiene rubro' : `${fila.sin_mapeo_cuentas} cuentas con movimiento no tienen rubro`}: {fila.sin_mapeo.map(item => `${item.cuenta} (${millones(item.valor)})`).join(', ')}. Se asignan en Parámetros.
    </p> : null}
  </section>;
}

// Una unidad de negocio: la frase con la rentabilidad contra lo presupuestado, los rubros que se pasan con la
// diferencia como columna protagonista, y los rubros completos plegados.
function Unidad({ nombre, mes, u }: { nombre: string; mes: string; u: UnidadEjecucion }) {
  if (!u.ingresos) return <div className="siio-presupuesto-unidad"><h3>{nombre}</h3><p className="siio-secondary">Sin ingresos registrados en {nombreMes(mes)}.</p></div>;
  const pasados = u.rubros.filter(rubro => rubro.diferencia !== null && rubro.diferencia >= TOLERANCIA).sort((a, b) => (b.diferencia || 0) - (a.diferencia || 0));
  const mayor = Math.max(0.1, ...pasados.map(rubro => rubro.diferencia || 0));
  const conDato = u.rubros.filter(rubro => rubro.ejecutado || rubro.presupuesto);
  return <div className="siio-presupuesto-unidad">
    <h3>{nombre} · dejó {porcentaje(u.rentabilidad)}{u.rentabilidad_presupuesto !== null ? <> contra {porcentaje(u.rentabilidad_presupuesto)} presupuestado</> : null}</h3>
    {pasados.length ? <div className="siio-tabla-wrap"><table className="siio-tabla">
      <thead><tr><th>Rubro que se pasa</th><th className="num">Presupuesto</th><th className="num">Ejecutado</th><th className="num total">Diferencia</th></tr></thead>
      <tbody>{pasados.map(rubro => <tr key={rubro.clave}>
        <td>{rubro.etiqueta}</td>
        <td className="num"><strong>{porcentaje(rubro.presupuesto)}</strong></td>
        <td className="num mal"><strong>{porcentaje(rubro.pct)}</strong></td>
        <td className="num total mal"><strong>{puntos(rubro.diferencia)}</strong><span className="siio-magnitud"><i style={{ width: `${Math.round(((rubro.diferencia || 0) / mayor) * 100)}%` }} /></span></td>
      </tr>)}</tbody>
    </table></div> : <p className="siio-nota">Ningún rubro se pasa del presupuesto.</p>}
    <details className="siio-plegado">
      <summary>Los {u.rubros.length} rubros de {nombre.toLowerCase()}</summary>
      <div className="siio-tabla-wrap"><table className="siio-tabla">
        <thead><tr><th>Rubro</th><th className="num">Presupuesto</th><th className="num">Ejecutado</th><th className="num">Diferencia</th><th className="num">Valor del mes</th></tr></thead>
        <tbody>{conDato.map(rubro => { const pasa = rubro.diferencia !== null && rubro.diferencia >= TOLERANCIA; return <tr key={rubro.clave}>
          <td>{rubro.etiqueta}</td>
          <td className="num"><strong>{porcentaje(rubro.presupuesto)}</strong></td>
          <td className={`num${pasa ? ' mal' : ''}`}><strong>{porcentaje(rubro.pct)}</strong></td>
          <td className={`num${pasa ? ' mal' : ''}`}><strong>{puntos(rubro.diferencia)}</strong></td>
          <td className="num"><strong>{millones(rubro.ejecutado)}</strong></td>
        </tr>; })}</tbody>
        <tfoot><tr><th>Ingresos de {nombre.toLowerCase()}</th><th className="num" /><th className="num" /><th className="num" /><th className="num">{millones(u.ingresos)}</th></tr></tfoot>
      </table></div>
    </details>
  </div>;
}
