import { useEffect, useMemo, useState } from 'react';
import { api } from '../apiClient';
import {
  DEFAULT_GUARD_RATES, DEFAULT_TECH_RATES, GUARD_DAY_TYPES, GUARD_MODALITIES, TECH_CATEGORIES, quoteGuardPost, quoteTechLine,
  type GuardDayType, type GuardModality, type GuardPostInput, type GuardRates, type TechCategory, type TechLineInput, type TechRates,
} from './quote-engine.js';

// AGT-003 — Sección Cotizar (entrega 3; Juan, 2026-11-11). Una sola sección para los dos cotizadores: vigilancia
// (puestos, se cobra cada mes) y tecnología (equipos, insumos y mano de obra, se paga una vez). Se entra desde el menú
// —cotización rápida, sin oportunidad— o desde la oportunidad, y una cotización suelta se liga después. La cuenta la
// hace `quote-engine.js`, el mismo motor que usa el servidor; la pantalla sólo la muestra mientras se escribe.

type RateRow = { id?: string; kind: string; valid_from: string | null; params: Record<string, unknown>; notes?: string | null; created_at?: string };
type RatesResponse = { today: string; canEdit: boolean; motivo: string | null; rates: { vigilancia: { current: RateRow; history: RateRow[] }; tecnologia: { current: RateRow; history: RateRow[] } } };
type QuoteSummary = { id: string; opportunity_id: string | null; client_name: string | null; title: string | null; status: string; created_at: string; updated_at: string };
type QuoteFull = QuoteSummary & { guardPosts: GuardPostInput[]; techLines: TechLineInput[]; totals: { monthly: { subtotal: number; iva: number; total: number }; oneTime: { subtotal: number; iva: number; total: number } } };
type OpportunityOption = { id: string; company_name: string; service_type_code?: string | null };

const MODALITY_LABEL: Record<GuardModality, string> = { sin_arma: 'Sin arma', con_arma: 'Con arma', canino: 'Canino' };
const CATEGORY_LABEL: Record<TechCategory, string> = { equipo: 'Equipo', insumo: 'Insumo (tubería, cableado, fijación)', mano_de_obra: 'Mano de obra y programación' };
const pesos = (value: number) => `$ ${Math.round(value || 0).toLocaleString('es-CO')}`;
const day = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const newPost = (): GuardPostInput => ({ name: '', start: '0600', end: '1800', dayTypes: GUARD_DAY_TYPES.map(type => type.code), guards: 1, modality: 'con_arma' });
const newLine = (): TechLineInput => ({ description: '', category: 'equipo', quantity: 1, unitCost: 0 });

