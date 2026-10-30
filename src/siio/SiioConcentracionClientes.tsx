import { useEffect, useState } from 'react';
import { api } from '../apiClient';

type ClienteFacturado = { nombre: string | null; identificacion: string | null; monto: number; facturas: number; participacion: number | null };
type Facturacion = {
  mes: string; total: number; notas_credito: number; facturas: number; recortado: boolean;
  clientes: ClienteFacturado[];
  concentracion: { top_1: number | null; top_5: number | null; top_10: number | null; total_clientes: number } | null;
  as_of: string | null; motivo: string | null;
};

const millones = (valor: number) => `${(valor / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 0 })} M`;
const pct = (valor: number | null) => (valor === null ? '—' : `${(valor * 100).toFixed(1)} %`);

/**
 * De quién depende la plata: la facturación del mes, por cliente, leída de Avancys.
 *
 * La Torre declaraba esto como pendiente —"falta: ingresos por cliente desde Avancys"— y ya no
 * falta. Es la cifra que más dice de las que no estaban: en agosto, septiembre y octubre de 2026
 * dos clientes pesan cerca de la mitad.
 *
 * No reemplaza la hoja contable de Contabilidad: esto es lo FACTURADO y aquello es la provisión de
 * cierre. La pantalla dice cuál es cuál, porque confundirlas fue el error de toda esta semana.
 *
 * Se pide al abrir, no al cargar la Torre: son más de dos mil facturas contra un ERP ajeno y tarda
 * unos veinte segundos.
 */
export function SiioConcentracionClientes({ period }: { period: string }) {
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'error'>('cargando');
  const [datos, setDatos] = useState<Facturacion | null>(null);
  const [error, setError] = useState('');
  const mes = (period || '').slice(0, 7);
  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(mes)) { setEstado('listo'); setDatos(null); return; }
    let vigente = true;
    (async () => {
      setEstado('cargando'); setError('');
      try {
        const r = await api<Facturacion>(`/api/siio/avancys/facturacion-por-cliente?mes=${encodeURIComponent(mes)}`);
        if (vigente) { setDatos(r); setEstado('listo'); }
      } catch (err) {
        if (!vigente) return;
        setError(err instanceof Error ? err.message : String(err)); setEstado('error');
      }
    })();
    return () => { vigente = false; };
  }, [mes]);

  if (!/^\d{4}-\d{2}$/.test(mes)) return null;
  return <div className="siio-pulse-block">
    <h4>Concentración de clientes · facturado en {mes}</h4>
    <p className="siio-pulse-footnote">
      Es lo <strong>facturado</strong> en el mes según Avancys, antes de IVA y neto de notas crédito.
      No es la provisión de cierre que detalla la hoja <em>Ingresos</em>: son dos números distintos.
    </p>
    {estado === 'cargando' && <p className="siio-secondary">Consultando Avancys… son más de dos mil facturas, tarda unos segundos.</p>}
    {estado === 'error' && <p className="siio-secondary">No fue posible consultar Avancys: {error}</p>}
    {estado === 'listo' && datos?.motivo && <p className="siio-secondary">{datos.motivo}</p>}
    {estado === 'listo' && datos && !datos.motivo && datos.concentracion && <>
      <div className="siio-executive-grid siio-key-grid">
        <div className="siio-key-figure"><small>Facturado</small><strong>{millones(datos.total)}</strong><span>{datos.facturas.toLocaleString('es-CO')} facturas · {datos.concentracion.total_clientes.toLocaleString('es-CO')} clientes</span></div>
        <div className="siio-key-figure"><small>El cliente más grande</small><strong>{pct(datos.concentracion.top_1)}</strong><span>{datos.clientes[0]?.nombre || '—'}</span></div>
        <div className="siio-key-figure"><small>Los cinco más grandes</small><strong>{pct(datos.concentracion.top_5)}</strong><span>de la facturación del mes</span></div>
        <div className="siio-key-figure"><small>Los diez más grandes</small><strong>{pct(datos.concentracion.top_10)}</strong><span>de la facturación del mes</span></div>
      </div>
      {datos.notas_credito > 0 && <p className="siio-pulse-footnote">Ya descontadas {millones(datos.notas_credito)} en notas crédito.</p>}
      {datos.recortado && <p className="siio-pulse-footnote">La lectura llegó al tope: el mes puede estar incompleto.</p>}
      <div className="siio-table-wrap"><table>
        <thead><tr><th>Cliente</th><th>Facturado</th><th>Participación</th><th>Facturas</th></tr></thead>
        <tbody>
          {datos.clientes.slice(0, 15).map(c => <tr key={`${c.identificacion || ''}-${c.nombre || ''}`}>
            <td>{c.nombre || 'Sin nombre'}{c.identificacion ? <><br/><small className="siio-secondary">{c.identificacion}</small></> : null}</td>
            <td>{millones(c.monto)}</td>
            <td>{pct(c.participacion)}</td>
            <td>{c.facturas}</td>
          </tr>)}
        </tbody>
      </table></div>
      {datos.clientes.length > 15 && <p className="siio-pulse-footnote">Se muestran los quince primeros de {datos.clientes.length.toLocaleString('es-CO')}.</p>}
      {datos.as_of && <p className="siio-pulse-source">Datos de Avancys al {datos.as_of.slice(0, 10)}.</p>}
    </>}
  </div>;
}
