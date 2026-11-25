import { Fragment, useEffect, useState } from 'react';
import { api } from '../apiClient';

type Pago = { fecha_pago: string; cliente: string | null; factura: string; fecha_factura: string; pagado_sin_iva: number; mensual_cliente: number; salarios_minimos: number; porcentaje: number; comision: number };
type Comercial = { avancys_user_id: number | null; nombre: string | null; pagos: Pago[]; base: number; comision: number };
type Revisar = { fecha: string; valor: number; texto: string; motivo: string };
type Comisiones = {
  mes: string; comerciales: Comercial[]; total_base?: number; total_comision?: number;
  sin_regla?: { monitoreo: number; comercializacion: number; otra: number }; saldos_anteriores?: number; revisar?: Revisar[];
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

  const sinRegla = datos?.sin_regla;
  return <details className="panel dashboard-details" onToggle={event => setAbierto((event.currentTarget as HTMLDetailsElement).open)}>
    <summary>Comisiones por pagos recibidos (Avancys) · referencia</summary>
    <label className="avancys-cobro-mes">Mes de pago <input type="month" value={mes} onChange={event => setMes(event.target.value)} /></label>
    <p className="muted">Lo que los clientes pagaron en el mes, antes de IVA, y la comisión de vigilancia con la tabla plana: hasta 60 salarios mínimos al mes, 0,70 %; hasta 120, 0,56 %; hasta 200, 0,42 %; más, 0,28 %. Si el cliente pagó una parte, cuenta esa parte. El valor mensual es lo que Avancys le facturó al cliente por Servicios en el mes de la factura. Es una referencia: el valor que se paga lo valida cartera.</p>
    {estado === 'cargando' && <p className="muted">Consultando Avancys… son miles de pagos, tarda unos segundos.</p>}
    {estado === 'error' && <p className="muted">No fue posible consultar Avancys: {error}</p>}
    {estado === 'listo' && datos?.motivo && <p className="muted">{datos.motivo}</p>}
    {estado === 'listo' && datos && !datos.motivo && <>
      {datos.desde_guardado ? <p className="muted">Cálculo del {datos.medido_en ? new Date(datos.medido_en).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'último cargue'}{actualizando ? ' · actualizando…' : ''}</p> : null}
      <p className="muted">{datos.recaudos ?? 0} abonos a cartera en el mes · vigilancia pagada {pesos(datos.total_base || 0)} · comisión {pesos(datos.total_comision || 0)}{datos.recortado ? ' · La lectura pudo quedar incompleta.' : ''}</p>
      <div className="tablewrap crm-readable-table avancys-cobro-table"><table><thead><tr><th>Comercial del cliente</th><th>Pagos</th><th>Pagado antes de IVA</th><th>Comisión</th></tr></thead>
        <tbody>{datos.comerciales.map(c => {
          const clave = String(c.avancys_user_id);
          return <Fragment key={clave}>
            <tr>
              <td><strong>{c.nombre || 'Cliente sin comercial asignado'}</strong><br /><button type="button" className="link-button" aria-expanded={abiertoDe === clave} onClick={() => setAbiertoDe(actual => (actual === clave ? null : clave))}>{abiertoDe === clave ? 'Ocultar pagos' : 'Ver pagos'}</button></td>
              <td className="numeric-value">{c.pagos.length}</td>
              <td className="money-cell">{pesos(c.base)}</td>
              <td className="money-cell"><strong>{pesos(c.comision)}</strong></td>
            </tr>
            {abiertoDe === clave && <tr className="commission-detail-row"><td colSpan={4}>
              <div className="tablewrap"><table><thead><tr><th>Pago</th><th>Cliente</th><th>Factura</th><th>Pagado sin IVA</th><th>Mensual del cliente</th><th>%</th><th>Comisión</th></tr></thead>
                <tbody>{c.pagos.map((p, i) => <tr key={`${p.factura}-${i}`}>
                  <td>{dia(p.fecha_pago)}</td><td>{p.cliente || '—'}</td><td>{p.factura} <small className="muted">({dia(p.fecha_factura)})</small></td>
                  <td className="money-cell">{pesos(p.pagado_sin_iva)}</td>
                  <td className="money-cell">{pesos(p.mensual_cliente)} <small className="muted">({p.salarios_minimos.toLocaleString('es-CO')} SMLMV)</small></td>
                  <td className="numeric-value">{porcentaje(p.porcentaje)}</td>
                  <td className="money-cell">{pesos(p.comision)}</td>
                </tr>)}</tbody></table></div>
            </td></tr>}
          </Fragment>;
        })}</tbody></table></div>
      {sinRegla && (sinRegla.monitoreo > 0 || sinRegla.comercializacion > 0) && <p className="muted">Sin regla de comisión en el CRM todavía (se muestra lo pagado, antes de IVA): monitoreo {pesos(sinRegla.monitoreo)} · comercialización {pesos(sinRegla.comercializacion)}.</p>}
      <p className="muted">Todavía no se marcan las renovaciones ni los clientes entregados por la gerencia (van al 50 %): aquí todo se calcula al 100 %.</p>
      {!!datos.saldos_anteriores && <p className="muted">Abonos a saldos de antes de Avancys (no son comisiones nuevas): {pesos(datos.saldos_anteriores)}.</p>}
      {!!datos.revisar?.length && <details><summary>Revisar con cartera ({datos.revisar.length})</summary>
        <ul className="quote-list">{datos.revisar.map((r, i) => <li key={i}><span><strong>{dia(r.fecha)} · {pesos(r.valor)}</strong> · {r.motivo} <small className="muted">{r.texto}</small></span></li>)}</ul>
      </details>}
    </>}
  </details>;
}
