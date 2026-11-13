// Cliente único (Juan, 2026-11-12): "el cliente sea el de avancys en cualquier parte que este". La lista de trabajo de
// los clientes del CRM que ya son clientes (marcados así o con un negocio ganado) y no están enlazados a su registro de
// Avancys. Para cada uno se proponen candidatos de Avancys; una persona confirma con un clic y desde ahí el cliente
// lleva el nombre y el NIT de Avancys. Los prospectos no aparecen: ellos viven sólo en el CRM hasta que se cierra.
//
// Un negocio recién ganado todavía no está en Avancys: entra cuando se envía el formulario de nuevo puesto (Juan,
// 2026-11-12). Esos no tienen con qué vincularse, así que van aparte y plegados; vuelven a la lista principal solos el
// día que Avancys los tenga.
import { useEffect, useState } from 'react';
import { api } from '../apiClient';

type Request = typeof api;
type Pendiente = { id: string; company_name: string; customer_segment: string | null; quote_city: string | null; negocio_ganado: boolean };
type Candidato = { nombre: string; nit: string; departamento: string | null; atendido_por: string | null };
type Busqueda = { estado: 'buscando' | 'listo' | 'error'; candidatos: Candidato[]; error?: string };

const EN_PARALELO = 4;

function Fila({ cliente, busqueda, onBuscar, onEnlazar }: {
  cliente: Pendiente; busqueda: Busqueda | undefined; onBuscar: (texto: string) => void; onEnlazar: (candidato: Candidato) => Promise<void>;
}) {
  const [texto, setTexto] = useState(cliente.company_name);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const enlazar = async (candidato: Candidato) => {
    setGuardando(true); setError('');
    try { await onEnlazar(candidato); } catch (err) { setError(err instanceof Error ? err.message : String(err)); setGuardando(false); }
  };
  return <tr>
    <td>
      <strong>{cliente.company_name}</strong><br />
      <small className="muted">{[cliente.customer_segment === 'cliente_actual' ? 'Cliente actual' : null, cliente.negocio_ganado ? 'negocio ganado' : null, cliente.quote_city].filter(Boolean).join(' · ')}</small>
    </td>
    <td>
      {(!busqueda || busqueda.estado === 'buscando') && <small className="muted">Buscando en Avancys…</small>}
      {busqueda?.estado === 'error' && <small className="muted">{busqueda.error}</small>}
      {busqueda?.estado === 'listo' && (busqueda.candidatos.length
        ? <ul className="dashboard-simple-list">{busqueda.candidatos.map(c => <li key={c.nit}>
          <span><strong>{c.nombre}</strong> · NIT {c.nit}{c.departamento ? ` · ${c.departamento}` : ''}{c.atendido_por ? ` · ${c.atendido_por}` : ''}</span>
          <button type="button" className="secondary" disabled={guardando} onClick={() => void enlazar(c)}>{guardando ? 'Guardando…' : 'Es este'}</button>
        </li>)}</ul>
        : <small className="muted">Avancys no tiene un cliente con ese nombre. Si tiene otra razón social, búsquela abajo.</small>)}
      {error ? <><br /><small className="muted">{error}</small></> : null}
      <div className="filters">
        <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Buscar en Avancys por otro nombre" aria-label={`Buscar en Avancys otro nombre para ${cliente.company_name}`} />
        <button type="button" className="secondary" onClick={() => onBuscar(texto)}>Buscar</button>
      </div>
    </td>
  </tr>;
}

