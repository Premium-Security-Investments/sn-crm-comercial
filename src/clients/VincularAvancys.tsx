// Cliente único (Juan, 2026-11-12): "el cliente sea el de avancys en cualquier parte que este". La lista de trabajo de
// los clientes del CRM que ya son clientes (marcados así o con un negocio ganado) y no están enlazados a su registro de
// Avancys. Para cada uno se proponen candidatos de Avancys; una persona confirma con un clic y desde ahí el cliente
// lleva el nombre y el NIT de Avancys. Los prospectos no aparecen: ellos viven sólo en el CRM hasta que se cierra.
import { useEffect, useState } from 'react';
import { api } from '../apiClient';

type Request = typeof api;
type Pendiente = { id: string; company_name: string; customer_segment: string | null; quote_city: string | null; negocio_ganado: boolean };
type Candidato = { nombre: string; nit: string; departamento: string | null; atendido_por: string | null };

function Fila({ cliente, request, onEnlazado }: { cliente: Pendiente; request: Request; onEnlazado: (aviso: string | null) => void }) {
  const [busqueda, setBusqueda] = useState(cliente.company_name);
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [estado, setEstado] = useState<'buscando' | 'listo' | 'error'>('buscando');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const buscar = async (texto: string) => {
    setEstado('buscando'); setError('');
    try {
      const r = await request<{ candidatos: Candidato[] }>(`/api/avancys/candidatos-enlace?q=${encodeURIComponent(texto)}`);
      setCandidatos(r.candidatos); setEstado('listo');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); setEstado('error'); }
  };
  useEffect(() => { void buscar(cliente.company_name); }, [cliente.company_name]);
  const enlazar = async (candidato: Candidato) => {
    setGuardando(true); setError('');
    try {
      const r = await request<{ aviso: string | null }>('/api/avancys/cliente-enlace', { method: 'PUT', body: JSON.stringify({ client_id: cliente.id, avancys_ref_num: candidato.nit, avancys_nombre: candidato.nombre }) });
      onEnlazado(r.aviso);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); setGuardando(false); }
  };
  return <tr>
    <td>
      <strong>{cliente.company_name}</strong><br />
      <small className="muted">{[cliente.customer_segment === 'cliente_actual' ? 'Cliente actual' : null, cliente.negocio_ganado ? 'negocio ganado' : null, cliente.quote_city].filter(Boolean).join(' · ')}</small>
    </td>
    <td>
      {estado === 'buscando' && <small className="muted">Buscando en Avancys…</small>}
      {estado === 'error' && <small className="muted">{error}</small>}
      {estado === 'listo' && candidatos && (candidatos.length
        ? <ul className="dashboard-simple-list">{candidatos.map(c => <li key={c.nit}>
          <span><strong>{c.nombre}</strong> · NIT {c.nit}{c.departamento ? ` · ${c.departamento}` : ''}{c.atendido_por ? ` · ${c.atendido_por}` : ''}</span>
          <button type="button" className="secondary" disabled={guardando} onClick={() => void enlazar(c)}>{guardando ? 'Guardando…' : 'Es este'}</button>
        </li>)}</ul>
        : <small className="muted">Sin candidatos con ese nombre. Pruebe con otro nombre abajo.</small>)}
      {error && estado === 'listo' ? <><br /><small className="muted">{error}</small></> : null}
      <div className="filters">
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar en Avancys por otro nombre" aria-label={`Buscar en Avancys otro nombre para ${cliente.company_name}`} />
        <button type="button" className="secondary" onClick={() => void buscar(busqueda)}>Buscar</button>
      </div>
    </td>
  </tr>;
}

export function VincularAvancys({ request = api }: { request?: Request }) {
  const [datos, setDatos] = useState<{ pendientes: Pendiente[]; enlazados: number; total_clientes: number } | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState('');
  const [avisos, setAvisos] = useState<string[]>([]);
  const cargar = async () => {
    try { setDatos(await request('/api/avancys/clientes-por-vincular')); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  useEffect(() => { void cargar(); }, []);
  if (error) return null;
  if (!datos || !datos.pendientes.length) return null;
  const pendientes = datos.pendientes;
  return <section className="notice">
    <p>
      <strong>{pendientes.length} {pendientes.length === 1 ? 'cliente del CRM no está vinculado' : 'clientes del CRM no están vinculados'} con Avancys.</strong>{' '}
      Un cliente debe ser el mismo en todas partes: el de Avancys, con su NIT. Confirme cuál es y desde ahí lleva el nombre de Avancys.{' '}
      <button type="button" className="secondary" onClick={() => setAbierto(v => !v)}>{abierto ? 'Ocultar' : 'Vincular'}</button>
    </p>
    {avisos.map(aviso => <p key={aviso} className="muted">{aviso}</p>)}
    {abierto && <div className="tablewrap"><table>
      <thead><tr><th>Cliente en el CRM</th><th>¿Cuál es en Avancys?</th></tr></thead>
      <tbody>{pendientes.slice(0, 25).map(cliente => <Fila key={cliente.id} cliente={cliente} request={request} onEnlazado={aviso => {
        if (aviso) setAvisos(actuales => [...actuales, aviso]);
        setDatos(actual => actual && { ...actual, pendientes: actual.pendientes.filter(item => item.id !== cliente.id), enlazados: actual.enlazados + 1 });
      }} />)}</tbody>
    </table>
    {pendientes.length > 25 ? <p className="muted">Se muestran 25 a la vez; al vincular aparecen los siguientes.</p> : null}
    </div>}
  </section>;
}
