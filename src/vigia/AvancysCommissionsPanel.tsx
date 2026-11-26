import { Fragment, useEffect, useState } from 'react';
import { api } from '../apiClient';

type Pago = { fecha_pago: string; cliente: string | null; factura: string; fecha_factura: string; pagado_sin_iva: number; mensual_cliente: number; salarios_minimos: number; porcentaje: number; tabla?: string; inicio_contrato?: string; comision: number };
type Equipo = { factura: string; cliente: string | null; valor_sin_iva: number; porcentaje: number; comision: number };
type Monitoreo = { factura: string; cliente: string | null; paquete_sin_iva: number; comision: number };
type Comercial = { avancys_user_id: number | null; nombre: string | null; pagos: Pago[]; equipos?: Equipo[]; monitoreo?: Monitoreo[]; base: number; comision: number; comision_equipos?: number; comision_monitoreo?: number; total?: number };
type Revisar = { fecha: string; valor: number; texto: string; motivo: string };
type Comisiones = {
  mes: string; comerciales: Comercial[]; total_base?: number; total_comision?: number;
  sin_regla?: { monitoreo: number; comercializacion: number; otra: number }; saldos_anteriores?: number; revisar?: Revisar[];
  sin_fecha_contrato?: { abonos: number; base: number }; fuera_de_12_meses?: { abonos: number; base: number }; tabla_mitad_cargada?: number; contratos_cargados?: number;
  recaudos?: number; recortado?: boolean; as_of?: string | null; motivo: string | null; medido_en?: string; desde_guardado?: boolean;
};

const pesos = (valor: number) => `$ ${Math.round(valor || 0).toLocaleString('es-CO')}`;
const porcentaje = (valor: number) => `${(valor * 100).toLocaleString('es-CO', { maximumFractionDigits: 2 })} %`;
const dia = (iso: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const mesAnterior = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);

/**
 * Comisiones por pagos recibidos, leídas de Avancys (Juan, 2026-11-25): «se les paga por lo que ya haya pagado el
 * cliente; si paga parcial se le paga parcial». Por cada abono del mes, la parte antes de IVA por el porcentaje de la
 * tabla plana según lo que se le factura al cliente al mes. Es una REFERENCIA: el número que se paga es el de cartera.
 */