function useRates() {
  const [rates, setRates] = useState<RatesResponse | null>(null);
  const [error, setError] = useState('');
  const load = async () => {
    try { setRates(await api<RatesResponse>('/api/agt003/quote-rates')); setError(''); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  useEffect(() => { void load(); }, []);
  const guardRates = (rates?.rates.vigilancia.current.params as unknown as GuardRates) || DEFAULT_GUARD_RATES;
  const techRates = (rates?.rates.tecnologia.current.params as unknown as TechRates) || DEFAULT_TECH_RATES;
  return { rates, error, guardRates, techRates, reload: load };
}

/** La sección completa: lista, editor (`nueva` o un id) y tarifas (`tarifas`, sólo administrador). */
export function QuotesSection({ id, opportunities, navigate }: { id?: string; opportunities: OpportunityOption[]; navigate: (hash: string) => void }) {
  const { rates, error, guardRates, techRates, reload } = useRates();
  const tabs = <div className="quote-tabs" role="navigation" aria-label="Cotizar">
    <a className={!id || (id !== 'tarifas') ? 'is-active' : ''} href="#/cotizar">Cotizaciones</a>
    {rates?.canEdit && <a className={id === 'tarifas' ? 'is-active' : ''} href="#/cotizar/tarifas">Tarifas</a>}
  </div>;
  if (id === 'tarifas') return <section className="stack quotes-section">{tabs}<RatesPanel rates={rates} error={error} onSaved={reload} /></section>;
  if (id) return <section className="stack quotes-section">{tabs}<QuoteEditor quoteId={id === 'nueva' ? null : id} opportunities={opportunities} guardRates={guardRates} techRates={techRates} ratesNote={rates?.motivo || null} navigate={navigate} /></section>;
  return <section className="stack quotes-section">{tabs}<QuoteList navigate={navigate} opportunities={opportunities} /></section>;
}

function QuoteList({ navigate, opportunities, opportunityId }: { navigate: (hash: string) => void; opportunities: OpportunityOption[]; opportunityId?: string }) {
  const [quotes, setQuotes] = useState<QuoteSummary[] | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api<{ quotes: QuoteSummary[]; motivo: string | null }>(`/api/agt003/quotes${opportunityId ? `?opportunity_id=${encodeURIComponent(opportunityId)}` : ''}`);
        if (alive) { setQuotes(r.quotes); setNote(r.motivo || ''); }
      } catch (err) { if (alive) { setQuotes([]); setNote(err instanceof Error ? err.message : String(err)); } }
    })();
    return () => { alive = false; };
  }, [opportunityId]);
  const opportunityName = (oid: string | null) => opportunities.find(o => o.id === oid)?.company_name || null;
  return <section className="panel">
    <div className="quote-list-head">
      <h2>{opportunityId ? 'Cotizaciones de esta oportunidad' : 'Cotizaciones'}</h2>
      <button type="button" onClick={() => navigate(`#/cotizar/nueva${opportunityId ? `?opportunity=${encodeURIComponent(opportunityId)}` : ''}`)}>Nueva cotización</button>
    </div>
    {note && <p className="muted">{note}</p>}
    {quotes === null ? <p className="muted">Cargando…</p> : !quotes.length ? <p className="muted">Todavía no hay cotizaciones.</p>
      : <ul className="quote-list">{quotes.map(q => <li key={q.id}><a href={`#/cotizar/${q.id}`}>
        <strong>{q.client_name || 'Sin cliente'}</strong>
        <small>{q.title ? `${q.title} · ` : ''}{opportunityName(q.opportunity_id) ? `Oportunidad: ${opportunityName(q.opportunity_id)} · ` : 'Sin oportunidad · '}Actualizada {day(q.updated_at)}</small>
      </a></li>)}</ul>}
  </section>;
}

/** Lista corta para la ficha de la oportunidad. */
export function OpportunityQuotes({ opportunityId, opportunities, navigate }: { opportunityId: string; opportunities: OpportunityOption[]; navigate: (hash: string) => void }) {
  return <QuoteList opportunityId={opportunityId} opportunities={opportunities} navigate={navigate} />;
}

