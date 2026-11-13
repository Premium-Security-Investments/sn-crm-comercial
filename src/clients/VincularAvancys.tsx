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
import './vincular.css';

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
  const meta = [cliente.customer_segment === 'cliente_actual' ? 'Cliente actual' : null, cliente.negocio_ganado ? 'negocio ganado' : null, cliente.quote_city].filter(Boolean).join(' · ');
  return <li className="vincular-cliente">
    <div className="vincular-cliente-nombre"><strong>{cliente.company_name}</strong>{meta ? <small>{meta}</small> : null}</div>
    {(!busqueda || busqueda.estado === 'buscando') && <p className="vincular-nota">Buscando en Avancys…</p>}
    {busqueda?.estado === 'error' && <p className="vincular-nota">{busqueda.error}</p>}
    {busqueda?.estado === 'listo' && (busqueda.candidatos.length
      ? <ul className="vincular-candidatos">{busqueda.candidatos.map(c => <li key={c.nit} className="vincular-candidato">
        <span><b>{c.nombre}</b><small>NIT {c.nit}{c.departamento ? ` · ${c.departamento}` : ''}{c.atendido_por ? ` · ${c.atendido_por}` : ''}</small></span>
        <button type="button" className="secondary" disabled={guardando} onClick={() => void enlazar(c)}>{guardando ? 'Guardando…' : 'Es este'}</button>
      </li>)}</ul>
      : <p className="vincular-nota">Avancys no tiene un cliente con ese nombre. Si tiene otra razón social, búsquela aquí.</p>)}
    {error ? <p className="vincular-nota">{error}</p> : null}
    <div className="vincular-buscar">
      <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Buscar en Avancys por otro nombre" aria-label={`Buscar en Avancys otro nombre para ${cliente.company_name}`} />
      <button type="button" className="secondary" onClick={() => onBuscar(texto)}>Buscar</button>
    </div>
  </li>;
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
  return <section className="vincular" aria-label="Vincular clientes con Avancys">
    <div className="vincular-head">
      <p><strong>{pendientes.length} {pendientes.length === 1 ? 'cliente del CRM no está vinculado' : 'clientes del CRM no están vinculados'} con Avancys.</strong> Un cliente es el mismo en todas partes: el de Avancys, con su NIT. Confirme cuál es; desde ahí lleva el nombre de Avancys.</p>
      <button type="button" className="secondary" onClick={() => setAbierto(v => !v)}>{abierto ? 'Ocultar' : 'Vincular'}</button>
    </div>
    {avisos.map(aviso => <p key={aviso} className="vincular-nota">{aviso}</p>)}
    {abierto && <>
      {porVincular.length ? <ul className="vincular-lista">{porVincular.map(fila)}</ul> : null}
      {sinAvancys.length ? <details>
        <summary>{sinAvancys.length} {sinAvancys.length === 1 ? 'todavía no aparece' : 'todavía no aparecen'} en Avancys</summary>
        <p className="vincular-nota">Negocios ganados que Avancys aún no tiene: entran cuando se envía el formulario de nuevo puesto. Si alguno tiene otra razón social, búsquela en su tarjeta.</p>
        <ul className="vincular-lista">{sinAvancys.map(fila)}</ul>
      </details> : null}
    </>}
  </section>;
}
