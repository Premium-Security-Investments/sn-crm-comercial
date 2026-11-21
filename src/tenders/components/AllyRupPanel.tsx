import { useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '../../supabaseBrowser';
import type { TenderRequest } from '../types';

/**
 * La ficha del RUP de un aliado y lo que deciden los pliegos (Juan, 2026-11-21; migración 233): se sube el PDF de la
 * consulta gratuita de ruppro.colombiacompra.gov.co o el certificado del RUP de la Cámara, y quedan las cifras con su
 * fecha de corte. Lo que el documento no trae se muestra «sin dato» (la consulta gratuita no trae la liquidez).
 */
export type RupSummary = {
  id: string; source_kind: 'consulta_ruppro' | 'certificado_camara'; cut_date: string | null;
  total_assets: number | null; total_liabilities: number | null; current_assets: number | null; current_liabilities: number | null;
  equity: number | null; operating_income: number | null; roe: number | null; roa: number | null;
  liquidity: number | null; working_capital: number | null; debt_ratio: number | null; interest_coverage: number | null;
  has_fines: boolean | null; has_sanctions: boolean | null; has_disqualification: boolean | null;
  contracts_total: number | null; contracts_own: number | null; smmlv_total: number | null; smmlv_own: number | null;
  largest_own_smmlv: number | null; largest_own_client: string | null; has_guard_code: boolean | null; has_systems_code: boolean | null;
  document_name: string | null; created_at: string;
};
export type RupField = RupSummary | { latest: RupSummary; history: RupSummary[] } | null | undefined;
export type Capabilities = { radio_cities?: string | null; radio_source?: string | null; sgsst_pct?: number | null; sgsst_date?: string | null };

/** El RUP más reciente, venga de la lista (una fila) o de la ficha (la historia). */
export const latestRup = (rup: RupField): RupSummary | null => (!rup ? null : 'latest' in rup ? rup.latest : rup);

const SIN_DATO = 'sin dato';
const num = (value: number | null | undefined, digits = 2) => (value === null || value === undefined ? SIN_DATO : value.toLocaleString('es-CO', { maximumFractionDigits: digits }));
const money = (value: number | null | undefined) => (value === null || value === undefined ? SIN_DATO : `$${Math.round(value / 1e6).toLocaleString('es-CO')} M`);
const pct = (value: number | null | undefined) => (value === null || value === undefined ? SIN_DATO : `${Math.round(value * 100)} %`);
const yesNo = (value: boolean | null | undefined, yes: string, no: string) => (value === null || value === undefined ? SIN_DATO : value ? yes : no);
const date = (value: string | null | undefined) => (value ? value.split('-').reverse().join('/') : SIN_DATO);
const SOURCE: Record<string, string> = { consulta_ruppro: 'Consulta de ruppro', certificado_camara: 'Certificado de la Cámara' };

/** Una línea corta para la lista: «RUP 31/12/2025 · liquidez 18,29 · endeud. 0,32». */
export function rupLine(rup: RupField) {
  const latest = latestRup(rup);
  if (!latest) return '';
  return [`RUP ${date(latest.cut_date)}`, `liquidez ${num(latest.liquidity)}`, `endeud. ${num(latest.debt_ratio)}`, latest.has_fines ? 'con multas' : ''].filter(Boolean).join(' · ');
}

export function AllyRupPanel({ nit, rup, capabilities, canEdit, request, onSaved }: { nit: string; rup: RupField; capabilities: Capabilities; canEdit: boolean; request: TenderRequest; onSaved: () => Promise<void> | void }) {
  const latest = latestRup(rup);
  const history = rup && 'history' in rup ? rup.history : [];
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const draftOf = () => ({ radio_cities: capabilities.radio_cities || '', radio_source: capabilities.radio_source || '', sgsst_pct: capabilities.sgsst_pct === null || capabilities.sgsst_pct === undefined ? '' : String(capabilities.sgsst_pct), sgsst_date: capabilities.sgsst_date || '' });
  const [draft, setDraft] = useState(draftOf);
  useEffect(() => { setDraft(draftOf()); }, [capabilities.radio_cities, capabilities.radio_source, capabilities.sgsst_pct, capabilities.sgsst_date]);

  const act = async (fn: () => Promise<string>) => {
    setBusy(true); setMessage('');
    try { const done = await fn(); await onSaved(); setMessage(done); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  };
  const upload = (file: File) => act(async () => {
    const ticket = await request<{ path: string; token: string }>('/api/tender-allies/rup-upload-url', { method: 'POST', body: JSON.stringify({ nit, name: file.name, size: file.size }) });
    const uploaded = await supabaseBrowser.storage.from('tender-documents').uploadToSignedUrl(ticket.path, ticket.token, file);
    if (uploaded.error) throw new Error(`No fue posible subir ${file.name}: ${uploaded.error.message}`);
    const result = await request<{ already_loaded: boolean; kind: string }>('/api/tender-allies/rup', { method: 'POST', body: JSON.stringify({ nit, storage_path: ticket.path, name: file.name }) });
    return result.already_loaded ? 'Ese documento ya estaba cargado.' : `${SOURCE[result.kind] || 'RUP'} leído y guardado.`;
  });
  const saveCapabilities = () => act(async () => {
    await request('/api/tender-allies/capabilities', { method: 'POST', body: JSON.stringify({ nit, ...draft }) });
    return 'Guardado.';
  });

  return <div className="ally-rup">
    <div className="ally-rup-head">
      <strong>RUP y capacidades</strong>
      {canEdit && <>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} />
        <button type="button" className="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Leyendo…' : 'Cargar RUP (PDF)'}</button>
      </>}
    </div>
    <p className="muted">La consulta gratuita está en ruppro.colombiacompra.gov.co (por NIT). No trae la liquidez: para eso, el certificado del RUP de la Cámara.</p>
    {message && <div className="notice" role="status">{message}</div>}
    {!latest ? <p className="muted">Todavía no se ha cargado el RUP de esta empresa.</p> : <>
      <p className="ally-rup-source">{SOURCE[latest.source_kind] || 'RUP'} · corte {date(latest.cut_date)}{latest.document_name ? ` · ${latest.document_name}` : ''}</p>
      <dl className="ally-rup-grid">
        <dt>Liquidez</dt><dd>{num(latest.liquidity)}</dd>
        <dt>Capital de trabajo</dt><dd>{money(latest.working_capital)}</dd>
        <dt>Endeudamiento</dt><dd>{num(latest.debt_ratio, 3)}</dd>
        <dt>Cobertura de intereses</dt><dd>{num(latest.interest_coverage)}</dd>
        <dt>Activo total</dt><dd>{money(latest.total_assets)}</dd>
        <dt>Pasivo total</dt><dd>{money(latest.total_liabilities)}</dd>
        <dt>Utilidad operacional</dt><dd>{money(latest.operating_income)}</dd>
        <dt>Rentabilidad patrimonio / activo</dt><dd>{pct(latest.roe)} / {pct(latest.roa)}</dd>
        <dt>Multas / sanciones</dt><dd>{yesNo(latest.has_fines, 'con multas', 'sin multas')} · {yesNo(latest.has_sanctions, 'con sanciones', 'sin sanciones')}</dd>
        <dt>Contratos en el RUP</dt><dd>{num(latest.contracts_total, 0)} ({num(latest.contracts_own, 0)} propios por {num(latest.smmlv_own, 0)} SMMLV)</dd>
        <dt>Mayor contrato propio</dt><dd>{latest.largest_own_smmlv === null ? SIN_DATO : `${num(latest.largest_own_smmlv, 0)} SMMLV${latest.largest_own_client ? ` · ${latest.largest_own_client}` : ''}`}</dd>
        <dt>Códigos de vigilancia</dt><dd>92121500 {yesNo(latest.has_guard_code, 'sí', 'no')} · 92121700 {yesNo(latest.has_systems_code, 'sí', 'no')}</dd>
      </dl>
      {history.length > 1 && <details><summary>Documentos cargados ({history.length})</summary>
        <ul>{history.map(item => <li key={item.id}>{SOURCE[item.source_kind] || 'RUP'} · corte {date(item.cut_date)} · cargado {item.created_at.slice(0, 10)}</li>)}</ul></details>}
    </>}
    <dl className="ally-rup-grid">
      <dt>Frecuencia MinTIC</dt><dd>{capabilities.radio_cities || SIN_DATO}{capabilities.radio_source ? ` · ${capabilities.radio_source}` : ''}</dd>
      <dt>SG-SST</dt><dd>{capabilities.sgsst_pct === null || capabilities.sgsst_pct === undefined ? SIN_DATO : `${capabilities.sgsst_pct} %`}{capabilities.sgsst_date ? ` · ${date(capabilities.sgsst_date)}` : ''}</dd>
    </dl>
    {canEdit && <form className="tender-allies-form" onSubmit={event => { event.preventDefault(); void saveCapabilities(); }}>
      <h4>Frecuencia y SG-SST</h4>
      <p className="muted wide">Se confirman en la llamada o con documentos (licencia MinTIC, certificado de la ARL).</p>
      <label>Ciudades con frecuencia MinTIC<input value={draft.radio_cities} onChange={event => setDraft({ ...draft, radio_cities: event.target.value })} maxLength={500} placeholder="Ej. Bogotá, Cundinamarca" /></label>
      <label>Fuente<input value={draft.radio_source} onChange={event => setDraft({ ...draft, radio_source: event.target.value })} maxLength={500} placeholder="Ej. Licencia en su oferta al Terminal" /></label>
      <label>SG-SST (%)<input inputMode="decimal" value={draft.sgsst_pct} onChange={event => setDraft({ ...draft, sgsst_pct: event.target.value })} /></label>
      <label>Fecha del SG-SST<input type="date" value={draft.sgsst_date} onChange={event => setDraft({ ...draft, sgsst_date: event.target.value })} /></label>
      <div className="wide row-actions"><button type="submit" disabled={busy}>Guardar</button></div>
    </form>}
  </div>;
}