function QuoteEditor({ quoteId, opportunities, guardRates, techRates, ratesNote, navigate }: {
  quoteId: string | null; opportunities: OpportunityOption[]; guardRates: GuardRates; techRates: TechRates; ratesNote: string | null; navigate: (hash: string) => void;
}) {
  const presetOpportunity = useMemo(() => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.hash.split('?')[1] || '').get('opportunity') || ''), [quoteId]);
  const [clientName, setClientName] = useState('');
  const [title, setTitle] = useState('');
  const [opportunityId, setOpportunityId] = useState(presetOpportunity);
  const [kinds, setKinds] = useState<{ vigilancia: boolean; tecnologia: boolean }>({ vigilancia: true, tecnologia: false });
  const [posts, setPosts] = useState<GuardPostInput[]>([newPost()]);
  const [lines, setLines] = useState<TechLineInput[]>([newLine()]);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!quoteId) {
      const preset = opportunities.find(o => o.id === presetOpportunity);
      if (preset) setClientName(preset.company_name);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const q = await api<QuoteFull>(`/api/agt003/quote?id=${encodeURIComponent(quoteId)}`);
        if (!alive) return;
        setClientName(q.client_name || ''); setTitle(q.title || ''); setOpportunityId(q.opportunity_id || '');
        setPosts(q.guardPosts.length ? q.guardPosts : [newPost()]);
        setLines(q.techLines.length ? q.techLines : [newLine()]);
        setKinds({ vigilancia: q.guardPosts.length > 0, tecnologia: q.techLines.length > 0 });
      } catch (err) { if (alive) setStatus(err instanceof Error ? err.message : String(err)); }
    })();
    return () => { alive = false; };
  }, [quoteId]);

  const postResults = posts.map(post => { try { return { ok: true as const, value: quoteGuardPost(post, guardRates) }; } catch (err) { return { ok: false as const, error: err instanceof Error ? err.message : String(err) }; } });
  const lineResults = lines.map(line => { try { return { ok: true as const, value: quoteTechLine(line, techRates) }; } catch (err) { return { ok: false as const, error: err instanceof Error ? err.message : String(err) }; } });
  const monthly = kinds.vigilancia ? postResults.reduce((acc, r) => r.ok ? { subtotal: acc.subtotal + r.value.subtotal, aiu: acc.aiu + r.value.aiu, iva: acc.iva + r.value.iva, total: acc.total + r.value.total } : acc, { subtotal: 0, aiu: 0, iva: 0, total: 0 }) : null;
  const techSubtotal = kinds.tecnologia ? lineResults.reduce((sum, r) => sum + (r.ok ? r.value.price : 0), 0) : 0;
  const oneTime = kinds.tecnologia ? { subtotal: techSubtotal, iva: Math.round(techSubtotal * techRates.ivaRate), total: techSubtotal + Math.round(techSubtotal * techRates.ivaRate) } : null;
  const hasErrors = (kinds.vigilancia && postResults.some(r => !r.ok)) || (kinds.tecnologia && lineResults.some(r => !r.ok));

  const setPost = (index: number, patch: Partial<GuardPostInput>) => setPosts(list => list.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  const setLine = (index: number, patch: Partial<TechLineInput>) => setLines(list => list.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const toggleDay = (index: number, code: GuardDayType) => setPosts(list => list.map((p, i) => (i !== index ? p : { ...p, dayTypes: p.dayTypes.includes(code) ? p.dayTypes.filter(d => d !== code) : [...p.dayTypes, code] })));

  const save = async () => {
    if (!kinds.vigilancia && !kinds.tecnologia) { setStatus('Escoja qué va a cotizar: vigilancia, tecnología o las dos.'); return; }
    if (hasErrors) { setStatus('Corrija los datos marcados antes de guardar.'); return; }
    setSaving(true); setStatus('Guardando…');
    try {
      const body = JSON.stringify({ client_name: clientName, title, opportunity_id: opportunityId || undefined, guardPosts: kinds.vigilancia ? posts : [], techLines: kinds.tecnologia ? lines : [] });
      const saved = quoteId
        ? await api<QuoteFull>(`/api/agt003/quote?id=${encodeURIComponent(quoteId)}`, { method: 'PUT', body })
        : await api<QuoteFull>('/api/agt003/quotes', { method: 'POST', body });
      setStatus('Guardada.');
      if (!quoteId) navigate(`#/cotizar/${saved.id}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally { setSaving(false); }
  };

  const commercialOptions = opportunities.filter(o => o.service_type_code !== 'licitacion_publica').sort((a, b) => a.company_name.localeCompare(b.company_name, 'es'));
  return <div className="stack quote-editor">
    <section className="panel">
      <h2>{quoteId ? 'Cotización' : 'Nueva cotización'}</h2>
      {ratesNote && <p className="muted">{ratesNote}</p>}
      <div className="form gridform">
        <label>Cliente<input value={clientName} maxLength={200} onChange={e => setClientName(e.target.value)} placeholder="Nombre del cliente" /></label>
        <label>Referencia (opcional)<input value={title} maxLength={200} onChange={e => setTitle(e.target.value)} placeholder="Ej. Portería y CCTV sede norte" /></label>
        <label className="wide">Oportunidad (opcional)<select value={opportunityId} onChange={e => setOpportunityId(e.target.value)}>
          <option value="">Sin oportunidad: cotización rápida</option>
          {commercialOptions.map(o => <option key={o.id} value={o.id}>{o.company_name}</option>)}
        </select></label>
      </div>
      <div className="quote-kind" role="group" aria-label="Qué va a cotizar">
        <span>¿Qué va a cotizar?</span>
        <button type="button" aria-pressed={kinds.vigilancia} className={kinds.vigilancia ? 'is-on' : ''} onClick={() => setKinds(k => ({ ...k, vigilancia: !k.vigilancia }))}>Vigilancia</button>
        <button type="button" aria-pressed={kinds.tecnologia} className={kinds.tecnologia ? 'is-on' : ''} onClick={() => setKinds(k => ({ ...k, tecnologia: !k.tecnologia }))}>Medios tecnológicos</button>
      </div>
    </section>

    {kinds.vigilancia && <section className="panel">
      <h2>Vigilancia · puestos</h2>
      <p className="muted">Factor {String(guardRates.factor).replace('.', ',')} · salario mínimo {pesos(guardRates.smlmv)} · seguro de vida {pesos(guardRates.lifeInsurancePerGuard)} por guarda. Horas en formato militar: 0600, 1900; "0600 a 0600" es un turno de 24 horas.</p>
      {posts.map((post, index) => {
        const result = postResults[index];
        return <div className="quote-row" key={index}>
          <div className="form gridform">
            <label>Puesto<input value={post.name} onChange={e => setPost(index, { name: e.target.value })} placeholder="Ej. Portería principal" /></label>
            <label>Inicio<input inputMode="numeric" maxLength={5} value={post.start} onChange={e => setPost(index, { start: e.target.value })} /></label>
            <label>Fin<input inputMode="numeric" maxLength={5} value={post.end} onChange={e => setPost(index, { end: e.target.value })} /></label>
            <label>Guardas<input type="number" min={1} max={50} value={post.guards} onChange={e => setPost(index, { guards: Number(e.target.value) })} /></label>
            <label>Modalidad<select value={post.modality} onChange={e => setPost(index, { modality: e.target.value as GuardModality })}>
              {GUARD_MODALITIES.map(code => <option key={code} value={code}>{MODALITY_LABEL[code]} ({Math.round((guardRates.modalities[code] || 0) * 100)} %)</option>)}
            </select></label>
          </div>
          <div className="quote-days" role="group" aria-label="Días que cubre">
            {GUARD_DAY_TYPES.map(type => <label key={type.code} className="checkline-inline"><input type="checkbox" checked={post.dayTypes.includes(type.code)} onChange={() => toggleDay(index, type.code)} /> {type.label} ({type.days})</label>)}
          </div>
          {result.ok
            ? <p className="quote-line-total">{result.value.totalHours} h ({result.value.dayHours} día / {result.value.nightHours} noche) · {result.value.days} días · Subtotal {pesos(result.value.subtotal)} · IVA {pesos(result.value.iva)} · <strong>Total al mes {pesos(result.value.total)}</strong></p>
            : <p className="quote-line-error" role="alert">{result.error}</p>}
          {posts.length > 1 && <button type="button" className="secondary" onClick={() => setPosts(list => list.filter((_, i) => i !== index))}>Quitar puesto</button>}
        </div>;
      })}
      <button type="button" className="secondary" onClick={() => setPosts(list => [...list, newPost()])}>Agregar puesto</button>
    </section>}

    {kinds.tecnologia && <section className="panel">
      <h2>Medios tecnológicos · equipos, insumos y mano de obra</h2>
      <p className="muted">Escriba el costo unitario sin IVA; el precio sale con el margen del {Math.round(techRates.margin * 100)} %. La comisión se calcula sobre el precio de los equipos.</p>
      {lines.map((line, index) => {
        const result = lineResults[index];
        return <div className="quote-row" key={index}>
          <div className="form gridform">
            <label className="wide">Descripción<input value={line.description} onChange={e => setLine(index, { description: e.target.value })} placeholder="Ej. Cámara de placas 4 MP" /></label>
            <label>Tipo<select value={line.category} onChange={e => setLine(index, { category: e.target.value as TechCategory })}>
              {TECH_CATEGORIES.map(code => <option key={code} value={code}>{CATEGORY_LABEL[code]}</option>)}
            </select></label>
            <label>Cantidad<input type="number" min={0} step="any" value={line.quantity} onChange={e => setLine(index, { quantity: Number(e.target.value) })} /></label>
            <label>Costo unitario<input type="number" min={0} value={line.unitCost} onChange={e => setLine(index, { unitCost: Number(e.target.value) })} /></label>
          </div>
          {result.ok
            ? <p className="quote-line-total">Precio unitario {pesos(result.value.unitPrice)} · <strong>Total {pesos(result.value.price)}</strong></p>
            : <p className="quote-line-error" role="alert">{result.error}</p>}
          {lines.length > 1 && <button type="button" className="secondary" onClick={() => setLines(list => list.filter((_, i) => i !== index))}>Quitar línea</button>}
        </div>;
      })}
      <button type="button" className="secondary" onClick={() => setLines(list => [...list, newLine()])}>Agregar línea</button>
    </section>}

    <section className="panel quote-summary">
      <h2>Resumen</h2>
      {monthly && <p><strong>Vigilancia, cada mes:</strong> subtotal {pesos(monthly.subtotal)} · AIU {pesos(monthly.aiu)} · IVA {pesos(monthly.iva)} · <strong>{pesos(monthly.total)}</strong></p>}
      {oneTime && <p><strong>Tecnología, pago único:</strong> subtotal {pesos(oneTime.subtotal)} · IVA {pesos(oneTime.iva)} · <strong>{pesos(oneTime.total)}</strong></p>}
      <div className="formactions"><button type="button" disabled={saving} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar cotización'}</button>{status && <span role="status">{status}</span>}</div>
    </section>
  </div>;
}

/** Tarifas con vigencia (sólo administrador). Nunca se edita una vigencia: se agrega otra con su fecha. */
function RatesPanel({ rates, error, onSaved }: { rates: RatesResponse | null; error: string; onSaved: () => Promise<void> }) {
  const [kind, setKind] = useState<'vigilancia' | 'tecnologia'>('vigilancia');
  const [validFrom, setValidFrom] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('');
  const current = rates?.rates[kind].current.params || {};
  const pct = (v: unknown) => String(Math.round(Number(v || 0) * 10000) / 100);
  useEffect(() => {
    if (!rates) return;
    const p = rates.rates[kind].current.params as Record<string, any>;
    setValues(kind === 'vigilancia'
      ? { smlmv: String(p.smlmv), factor: String(p.factor), sin_arma: pct(p.modalities?.sin_arma), con_arma: pct(p.modalities?.con_arma), canino: pct(p.modalities?.canino), seguro: String(p.lifeInsurancePerGuard), dia: pct(p.dayShare), noche: pct(p.nightShare), inicio: String(p.dayStartHour), fin: String(p.dayEndHour), aiu: pct(p.aiuRate), iva: pct(p.ivaRate) }
      : { margen: pct(p.margin), iva: pct(p.ivaRate) });
  }, [rates, kind]);
  if (error) return <section className="panel"><p className="muted">{error}</p></section>;
  if (!rates) return <section className="panel"><p className="muted">Cargando tarifas…</p></section>;
  if (!rates.canEdit) return <section className="panel"><p className="muted">Sólo el administrador carga tarifas.</p></section>;
  const n = (key: string) => Number(String(values[key] ?? '').replace(',', '.'));
  const save = async () => {
    setStatus('Guardando…');
    const params = kind === 'vigilancia'
      ? { smlmv: n('smlmv'), factor: n('factor'), dayShare: n('dia') / 100, nightShare: n('noche') / 100, dayStartHour: n('inicio'), dayEndHour: n('fin'), modalities: { sin_arma: n('sin_arma') / 100, con_arma: n('con_arma') / 100, canino: n('canino') / 100 }, lifeInsurancePerGuard: n('seguro'), aiuRate: n('aiu') / 100, ivaRate: n('iva') / 100 }
      : { margin: n('margen') / 100, ivaRate: n('iva') / 100 };
    try {
      await api('/api/agt003/quote-rates', { method: 'POST', body: JSON.stringify({ kind, valid_from: validFrom, params, notes }) });
      setStatus('Guardada. Rige desde la fecha indicada.'); setValidFrom(''); setNotes('');
      await onSaved();
    } catch (err) { setStatus(err instanceof Error ? err.message : String(err)); }
  };
  const field = (key: string, label: string) => <label key={key}>{label}<input value={values[key] ?? ''} onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))} /></label>;
  return <div className="stack">
    <section className="panel">
      <h2>Tarifas vigentes</h2>
      <p className="muted">Hoy ({day(rates.today)}): vigilancia con factor {String((rates.rates.vigilancia.current.params as any).factor).replace('.', ',')} desde {day(rates.rates.vigilancia.current.valid_from)}; tecnología con margen del {pct((rates.rates.tecnologia.current.params as any).margin)} % desde {day(rates.rates.tecnologia.current.valid_from)}.</p>
      {(['vigilancia', 'tecnologia'] as const).map(k => <details key={k}><summary>Historia de {k === 'vigilancia' ? 'vigilancia' : 'tecnología'}</summary>
        <ul className="quote-list">{rates.rates[k].history.map(row => <li key={row.id}><span><strong>Desde {day(row.valid_from)}</strong> · {k === 'vigilancia' ? `factor ${String((row.params as any).factor).replace('.', ',')}` : `margen ${pct((row.params as any).margin)} %`}{row.notes ? ` · ${row.notes}` : ''}</span></li>)}</ul>
      </details>)}
    </section>
    <section className="panel">
      <h2>Cargar tarifas nuevas</h2>
      <p className="muted">La Superintendencia publica las del año siguiente a más tardar el 31 de diciembre. Las anteriores no se borran: quedan como historia y cada cotización guarda las tarifas con que se hizo.</p>
      <div className="quote-kind" role="group" aria-label="Tipo de tarifa">
        <button type="button" aria-pressed={kind === 'vigilancia'} className={kind === 'vigilancia' ? 'is-on' : ''} onClick={() => setKind('vigilancia')}>Vigilancia</button>
        <button type="button" aria-pressed={kind === 'tecnologia'} className={kind === 'tecnologia' ? 'is-on' : ''} onClick={() => setKind('tecnologia')}>Tecnología</button>
      </div>
      <div className="form gridform">
        <label>Rige desde<input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} /></label>
        {kind === 'vigilancia'
          ? [field('factor', 'Factor'), field('smlmv', 'Salario mínimo'), field('seguro', 'Seguro de vida por guarda'), field('sin_arma', 'Sin arma (%)'), field('con_arma', 'Con arma (%)'), field('canino', 'Canino (%)'), field('dia', 'Participación día (%)'), field('noche', 'Participación noche (%)'), field('inicio', 'El día empieza (hora)'), field('fin', 'La noche empieza (hora)'), field('aiu', 'AIU (%)'), field('iva', 'IVA sobre el AIU (%)')]
          : [field('margen', 'Margen sobre el precio (%)'), field('iva', 'IVA (%)')]}
        <label className="wide">Nota<input value={notes} maxLength={500} onChange={e => setNotes(e.target.value)} placeholder="Ej. Circular de la Superintendencia de diciembre de 2026" /></label>
      </div>
      <div className="formactions"><button type="button" onClick={() => void save()} disabled={!validFrom}>Guardar tarifas</button>{status && <span role="status">{status}</span>}</div>
      <p className="muted">Valores precargados: los vigentes de hoy ({kind === 'vigilancia' ? `factor ${String((current as any).factor ?? '').replace('.', ',')}` : `margen ${pct((current as any).margin)} %`}).</p>
    </section>
  </div>;
}
