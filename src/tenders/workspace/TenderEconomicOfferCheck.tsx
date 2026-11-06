import { useState } from 'react';
import type { TenderRequest } from '../types';

type Casilla = { hoja: string; celda: string; columna: string | null; fila: string; valor: number | null; problemas: string[] };
type Chequeo = { hoja: string; celda: string; fila: string; resultado: string; cumple: boolean; formula: string; valores: Record<string, number | string | boolean | null> };
type PorConfirmar = { hoja: string | null; celda: string | null; fila: string | null; motivo: string };
export type EconomicOfferCheck = {
  file_name: string; listo: boolean;
  resumen: { casillas: number; casillas_con_problema: number; chequeos_de_la_entidad: number; no_cumplen: number; por_confirmar: number };
  casillas: Casilla[]; chequeos: Chequeo[]; por_confirmar: PorConfirmar[];
};

const pesos = (value: unknown) => (typeof value === 'number' ? value.toLocaleString('es-CO', { maximumFractionDigits: 2 }) : String(value ?? '—'));

/**
 * Mejora 5 (encargo desde Terminal): antes de radicar, el Excel de la propuesta económica se revisa contra sí mismo. En
 * TT-SPO-07 el valor unitario iba sin IVA y el techo con IVA: escribir el techo tal cual era rechazo, y las once casillas
 * venían en cero. El archivo se lee y se descarta; no se guarda. El tope exacto lo propone Vig-IA y lo confirma Katherine.
 */
export function TenderEconomicOfferCheck({ opportunityId, request }: { opportunityId: string; request: TenderRequest }) {
  const [result, setResult] = useState<EconomicOfferCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const check = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
      setResult(await request<EconomicOfferCheck>('/api/tender-economic-offer-check', { method: 'POST', body: JSON.stringify({ opportunity_id: opportunityId, file_name: file.name, file_base64: btoa(binary) }) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const malas = result?.casillas.filter(item => item.problemas.length) || [];
  const noCumplen = result?.chequeos.filter(item => !item.cumple) || [];
  return <section className="tw-card" aria-label="Revisar la propuesta económica">
    <small>Revisar la propuesta económica antes de radicar</small>
    <p className="tw-muted">Suba el Excel de la entidad ya diligenciado. Se revisa que ninguna casilla quede en cero o con centavos y se calcula la verificación que trae el propio Excel (techo con IVA). El archivo no se guarda.</p>
    <input type="file" accept=".xlsx" aria-label="Excel de la propuesta económica" disabled={busy} onChange={event => { void check(event.target.files?.[0]); event.target.value = ''; }} />
    {busy && <p className="tw-muted">Revisando…</p>}
    {error && <div className="error" role="alert">{error}</div>}
    {result && <div className="stack">
      <p className={result.listo ? 'tw-muted' : 'error'}><strong>{result.file_name}:</strong> {result.listo
        ? `Sin problemas en ${result.resumen.casillas} casillas y ${result.resumen.chequeos_de_la_entidad} verificaciones de la entidad. Igual, el valor final lo confirma Katherine.`
        : `${result.resumen.casillas_con_problema} casilla(s) con problema, ${result.resumen.no_cumplen} fila(s) que no cumplen la verificación de la entidad${result.resumen.por_confirmar ? `, ${result.resumen.por_confirmar} por confirmar` : ''}.`}</p>
      {malas.length > 0 && <div><strong>Casillas que hay que corregir</strong><ul>{malas.slice(0, 40).map(item =>
        <li key={`${item.hoja}!${item.celda}`}>{item.celda}{item.columna ? ` (${item.columna})` : ''} · {item.fila}: {item.problemas.join(' ')}</li>)}</ul>
        {malas.length > 40 && <p className="tw-muted">y {malas.length - 40} más.</p>}</div>}
      {noCumplen.length > 0 && <div><strong>Filas que la propia verificación del Excel da como «NO CUMPLE»</strong><ul>{noCumplen.slice(0, 40).map(item =>
        <li key={`${item.hoja}!${item.celda}`}>{item.fila} ({item.celda}): {Object.entries(item.valores).map(([ref, value]) => `${ref} = ${pesos(value)}`).join(' · ')}
          <br /><small className="tw-muted">Fórmula de la entidad: {item.formula}</small></li>)}</ul></div>}
      {result.por_confirmar.length > 0 && <div><strong>Por confirmar</strong><ul>{result.por_confirmar.map(item => <li key={`${item.hoja}!${item.celda}`}>{item.celda ? `${item.celda}: ` : ''}{item.motivo}</li>)}</ul></div>}
    </div>}
  </section>;
}