export function AvancysCommissionsPanel() {
  const [abierto, setAbierto] = useState(false);
  const [mes, setMes] = useState(mesAnterior());
  const [estado, setEstado] = useState<'inicio' | 'cargando' | 'listo' | 'error'>('inicio');
  const [datos, setDatos] = useState<Comisiones | null>(null);
  const [error, setError] = useState('');
  const [actualizando, setActualizando] = useState(false);
  const [abiertoDe, setAbiertoDe] = useState<string | null>(null);
  useEffect(() => {
    if (!abierto || !/^\d{4}-\d{2}$/.test(mes)) return;
    let vigente = true;
    const url = `/api/agt003/avancys/comisiones?mes=${encodeURIComponent(mes)}`;
    (async () => {
      setEstado('cargando'); setError(''); setDatos(null);
      let tengo = false;
      try {
        const guardado = await api<Comisiones>(`${url}&guardada=1`);
        if (!vigente) return;
        setDatos(guardado); setEstado('listo'); tengo = true;
        if (!guardado.desde_guardado) return;
      } catch { /* sigue con el vivo */ }
      setActualizando(true);
      try {
        const r = await api<Comisiones>(url);
        if (vigente) { setDatos(r); setEstado('listo'); }
      } catch (err) {
        if (!vigente || tengo) return;
        setError(err instanceof Error ? err.message : String(err)); setEstado('error');
      } finally {
        if (vigente) setActualizando(false);
      }
    })();
    return () => { vigente = false; };
  }, [abierto, mes]);

    return <details className="panel dashboard-details" onToggle={event => setAbierto((event.currentTarget as HTMLDetailsElement).open)}>
    <summary>Comisiones por pagos recibidos (Avancys) · referencia</summary>
    <label className="avancys-cobro-mes">Mes de pago <input type="month" value={mes} onChange={event => setMes(event.target.value)} /></label>
    <p className="muted">Regla base: «Comisiones Comerciales Condiciones 2026». Vigilancia: sobre lo que el cliente pagó en el mes, antes de IVA, con el porcentaje del tramo según lo que se le factura al mes (hasta 60 salarios mínimos 0,70 %; 120, 0,56 %; 200, 0,42 %; más, 0,28 %; licitaciones y clientes de la tabla de Juan Carlos Martínez con su propia tabla), sólo durante los 12 meses siguientes a la firma del contrato o su renovación. Equipos: una vez, cuando la factura queda pagada (5 % a 2 % por tramos). Monitoreo: un paquete mensual, cuando el cliente nuevo paga su primera factura. Es una referencia: el valor que se paga lo valida cartera.</p>
    {estado === 'cargando' && <p className="muted">Consultando Avancys… son miles de pagos, tarda unos segundos.</p>}
    {estado === 'error' && <p className="muted">No fue posible consultar Avancys: {error}</p>}
    {estado === 'listo' && datos?.motivo && <p className="muted">{datos.motivo}</p>}
    {estado === 'listo' && datos && !datos.motivo && <>
      {datos.desde_guardado ? <p className="muted">Cálculo del {datos.medido_en ? new Date(datos.medido_en).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'último cargue'}{actualizando ? ' · actualizando…' : ''}</p> : null}
      <p className="muted">{datos.recaudos ?? 0} abonos a cartera en el mes · vigilancia con comisión {pesos(datos.total_base || 0)} · comisión total {pesos(datos.total_comision || 0)}{datos.recortado ? ' · La lectura pudo quedar incompleta.' : ''}</p>
      <div className="tablewrap crm-readable-table avancys-cobro-table"><table><thead><tr><th>Comercial del cliente</th><th>Vigilancia</th><th>Equipos</th><th>Monitoreo</th><th>Total</th></tr></thead>
        <tbody>{datos.comerciales.map(c => {
          const clave = String(c.avancys_user_id);
          return <Fragment key={clave}>
            <tr>
              <td><strong>{c.nombre || 'Cliente sin comercial asignado'}</strong><br /><button type="button" className="link-button" aria-expanded={abiertoDe === clave} onClick={() => setAbiertoDe(actual => (actual === clave ? null : clave))}>{abiertoDe === clave ? 'Ocultar pagos' : 'Ver pagos'}</button></td>
              <td className="money-cell">{pesos(c.comision)}<small className="muted">{c.pagos.length} {c.pagos.length === 1 ? 'pago' : 'pagos'}</small></td>
              <td className="money-cell">{pesos(c.comision_equipos || 0)}<small className="muted">{(c.equipos || []).length} {(c.equipos || []).length === 1 ? 'factura' : 'facturas'}</small></td>
              <td className="money-cell">{pesos(c.comision_monitoreo || 0)}<small className="muted">{(c.monitoreo || []).length} {(c.monitoreo || []).length === 1 ? 'cliente' : 'clientes'}</small></td>
              <td className="money-cell"><strong>{pesos(c.total ?? c.comision)}</strong></td>
            </tr>
            {abiertoDe === clave && <tr className="commission-detail-row"><td colSpan={5}>
              <div className="tablewrap"><table><thead><tr><th>Pago</th><th>Cliente</th><th>Factura</th><th>Pagado sin IVA</th><th>Mensual del cliente</th><th>%</th><th>Comisión</th></tr></thead>
                <tbody>{c.pagos.map((p, i) => <tr key={`${p.factura}-${i}`}>
                  <td>{dia(p.fecha_pago)}</td><td>{p.cliente || '—'}</td><td>{p.factura} <small className="muted">({dia(p.fecha_factura)})</small></td>
                  <td className="money-cell">{pesos(p.pagado_sin_iva)}</td>
                  <td className="money-cell">{pesos(p.mensual_cliente)} <small className="muted">({p.salarios_minimos.toLocaleString('es-CO')} SMLMV)</small></td>
                  <td className="numeric-value">{porcentaje(p.porcentaje)}</td>
                  <td className="money-cell">{pesos(p.comision)}</td>
                </tr>)}</tbody></table></div>
              {!!c.equipos?.length && <div className="tablewrap"><table><thead><tr><th>Equipos · factura</th><th>Cliente</th><th>Valor sin IVA</th><th>%</th><th>Comisión</th></tr></thead>
                <tbody>{c.equipos.map(e => <tr key={e.factura}><td>{e.factura}</td><td>{e.cliente || '—'}</td><td className="money-cell">{pesos(e.valor_sin_iva)}</td><td className="numeric-value">{porcentaje(e.porcentaje)}</td><td className="money-cell">{pesos(e.comision)}</td></tr>)}</tbody></table></div>}
              {!!c.monitoreo?.length && <div className="tablewrap"><table><thead><tr><th>Monitoreo · primera factura</th><th>Cliente</th><th>Paquete mensual sin IVA</th><th>Comisión</th></tr></thead>
                <tbody>{c.monitoreo.map(m => <tr key={m.factura}><td>{m.factura}</td><td>{m.cliente || '—'}</td><td className="money-cell">{pesos(m.paquete_sin_iva)}</td><td className="money-cell">{pesos(m.comision)}</td></tr>)}</tbody></table></div>}
            </td></tr>}
          </Fragment>;
        })}</tbody></table></div>
      {!!datos.sin_fecha_contrato?.abonos && <p className="muted">Sin fecha de contrato ({datos.sin_fecha_contrato.abonos} abonos de vigilancia, {pesos(datos.sin_fecha_contrato.base)} antes de IVA): el cliente no está en el archivo de contratos y ya estaba cuando arrancó Avancys. No se cuentan hasta saber cuándo se firmó.</p>}
      {!!datos.fuera_de_12_meses?.abonos && <p className="muted">Fuera de los 12 meses: {datos.fuera_de_12_meses.abonos} abonos ({pesos(datos.fuera_de_12_meses.base)} antes de IVA) de contratos firmados hace más de un año.</p>}
      {datos.tabla_mitad_cargada === 0 && <p className="muted">Todavía no está cargada la lista de clientes de la tabla de Juan Carlos Martínez: hoy todos van con la tabla de comerciales.</p>}
      <p className="muted">Todavía sin calcular: la renovación hecha sin sustentación (50 %) y la comisión del director y del coordinador.</p>
      {!!datos.saldos_anteriores && <p className="muted">Abonos a saldos de antes de Avancys (no son comisiones nuevas): {pesos(datos.saldos_anteriores)}.</p>}
      {!!datos.revisar?.length && <details><summary>Revisar con cartera ({datos.revisar.length})</summary>
        <ul className="quote-list">{datos.revisar.map((r, i) => <li key={i}><span><strong>{dia(r.fecha)} · {pesos(r.valor)}</strong> · {r.motivo} <small className="muted">{r.texto}</small></span></li>)}</ul>
      </details>}
    </>}
  </details>;
}
