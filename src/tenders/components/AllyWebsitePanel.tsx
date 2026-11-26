import { useEffect, useState } from 'react';
import type { TenderRequest } from '../types';

/**
 * La página web de un aliado y lo que Vig-IA leyó en ella (Juan, 2026-11-26; migración 240): «de una vez que Vig-IA
 * consulte la web; los datos déjelos registrados de una vez». Al guardar la dirección, Vig-IA lee la portada y las páginas
 * de contacto, sedes y servicios, y lo leído queda en la ficha. Lo que la web no dice se muestra «no lo dice».
 */
type Modality = 'si' | 'no' | 'no_dice';
export type WebsiteInfo = {
  misma_empresa: 'si' | 'no' | 'no_seguro'; razon_social: string; nit: string;
  sede_principal: { ciudad: string; direccion: string };
  sedes: Array<{ ciudad: string; tipo: string; direccion: string; telefono: string; correo: string }>;
  telefonos: string[]; correos: string[]; whatsapp: string;
  contactos: Array<{ nombre: string; cargo: string; telefono: string; correo: string }>;
  servicios: string[];
  modalidades: { armada: Modality; sin_armas: Modality; canina: Modality; medios_tecnologicos: Modality; escoltas: Modality };
  licencia: string; certificaciones: string[]; anios_experiencia: string; clientes: string[]; alertas: string[]; resumen: string;
  paginas_leidas: string[];
};
export type WebsiteFields = { website?: string | null; website_info?: WebsiteInfo | null; website_read_at?: string | null; website_read_error?: string | null };

const NO = 'no lo dice';
const MODES: Array<[keyof WebsiteInfo['modalidades'], string]> = [['armada', 'Armada'], ['sin_armas', 'Sin armas'], ['canina', 'Canina'], ['medios_tecnologicos', 'Medios tecnológicos'], ['escoltas', 'Escoltas']];
const modeText = (value: Modality) => (value === 'si' ? 'sí' : value === 'no' ? 'no' : NO);
const joined = (items: string[] | undefined) => (items && items.length ? items.join(' · ') : NO);
const when = (value: string | null | undefined) => (value ? new Date(value).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' }) : '');
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

export function AllyWebsitePanel({ nit, fields, canEdit, request, onSaved }: { nit: string; fields: WebsiteFields; canEdit: boolean; request: TenderRequest; onSaved: () => Promise<void> | void }) {
  const [draft, setDraft] = useState(fields.website || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { setDraft(fields.website || ''); }, [fields.website]);
  const info = fields.website_info || null;

  const run = async (website: string) => {
    setBusy(true); setMessage('');
    try {
      const result = await request<{ read: 'ok' | 'error' | 'no'; error: string | null }>('/api/tender-allies/website', { method: 'POST', body: JSON.stringify({ nit, website }) });
      await onSaved();
      setMessage(result.read === 'ok' ? 'Vig-IA leyó la web y dejó los datos en la ficha.' : result.read === 'error' ? `La dirección quedó guardada, pero ${result.error || 'no se pudo leer la web'}` : website ? 'Guardado.' : 'Se quitó la página web.');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  };

  return <div className="ally-web">
    <div className="ally-rup-head">
      <strong>Página web</strong>
      {fields.website && <a className="ruppro-link" href={fields.website} target="_blank" rel="noreferrer">{host(fields.website)} <span aria-hidden="true">↗</span><span className="sr-only"> (abre en otra pestaña)</span></a>}
    </div>
    {canEdit && <form className="tender-allies-form ally-web-form" onSubmit={event => { event.preventDefault(); void run(draft); }}>
      <label className="wide">Dirección de la web<input type="url" inputMode="url" value={draft} onChange={event => setDraft(event.target.value)} maxLength={300} placeholder="Ej. https://www.empresa.com.co" /></label>
      <div className="wide row-actions">
        <button type="submit" disabled={busy || (!draft.trim() && !fields.website)}>{busy ? 'Vig-IA está leyendo la web…' : draft.trim() && draft.trim() === (fields.website || '') ? 'Volver a leer con Vig-IA' : 'Guardar y leer con Vig-IA'}</button>
      </div>
      <p className="muted wide">Vig-IA abre la portada y las páginas de contacto, sedes y servicios, y deja aquí lo que encuentre. Tarda entre medio y dos minutos.</p>
    </form>}
    {message && <div className="notice" role="status">{message}</div>}
    {fields.website_read_error && <div className="notice">Última lectura fallida: {fields.website_read_error}</div>}
    {!info ? <p className="muted">{fields.website ? 'Todavía no se ha leído la web.' : 'Sin página web registrada.'}</p> : <>
      <p className="ally-rup-source">Leída por Vig-IA el {when(fields.website_read_at)} · {info.paginas_leidas.length} {info.paginas_leidas.length === 1 ? 'página' : 'páginas'}</p>
      {info.misma_empresa !== 'si' && <div className="notice">{info.misma_empresa === 'no' ? 'Ojo: la web parece ser de otra empresa.' : 'No se pudo confirmar que la web sea de esta empresa.'}</div>}
      {info.resumen && <p>{info.resumen}</p>}
      <dl className="ally-rup-grid">
        <dt>Razón social / NIT</dt><dd>{info.razon_social || NO}{info.nit ? ` · ${info.nit}` : ''}</dd>
        <dt>Sede principal</dt><dd>{info.sede_principal.ciudad || info.sede_principal.direccion ? [info.sede_principal.ciudad, info.sede_principal.direccion].filter(Boolean).join(' · ') : NO}</dd>
        <dt>Teléfonos</dt><dd>{joined(info.telefonos)}{info.whatsapp ? ` · WhatsApp ${info.whatsapp}` : ''}</dd>
        <dt>Correos</dt><dd>{joined(info.correos)}</dd>
        <dt>Modalidades</dt><dd>{MODES.map(([key, text]) => `${text}: ${modeText(info.modalidades[key])}`).join(' · ')}</dd>
        <dt>Servicios</dt><dd>{joined(info.servicios)}</dd>
        <dt>Licencia</dt><dd>{info.licencia || NO}</dd>
        <dt>Certificaciones</dt><dd>{joined(info.certificaciones)}</dd>
        <dt>Experiencia</dt><dd>{info.anios_experiencia || NO}</dd>
        <dt>Clientes que nombra</dt><dd>{joined(info.clientes)}</dd>
      </dl>
      {info.sedes.length > 0 && <div className="ally-web-sedes">
        <strong>Sedes según la web ({info.sedes.length})</strong>
        <p className="muted">Como las llama la web; que sea sucursal o agencia inscrita se confirma en la Cámara de Comercio.</p>
        <ul>{info.sedes.map((sede, index) => <li key={`${sede.ciudad}-${index}`}><strong>{sede.ciudad || 'Sin ciudad'}</strong>{sede.tipo ? ` (${sede.tipo})` : ''}{sede.direccion ? ` · ${sede.direccion}` : ''}{sede.telefono ? ` · ${sede.telefono}` : ''}{sede.correo ? ` · ${sede.correo}` : ''}</li>)}</ul>
      </div>}
      {info.contactos.length > 0 && <div><strong>Personas que nombra la web</strong>
        <ul>{info.contactos.map((person, index) => <li key={`${person.nombre}-${index}`}>{[person.nombre, person.cargo, person.telefono, person.correo].filter(Boolean).join(' · ')}</li>)}</ul></div>}
      {info.alertas.length > 0 && <div><strong>Ojo</strong><ul>{info.alertas.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      <details><summary>Páginas leídas</summary><ul>{info.paginas_leidas.map(url => <li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul></details>
    </>}
  </div>;
}