export function VincularAvancys({ request = api }: { request?: Request }) {
  const [datos, setDatos] = useState<{ pendientes: Pendiente[]; enlazados: number; total_clientes: number } | null>(null);
  const [busquedas, setBusquedas] = useState<Record<string, Busqueda>>({});
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState('');
  const [avisos, setAvisos] = useState<string[]>([]);
  useEffect(() => {
    void (async () => {
      try { setDatos(await request('/api/avancys/clientes-por-vincular')); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    })();
  }, []);
  const buscar = async (id: string, texto: string) => {
    setBusquedas(actual => ({ ...actual, [id]: { estado: 'buscando', candidatos: [] } }));
    try {
      const r = await request<{ candidatos: Candidato[] }>(`/api/avancys/candidatos-enlace?q=${encodeURIComponent(texto)}`);
      setBusquedas(actual => ({ ...actual, [id]: { estado: 'listo', candidatos: r.candidatos } }));
    } catch (err) {
      setBusquedas(actual => ({ ...actual, [id]: { estado: 'error', candidatos: [], error: err instanceof Error ? err.message : String(err) } }));
    }
  };
  // Al abrir, se buscan todos de a pocos: hay que saber cuáles tienen con qué vincularse para separarlos.
  useEffect(() => {
    if (!abierto || !datos) return;
    const cola = datos.pendientes.filter(cliente => !busquedas[cliente.id]);
    let vigente = true;
    const trabajador = async () => {
      while (vigente && cola.length) {
        const cliente = cola.shift()!;
        await buscar(cliente.id, cliente.company_name);
      }
    };
    void Promise.all(Array.from({ length: EN_PARALELO }, trabajador));
    return () => { vigente = false; };
  }, [abierto, datos?.pendientes.length]);
  if (error) return null;
  if (!datos || !datos.pendientes.length) return null;
  const pendientes = datos.pendientes;
  const sinAvancys = pendientes.filter(cliente => busquedas[cliente.id]?.estado === 'listo' && !busquedas[cliente.id].candidatos.length);
  const porVincular = pendientes.filter(cliente => !sinAvancys.includes(cliente));
  const enlazar = async (cliente: Pendiente, candidato: Candidato) => {
    const r = await request<{ aviso: string | null }>('/api/avancys/cliente-enlace', { method: 'PUT', body: JSON.stringify({ client_id: cliente.id, avancys_ref_num: candidato.nit, avancys_nombre: candidato.nombre }) });
    if (r.aviso) setAvisos(actuales => [...actuales, r.aviso!]);
    setDatos(actual => actual && { ...actual, pendientes: actual.pendientes.filter(item => item.id !== cliente.id), enlazados: actual.enlazados + 1 });
  };
  const fila = (cliente: Pendiente) => <Fila key={cliente.id} cliente={cliente} busqueda={busquedas[cliente.id]} onBuscar={texto => void buscar(cliente.id, texto)} onEnlazar={candidato => enlazar(cliente, candidato)} />;
  return <section className="notice">
    <p>
      <strong>{pendientes.length} {pendientes.length === 1 ? 'cliente del CRM no está vinculado' : 'clientes del CRM no están vinculados'} con Avancys.</strong>{' '}
      Un cliente debe ser el mismo en todas partes: el de Avancys, con su NIT. Confirme cuál es y desde ahí lleva el nombre de Avancys.{' '}
      <button type="button" className="secondary" onClick={() => setAbierto(v => !v)}>{abierto ? 'Ocultar' : 'Vincular'}</button>
    </p>
    {avisos.map(aviso => <p key={aviso} className="muted">{aviso}</p>)}
    {abierto && <>
      <div className="tablewrap"><table>
        <thead><tr><th>Cliente en el CRM</th><th>¿Cuál es en Avancys?</th></tr></thead>
        <tbody>{porVincular.map(fila)}</tbody>
      </table></div>
      {sinAvancys.length ? <details>
        <summary>{sinAvancys.length} {sinAvancys.length === 1 ? 'todavía no aparece' : 'todavía no aparecen'} en Avancys</summary>
        <p className="muted">Negocios ganados que Avancys aún no tiene: entran cuando se envía el formulario de nuevo puesto. Si alguno tiene otra razón social, búsquela en su fila.</p>
        <div className="tablewrap"><table>
          <thead><tr><th>Cliente en el CRM</th><th>Buscar en Avancys</th></tr></thead>
          <tbody>{sinAvancys.map(fila)}</tbody>
        </table></div>
      </details> : null}
    </>}
  </section>;
}
