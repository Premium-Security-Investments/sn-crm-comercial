import { useEffect, useState } from 'react';
import { api } from '../apiClient';

type Estado = { estado: string; facturas: number; facturado: number };
type Comercial = { avancys_user_id: number | null; nombre: string | null; facturas: number; facturado: number; pagado: number; pendiente: number };
type Cobro = { mes: string; facturas: number; recortado?: boolean; estados: Estado[]; comerciales: Comercial[]; as_of: string | null; motivo: string | null };

const ESTADO_LABEL: Record<string, string> = {
  paid: 'Pagadas', in_payment: 'En proceso de pago', partial: 'Pagadas en parte', not_paid: 'Sin pagar', reversed: 'Reversadas',
};
const pesos = (valor: number) => `$ ${Math.round(valor).toLocaleString('es-CO')}`;
const mesAnterior = (now = new Date()) => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
};

/**
 * El cobro de lo facturado, por comercial, leído de Avancys (comisiones; Juan, 2026-11-10). El otrosí paga la comisión
 * cuando el cliente paga, así que aquí se ve, por vendedor, cuánto de lo facturado en el mes ya está pagado.
 * Es una REFERENCIA: el número que se paga es el de cartera. Se pide al abrir: son miles de facturas contra un ERP ajeno.
 */
export function AvancysCollectionPanel() {
  const [abierto, setAbierto] = useState(false);
  const [mes, setMes] = useState(mesAnterior());
  const [estado, setEstado] = useState<'inicio' | 'cargando' | 'listo' | 'error'>('inicio');
  const [datos, setDatos] = useState<Cobro | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!abierto || !/^\d{4}-\d{2}$/.test(mes)) return;
    let vigente = true;
    (async () => {
      setEstado('cargando'); setError('');
      try {
        const r = await api<Cobro>(`/api/agt003/avancys/cobro-por-comercial?mes=${encodeURIComponent(mes)}`);
        if (vigente) { setDatos(r); setEstado('listo'); }
      } catch (err) {
        if (!vigente) return;
        setError(err instanceof Error ? err.message : String(err)); setEstado('error');
      }
    })();
    return () => { vigente = false; };
  }, [abierto, mes]);

  return <details className="panel dashboard-details" onToggle={event => setAbierto((event.currentTarget as HTMLDetailsElement).open)}>
    <summary>Cobro por comercial (Avancys) · referencia para comisiones</summary>
    <label className="avancys-cobro-mes">Mes facturado <input type="month" value={mes} onChange={event => setMes(event.target.value)} /></label>
    <p className="muted">Lo facturado en el mes según Avancys, antes de IVA, y cuánto ya pagó el cliente. Es una referencia: el valor de las comisiones lo valida cartera.</p>
    {estado === 'cargando' && <p className="muted">Consultando Avancys… son miles de facturas, tarda unos segundos.</p>}
    {estado === 'error' && <p className="muted">No fue posible consultar Avancys: {error}</p>}
    {estado === 'listo' && datos?.motivo && <p className="muted">{datos.motivo}</p>}
    {estado === 'listo' && datos && !datos.motivo && <>
      <p className="muted">{datos.facturas} facturas · {datos.estados.map(e => `${ESTADO_LABEL[e.estado] || e.estado}: ${e.facturas}`).join(' · ')}{datos.recortado ? ' · La lectura pudo quedar incompleta.' : ''}</p>
      <div className="tablewrap crm-readable-table dashboard-sales-table"><table><thead><tr><th>Comercial en Avancys</th><th>Facturas</th><th>Facturado</th><th>Pagado</th><th>Pendiente</th></tr></thead>
        <tbody>{datos.comerciales.map(c => <tr key={String(c.avancys_user_id)}>
          <td><strong>{c.nombre || 'Sin comercial en la factura'}</strong></td>
          <td className="numeric-value">{c.facturas}</td>
          <td className="money-cell">{pesos(c.facturado)}</td>
          <td className="money-cell">{pesos(c.pagado)}</td>
          <td className="money-cell">{pesos(c.pendiente)}</td>
        </tr>)}</tbody></table></div>
    </>}
  </details>;
}
