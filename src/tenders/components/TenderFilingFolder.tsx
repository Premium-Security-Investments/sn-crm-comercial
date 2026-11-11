import { useEffect, useState } from 'react';
import type { TenderRequest } from '../types';

/**
 * Mejora 11 (Juan, 2026-11-10/11): la carpeta de radicación del proceso en SharePoint, en Preparar. Se crea sola con el
 * GO; los procesos de antes, con el botón. El índice de 03_PARA_RADICAR y, después del cierre, la comparación con
 * 04_Radicado se ven aquí: en SharePoint no se escribe un índice porque habría que sobrescribirlo.
 */
type File = { nombre: string; bytes: number; modificado_en: string | null };
type Snapshot = {
  observado_en: string;
  indice: { secciones: Array<{ carpeta: string; archivos: File[] }>; sueltos: File[]; vacias: string[]; total: number };
  comparacion: null | { preparados: number; radicados: number; coinciden: number; no_radicados: Array<{ nombre: string; carpeta: string | null }>; radicados_sin_preparar: Array<{ nombre: string }> };
};
type Folder = { status: 'pendiente' | 'creada' | 'error'; origin: string; web_url: string | null; error: string | null; refresh_requested_at: string | null; snapshot: Snapshot | null; snapshot_at: string | null };
const LABEL: Record<string, string> = {
  '01_Anexos_firmados': 'Anexos firmados', '02_Juridicos': 'Jurídicos', '03_Financieros_y_RUP': 'Financieros y RUP',
  '04_Tecnicos_habilitantes': 'Técnicos habilitantes', '05_Experiencia': 'Experiencia', '06_Ponderables': 'Ponderables', '07_Garantia': 'Garantía',
};
const when = (value: string | null) => value ? new Date(value).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';

export function TenderFilingFolder({ opportunityId, request, canRequest }: { opportunityId: string; request: TenderRequest; canRequest: boolean }) {
  const [state, setState] = useState<{ installed: boolean; folder: Folder | null } | null>(null);
  const [message, setMessage] = useState('');
  const load = async () => { try { setState(await request('/api/tender-filing-folder?opportunity_id=' + encodeURIComponent(opportunityId))); } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); } };
  useEffect(() => { void load(); }, [opportunityId]);
  const ask = async (action: 'crear' | 'actualizar') => {
    try {
      await request('/api/tender-filing-folder/request', { method: 'POST', body: JSON.stringify({ opportunity_id: opportunityId, action }) });
      setMessage(action === 'crear' ? 'Pedido: el servidor crea la carpeta en un minuto.' : 'Pedido: el índice se actualiza en un minuto.');
      await load();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
  };
  if (!state?.installed) return null;
  const folder = state.folder;
  const waitingIndex = folder?.status === 'creada' && folder.refresh_requested_at && (!folder.snapshot_at || new Date(folder.refresh_requested_at) > new Date(folder.snapshot_at));
  const snapshot = folder?.snapshot || null;
  return <section className="tw-card tw-filing">
    <small>Carpeta de radicación</small>
    {message && <p className="tw-muted" role="status">{message}</p>}
    {!folder && <p>Este proceso todavía no tiene carpeta de radicación en SharePoint. {canRequest && <button type="button" className="secondary" onClick={() => void ask('crear')}>Crear carpeta de radicación</button>}</p>}
    {folder?.status === 'pendiente' && <p>Creando la carpeta en SharePoint…</p>}
    {folder?.status === 'error' && <p className="tw-reanalysis-warn">No se pudo crear: {folder.error}. {canRequest && <button type="button" className="secondary" onClick={() => void ask('crear')}>Intentar de nuevo</button>}</p>}
    {folder?.status === 'creada' && <>
      <div className="tw-filing-head">
        {folder.web_url && <a href={folder.web_url} target="_blank" rel="noreferrer">Abrir la carpeta en SharePoint ↗</a>}
        {canRequest && <button type="button" className="secondary" disabled={Boolean(waitingIndex)} onClick={() => void ask('actualizar')}>{waitingIndex ? 'Actualizando…' : 'Actualizar índice'}</button>}
        {folder.snapshot_at && <span className="tw-muted">Índice del {when(folder.snapshot_at)}</span>}
      </div>
      {snapshot && <>
        <p><b>03_PARA_RADICAR</b> · {snapshot.indice.total} documento{snapshot.indice.total === 1 ? '' : 's'}{snapshot.indice.vacias.length ? ` · vacías: ${snapshot.indice.vacias.map(name => LABEL[name] || name).join(', ')}` : ''}</p>
        <ul className="tw-filing-sections">{snapshot.indice.secciones.map(section => <li key={section.carpeta} className={section.archivos.length ? '' : 'is-empty'}>
          <b>{LABEL[section.carpeta] || section.carpeta}</b> <span className="tw-muted">({section.archivos.length})</span>
          {section.archivos.length > 0 && <ul>{section.archivos.map(file => <li key={file.nombre}>{file.nombre}</li>)}</ul>}
        </li>)}</ul>
        {snapshot.indice.sueltos.length > 0 && <p className="tw-reanalysis-warn">Sueltos en 03_PARA_RADICAR, fuera de las subcarpetas: {snapshot.indice.sueltos.map(file => file.nombre).join(', ')}</p>}
        {snapshot.comparacion && <div className="tw-filing-compare">
          <p><b>Preparado contra radicado</b> · {snapshot.comparacion.coinciden} de {snapshot.comparacion.preparados} preparados aparecen en 04_Radicado</p>
          {snapshot.comparacion.no_radicados.length > 0 && <p className="tw-reanalysis-warn">Preparados que no aparecen en lo radicado: {snapshot.comparacion.no_radicados.map(file => file.nombre).join(', ')}</p>}
          {snapshot.comparacion.radicados_sin_preparar.length > 0 && <p className="tw-muted">Radicados que no estaban en 03_PARA_RADICAR: {snapshot.comparacion.radicados_sin_preparar.map(file => file.nombre).join(', ')}</p>}
        </div>}
      </>}
    </>}
  </section>;
}
