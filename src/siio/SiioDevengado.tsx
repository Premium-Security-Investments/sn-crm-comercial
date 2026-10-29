import { useEffect, useState } from 'react';
import { api } from '../apiClient';

type ClienteDevengado = { nombre: string | null; identificacion: string | null; devengado: number; lineas: number; lineas_parciales: number };
type Devengado = {
  mes: string; total: number; clientes: ClienteDevengado[]; sin_encontrar: string[];
  declarados: number; as_of: string | null; motivo: string | null;
};

const millones = (valor: number) => `${(valor / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;

/**
 * El servicio prestado del mes a los clientes de mes vencido, esté facturado o no.
 *
 * Es lo que hoy se calcula a mano en un Excel después de bajar un archivo de Avancys. Sale de las
 * órdenes de servicio —fechas de facturación y valor mensual, completos en las 18.591 líneas— y se
 * prorratea por los días vigentes dentro del mes.
 *
 * A quién se le aplica NO sale de Avancys: el ERP no distingue al cliente público. Sale de la lista
 * que una persona declara en la ficha de cada cliente.
 *
 * Se muestra como cálculo propio y no como "la provisión". Contra la hoja de agosto de 2026 el
 * total queda dentro del 4% y siete de diez clientes dentro del 8%, pero tres se separan y
 * todavía no se sabe por qué. Decir que son el mismo número sería mentir.
 */
export function SiioDevengado({ period }: { period: string }) {
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'error'>('cargando');
  const [datos, setDatos] = useState<Devengado | null>(null);
  const [error, setError] = useState('');
  const mes = (period || '').slice(0, 7);
  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(mes)) { setEstado('listo'); setDatos(null); return; }
    let vigente = true;
    (async () => {
      setEstado('cargando'); setError('');
      try {
        const r = await api<Devengado>(`/api/siio/avancys/devengado?mes=${encodeURIComponent(mes)}`);
        if (vigente) { setDatos(r); setEstado('listo'); }
      } catch (err) {
        if (!vigente) return;
        setError(err instanceof Error ? err.message : String(err)); setEstado('error');
      }
    })();
    return () => { vigente = false; };
  }, [mes]);

  if (!/^\d{4}-\d{2}$/.test(mes)) return null;
  const conParciales = (datos?.clientes || []).filter(c => c.lineas_parciales > 0);
  return <div className="siio-pulse-block">
    <h4>Servicio prestado del mes · clientes de mes vencido · {mes}</h4>
    <p className="siio-pulse-footnote">
      Es el servicio del mes calculado desde las órdenes de servicio de Avancys, prorrateado por los
      días vigentes, para los clientes que alguien declaró como de facturación mes vencido.
      <strong> Es un cálculo propio, no la provisión que registra Contabilidad:</strong> contra la hoja
      de agosto de 2026 el total queda dentro del 4%, pero tres clientes se separan y todavía no se
      sabe qué excluyen.
    </p>
    {estado === 'cargando' && <p className="siio-secondary">Consultando Avancys…</p>}
    {estado === 'error' && <p className="siio-secondary">No fue posible consultar Avancys: {error}</p>}
    {estado === 'listo' && datos?.motivo && <p className="siio-secondary">{datos.motivo}</p>}
    {estado === 'listo' && datos && !datos.motivo && <>
      <div className="siio-executive-grid siio-key-grid">
        <div className="siio-key-figure"><small>Servicio prestado</small><strong>{millones(datos.total)}</strong><span>{datos.clientes.length} de {datos.declarados} clientes declarados</span></div>
      </div>
      {datos.sin_encontrar.length > 0 && <p className="siio-pulse-footnote">
        {datos.sin_encontrar.length === 1 ? 'Un cliente declarado no se encontró' : `${datos.sin_encontrar.length} clientes declarados no se encontraron`} en Avancys con esa identificación: {datos.sin_encontrar.join(', ')}.
      </p>}
      <div className="siio-table-wrap"><table>
        <thead><tr><th>Cliente</th><th>Servicio del mes</th><th>Líneas</th></tr></thead>
        <tbody>
          {datos.clientes.map(c => <tr key={c.identificacion || c.nombre || ''}>
            <td>{c.nombre || 'Sin nombre'}{c.identificacion ? <><br/><small className="siio-secondary">{c.identificacion}</small></> : null}</td>
            <td>{millones(c.devengado)}</td>
            <td>{c.lineas}{c.lineas_parciales ? <><br/><small className="siio-secondary">{c.lineas_parciales} parcial{c.lineas_parciales === 1 ? '' : 'es'}</small></> : null}</td>
          </tr>)}
        </tbody>
        <tfoot><tr><th>Total</th><th>{millones(datos.total)}</th><th /></tr></tfoot>
      </table></div>
      {/* Las líneas parciales son la primera sospecha cuando un cliente no cuadra contra el Excel:
          en agosto, el cliente con la mayor diferencia tenía 23 de 53 líneas parciales. */}
      {conParciales.length > 0 && <p className="siio-pulse-footnote">
        Las líneas parciales son servicios que no cubrieron el mes entero. Son la primera explicación a revisar cuando un cliente no cuadra contra el cálculo manual.
      </p>}
      {datos.as_of && <p className="siio-pulse-source">Datos de Avancys al {datos.as_of.slice(0, 10)}.</p>}
    </>}
  </div>;
}
