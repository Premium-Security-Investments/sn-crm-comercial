import { useEffect, useState } from 'react';
import { api } from '../apiClient';
import { ESTADOS_CONTRATO } from './contratos-clientes.js';

type Contrato = {
  nit: string; razon_social: string | null; comercial: string | null; fecha_inicio: string | null; fecha_ultima_renovacion: string | null;
  fecha_fin: string | null; estado: keyof typeof ESTADOS_CONTRATO; dias: number | null; observacion: string | null; fuente: string;
};
type Respuesta = { alcance: 'todos' | 'propios'; hoy: string; contratos: Contrato[]; resumen: Record<string, number>; motivo: string | null };

const fecha = (dia: string | null) => (dia ? dia.split('-').reverse().join('/') : '—');
const nombre = (texto: string | null) => (texto || 'Sin nombre').toLowerCase().replace(/(^|[\s.(-])\p{L}/gu, letra => letra.toUpperCase());
const cuando = (c: Contrato) => c.dias === null ? 'sin fecha de fin'
  : c.dias < 0 ? `venció hace ${-c.dias} ${c.dias === -1 ? 'día' : 'días'} (${fecha(c.fecha_fin)})`
    : c.dias === 0 ? 'vence hoy' : `vence en ${c.dias} ${c.dias === 1 ? 'día' : 'días'} (${fecha(c.fecha_fin)})`;
const ACCION = new Set(['por_vencer', 'vencido', 'sin_contrato', 'revisar', 'renovado']);

function Fila({ c, conComercial }: { c: Contrato; conComercial: boolean }) {
  return <li>
    <strong>{nombre(c.razon_social)}</strong>{' '}
    <span>{cuando(c)}{conComercial ? ` · ${c.comercial ? nombre(c.comercial) : 'sin comercial en Avancys'}` : ''}{c.observacion && c.estado !== 'por_vencer' && c.estado !== 'vencido' ? ` · «${c.observacion.toLowerCase()}»` : ''}</span>
  </li>;
}

/**
 * Contratos de los clientes (Juan, 2026-11-26): qué vence pronto, qué venció y quién recibe servicio sin contrato
 * vigente. `equipo` va en el Dashboard (dirección ve todo); `propio` va en Mi día con los clientes del comercial, y no
 * aparece si no hay nada que hacer.
 */
export function ContratosClientesPanel({ modo }: { modo: 'equipo' | 'propio' }) {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let vigente = true;
    api<Respuesta>(`/api/agt003/contratos-clientes${modo === 'propio' ? '?alcance=propios' : ''}`)
      .then(r => { if (vigente) setDatos(r); })
      .catch(e => { if (vigente) setError(e instanceof Error ? e.message : String(e)); });
    return () => { vigente = false; };
  }, [modo]);

  if (modo === 'propio') {
    if (!datos) return null;
    const pendientes = datos.contratos.filter(c => ACCION.has(c.estado));
    if (!pendientes.length) return null;
    const r = datos.resumen;
    const partes = [
      r.por_vencer ? `${r.por_vencer} ${r.por_vencer === 1 ? 'vence' : 'vencen'} en 90 días` : null,
      r.vencido ? `${r.vencido} ${r.vencido === 1 ? 'vencido' : 'vencidos'}` : null,
      r.sin_contrato ? `${r.sin_contrato} sin contrato vigente` : null,
      (r.revisar || 0) + (r.renovado || 0) ? `${(r.revisar || 0) + (r.renovado || 0)} por revisar` : null,
    ].filter(Boolean);
    return <section className="panel contratos-alerta" aria-label="Contratos de sus clientes">
      <h3>Contratos de sus clientes</h3>
      <p><strong>{partes.join(' · ')}.</strong> Renovarlos a tiempo protege al cliente y a la empresa, y la renovación firmada da comisión.</p>
      <ul className="dashboard-simple-list">{pendientes.slice(0, 5).map(c => <Fila key={c.nit} c={c} conComercial={false} />)}</ul>
      {pendientes.length > 5 && <details><summary>Ver los {pendientes.length}</summary>
        <ul className="dashboard-simple-list">{pendientes.slice(5).map(c => <Fila key={c.nit} c={c} conComercial={false} />)}</ul>
      </details>}
    </section>;
  }

  if (error) return <section className="panel"><h3>Contratos de clientes</h3><p className="muted">No se pudieron cargar: {error}</p></section>;
  if (!datos) return <section className="panel"><h3>Contratos de clientes</h3><p className="muted">Cargando…</p></section>;
  const r = datos.resumen;
  const porVencer = datos.contratos.filter(c => c.estado === 'por_vencer');
  const vencidos = datos.contratos.filter(c => c.estado === 'vencido');
  const sinContrato = datos.contratos.filter(c => ['sin_contrato', 'revisar', 'renovado', 'sin_fecha'].includes(c.estado));
  const fuentes = [...new Set(datos.contratos.map(c => c.fuente))];
  return <section className="panel contratos-panel" aria-label="Contratos de clientes">
    <h3>Contratos de clientes</h3>
    <p className="contratos-cifras"><strong>{r.por_vencer || 0}</strong> {r.por_vencer === 1 ? 'vence' : 'vencen'} en 90 días · <strong>{r.vencido || 0}</strong> {r.vencido === 1 ? 'vencido' : 'vencidos'} · <strong>{r.sin_contrato || 0}</strong> sin contrato vigente · {r.vigente || 0} {r.vigente === 1 ? 'vigente' : 'vigentes'}</p>
    {porVencer.length > 0
      ? <ul className="dashboard-simple-list">{porVencer.map(c => <Fila key={c.nit} c={c} conComercial />)}</ul>
      : <p className="muted">Ningún contrato vence en los próximos 90 días.</p>}
    {vencidos.length > 0 && <details><summary>Vencidos ({vencidos.length})</summary>
      <ul className="dashboard-simple-list">{vencidos.map(c => <Fila key={c.nit} c={c} conComercial />)}</ul>
    </details>}
    {sinContrato.length > 0 && <details><summary>Sin contrato vigente o por revisar ({sinContrato.length})</summary>
      <ul className="dashboard-simple-list">{sinContrato.map(c => <Fila key={c.nit} c={c} conComercial />)}</ul>
    </details>}
    <p className="muted">Fuente de las fechas: {fuentes.join(' · ') || '—'}. Cuando Avancys tenga las fechas de cada contrato, se toman de allá.{datos.motivo ? ` ${datos.motivo}` : ''}</p>
  </section>;
}
