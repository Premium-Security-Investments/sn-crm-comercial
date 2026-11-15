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

// El mes que se compara: el elegido, aunque no tenga cierre formal (se dice con su chip, Juan 2026-11-15); nunca el
// mes en curso, que con la nómina a medias no dice nada: en ese caso, el anterior.
export function mesComparable(presupuesto: Presupuesto | null, mes: string, hoy = new Date()) {
  const enCurso = hoy.toISOString().slice(0, 7);
  const meses = Object.values(presupuesto?.meses || {}).filter(fila => fila.mes <= mes && fila.mes < enCurso).sort((a, b) => a.mes.localeCompare(b.mes));
  return meses[meses.length - 1] || null;
}
type Cierre = { tono: string; texto: string };

export function SiioPresupuesto({ presupuesto, mes, cierreDe }: { presupuesto: Presupuesto | null; mes: string; cierreDe?: (mes: string) => Cierre }) {
  if (!presupuesto) return null;
  const encabezado = (texto: string) => <h2>{texto} <span className="siio-chip confirmar">Por confirmar</span></h2>;
  if (!presupuesto.disponible) return <section className="siio-panel siio-presupuesto" aria-label="Presupuesto contra ejecución">
    {encabezado('Presupuesto contra ejecución')}
    <p className="siio-secondary">No se pudo calcular: {presupuesto.motivo}</p>
  </section>;
  const fila = mesComparable(presupuesto, mes);
  if (!fila) return <section className="siio-panel siio-presupuesto" aria-label="Presupuesto contra ejecución">
    {encabezado('Presupuesto contra ejecución')}
    <p className="siio-secondary">Todavía no hay un mes terminado en Avancys hasta {nombreMes(mes)} para comparar.</p>
  </section>;
  const cierre = cierreDe ? cierreDe(fila.mes) : null;
  // Corto (Resultados con fuerza, Juan 2026-11-15): vigilancia dice si va dentro del presupuesto y qué rubros se pasan,
  // en barras con la raya del presupuesto; tecnología, en una nota mientras Finanzas no la confirme; el detalle, plegado.
  const v = fila.vigilancia;
  const pasados = v.rubros.filter(rubro => rubro.diferencia !== null && rubro.diferencia >= TOLERANCIA).sort((a, b) => (b.diferencia || 0) - (a.diferencia || 0)).slice(0, 5);
  const escala = Math.max(1, ...pasados.flatMap(rubro => [rubro.pct || 0, rubro.presupuesto || 0])) * 1.1;
  const dentro = v.rentabilidad !== null && v.rentabilidad_presupuesto !== null && v.rentabilidad >= v.rentabilidad_presupuesto;
  const tec = fila.tecnologia;
  const desvioTec = [...tec.rubros].filter(rubro => rubro.diferencia !== null).sort((a, b) => (b.diferencia || 0) - (a.diferencia || 0))[0];
  return <section className="siio-panel siio-presupuesto" aria-label="Presupuesto contra ejecución">
    <h2>¿Vamos dentro del presupuesto? <span className="siio-chip confirmar">Presupuesto por confirmar</span></h2>
    <p className="siio-nota" style={{ marginTop: 4 }}>{nombreMes(fila.mes).replace(/^./, letra => letra.toUpperCase())}{cierre && cierre.tono !== 'cerrado' ? ` · ${cierre.texto.toLowerCase()}` : ''}{fila.mes !== mes ? (mes >= new Date().toISOString().slice(0, 7) ? ` (${nombreMes(mes)} va a hoy)` : ` (${nombreMes(mes)} no tiene la ejecución calculada)`) : ''}</p>
    {v.ingresos ? <p className="siio-presupuesto-lead"><strong className={dentro ? 'bien' : 'mal'}>Vigilancia dejó {porcentaje(v.rentabilidad)}</strong>{v.rentabilidad_presupuesto !== null ? <> contra {porcentaje(v.rentabilidad_presupuesto)} presupuestado</> : null}{pasados.length ? '; estos rubros se pasan (la raya es el presupuesto, en % del ingreso):' : '; ningún rubro se pasa del presupuesto.'}</p> : null}
    {pasados.length ? <div className="siio-barras-ppto">{pasados.map(rubro => <div key={rubro.clave} className="fila">
      <span className="rubro">{rubro.etiqueta}</span>
      <span className="pista" title={`Ejecutado ${porcentaje(rubro.pct)} · presupuesto ${porcentaje(rubro.presupuesto)}`}><b style={{ width: `${((rubro.pct || 0) / escala) * 100}%` }} /><u style={{ left: `${((rubro.presupuesto || 0) / escala) * 100}%` }} /></span>
      <span className="dif">{puntos(rubro.diferencia)}</span>
    </div>)}</div> : null}
    {tec.ingresos ? <p className="siio-nota" style={{ marginTop: 10 }}><span className="siio-chip confirmar">Por confirmar con Finanzas</span> Tecnología dejó {porcentaje(tec.rentabilidad)}{tec.rentabilidad_presupuesto !== null ? ` contra ${porcentaje(tec.rentabilidad_presupuesto)}` : ''}{desvioTec && (desvioTec.diferencia || 0) >= 10 ? `; ${desvioTec.etiqueta.toLowerCase()} le suma ${porcentaje(desvioTec.pct)} del ingreso: parece un problema de asignación de cuentas` : ''}.</p> : null}
    <details className="siio-plegado">
      <summary>Todos los rubros de vigilancia y tecnología</summary>
      <div className="siio-dos-col">
        <Unidad nombre="Vigilancia" mes={fila.mes} u={fila.vigilancia} />
        <Unidad nombre="Tecnología" mes={fila.mes} u={fila.tecnologia} porConfirmar />
      </div>
      <p className="siio-nota">Cada rubro es el % del ingreso de su unidad, como en el Mapa de ejecución de Finanzas; el de vigilancia lleva la provisión de mes vencido. El presupuesto y el mapeo de cuentas se sembraron del Excel de Finanzas; Finanzas los confirma en Parámetros. No incluye ajustes de cierre que no estén en Avancys.</p>
      {fila.sin_mapeo_cuentas ? <p className="siio-nota">
        {fila.sin_mapeo_cuentas === 1 ? '1 cuenta con movimiento no tiene rubro' : `${fila.sin_mapeo_cuentas} cuentas con movimiento no tienen rubro`}: {fila.sin_mapeo.map(item => `${item.cuenta} (${millones(item.valor)})`).join(', ')}. Se asignan en Parámetros.
      </p> : null}
    </details>
  </section>;
}

// Una unidad de negocio: la frase con la rentabilidad contra lo presupuestado, los rubros que se pasan con la
// diferencia como columna protagonista, y los rubros completos plegados.
function Unidad({ nombre, mes, u, porConfirmar = false }: { nombre: string; mes: string; u: UnidadEjecucion; porConfirmar?: boolean }) {
  if (!u.ingresos) return <div className="siio-presupuesto-unidad"><h3>{nombre}</h3><p className="siio-secondary">Sin ingresos registrados en {nombreMes(mes)}.</p></div>;
  const pasados = u.rubros.filter(rubro => rubro.diferencia !== null && rubro.diferencia >= TOLERANCIA).sort((a, b) => (b.diferencia || 0) - (a.diferencia || 0));
  const mayor = Math.max(0.1, ...pasados.map(rubro => rubro.diferencia || 0));
  const conDato = u.rubros.filter(rubro => rubro.ejecutado || rubro.presupuesto);
  return <div className="siio-presupuesto-unidad">
    <h3>{nombre} · dejó {porcentaje(u.rentabilidad)}{u.rentabilidad_presupuesto !== null ? <> contra {porcentaje(u.rentabilidad_presupuesto)} presupuestado</> : null}</h3>
    {porConfirmar ? <p className="siio-nota"><span className="siio-chip confirmar">Por confirmar con Finanzas</span> la rentabilidad cambia mucho de un mes a otro: parece que hay costos de {nombre.toLowerCase()} que no están en sus cuentas.</p> : null}
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
