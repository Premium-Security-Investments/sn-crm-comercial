// AGT-003 — el formulario de cierre en la ficha (formato GGC-FO-001; Juan, 2026-10-23).
//
// El comercial deja de mandar el Word por correo: lo llena aquí. Lo que el CRM ya sabe viene puesto, y lo que falta se
// nombra en lenguaje común. Las reglas —qué pide, cuándo está completo, cuánto vale, cómo se ve en texto— viven en
// `closure-form.js` y se comparten con el servidor: esta pantalla no decide nada por su cuenta.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../apiClient';
import {
  CLOSURE_FORM_SECTIONS, closureFormCompleteness, closureFormDurationDays, closureFormMoney, closureFormPlainText,
  type ClosureForm, type ClosureFormCatalogField, type ClosureFormPost, type ClosureFormSite,
} from './closure-form.js';

type ClosureFormState = {
  saved: boolean;
  format: { code: string; version: number };
  opportunity: { id: string; company_name: string | null; stage_code: string | null; offer_value: number | null };
  form: ClosureForm;
  sites: ClosureFormSite[];
  posts: ClosureFormPost[];
  catalog: ClosureFormCatalogField[];
  avisos?: string[];
};

const money = (value: number) => `$${Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
const EMPTY_SITE: ClosureFormSite = { address: '', city: '', phone: '', contact_name: '' };
const EMPTY_POST: ClosureFormPost = { description: '', shift_start: '', shift_end: '', days_per_month: 30, guards_required: 1, armed: false, monthly_value: '' };

export function ClosureFormPanel({ opportunityId, company, canEdit, onSaved }: {
  opportunityId: string;
  company?: string | null;
  canEdit: boolean;
  onSaved?: () => void | Promise<void>;
}) {
  const [state, setState] = useState<ClosureFormState | null>(null);
  const [form, setForm] = useState<ClosureForm>({});
  const [sites, setSites] = useState<ClosureFormSite[]>([]);
  const [posts, setPosts] = useState<ClosureFormPost[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const adopt = useCallback((next: ClosureFormState) => {
    setState(next);
    setForm({ ...next.form });
    setSites(next.sites.map(site => ({ ...site })));
    setPosts(next.posts.map(post => ({ ...post })));
  }, []);

  useEffect(() => {
    let alive = true;
    setState(null);
    setError(null);
    api<ClosureFormState>(`/api/agt003/closure-form?opportunity_id=${encodeURIComponent(opportunityId)}`)
      .then(next => { if (alive) adopt(next); })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'No se pudo leer el formulario de cierre.'); });
    return () => { alive = false; };
  }, [opportunityId, adopt]);

  // El estado se recalcula mientras el comercial escribe, con la misma regla del servidor: ve avanzar lo que falta en
  // vez de descubrirlo al guardar.
  const completeness = useMemo(() => closureFormCompleteness({ form, sites, posts }), [form, sites, posts]);
  const totals = useMemo(() => closureFormMoney({ posts, aiuValue: form.aiu_value as number | null }), [posts, form.aiu_value]);
  const duration = closureFormDurationDays(form.service_start_date as string, form.service_end_date as string);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api<ClosureFormState>(`/api/agt003/closure-form?opportunity_id=${encodeURIComponent(opportunityId)}`, {
        method: 'PUT',
        body: JSON.stringify({ form, sites, posts }),
      });
      adopt(next);
      if (onSaved) await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    const text = closureFormPlainText({ form, sites, posts, company: company || state?.opportunity.company_name || null });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 4000);
    } catch {
      setError('El navegador no dejó copiar. Seleccione el texto a mano desde el formulario.');
    }
  };

  if (error && !state) return <section className="panel closure-form-panel"><header><h2>Formulario de cierre</h2></header><p className="closure-form-error">{error}</p></section>;
  if (!state) return <section className="panel closure-form-panel"><header><h2>Formulario de cierre</h2></header><p className="muted">Cargando…</p></section>;

  const field = (meta: ClosureFormCatalogField) => {
    const value = form[meta.key];
    const set = (next: string | number | boolean | null) => setForm(current => ({ ...current, [meta.key]: next }));
    const id = `closure-${meta.key}`;
    const common = { id, disabled: !canEdit || busy };
    return <label className={meta.required ? 'closure-form-field is-required' : 'closure-form-field'} key={meta.key} htmlFor={id}>
      <small>{meta.label}{meta.required ? ' *' : ''}{meta.auto && <span className="closure-form-auto" title="Lo trajo el CRM; puede corregirlo">del CRM</span>}</small>
      {meta.kind === 'si_no'
        ? <select {...common} value={value === true ? 'si' : value === false ? 'no' : ''} onChange={e => set(e.target.value === '' ? null : e.target.value === 'si')}>
            <option value="">—</option><option value="si">Sí</option><option value="no">No</option>
          </select>
        : meta.kind === 'opcion'
          ? <select {...common} value={String(value ?? '')} onChange={e => set(e.target.value || null)}>
              <option value="">—</option>
              {(meta.options || []).map(option => <option key={option} value={option}>{option.charAt(0).toUpperCase() + option.slice(1)}</option>)}
            </select>
          : <input
              {...common}
              type={meta.kind === 'fecha' ? 'date' : meta.kind === 'dinero' ? 'number' : meta.kind === 'correo' ? 'email' : 'text'}
              value={value === null || value === undefined ? '' : String(value)}
              maxLength={meta.max}
              min={meta.kind === 'dinero' ? 0 : undefined}
              onChange={e => set(e.target.value === '' ? null : meta.kind === 'dinero' ? Number(e.target.value) : e.target.value)}
            />}
    </label>;
  };

  return <section className="panel closure-form-panel" aria-label="Formulario de cierre">
    <header>
      <h2>Formulario de cierre</h2>
      <span className={completeness.complete ? 'closure-form-badge is-complete' : 'closure-form-badge'}>
        {completeness.complete ? 'Completo' : `Faltan ${completeness.missing.length}`}
      </span>
    </header>
    <p className="closure-form-intro">
      Es el {state.format.code} que antes iba por correo. Sin él completo no se puede marcar el negocio como ganado.
      {state.saved ? '' : ' Todavía no se ha guardado: lo que ve viene de la oportunidad.'}
    </p>
    {!completeness.complete && <ul className="closure-form-missing">
      {completeness.missing.slice(0, open ? 30 : 3).map((line, index) => <li key={index}>{line}</li>)}
      {!open && completeness.missing.length > 3 && <li className="muted">y {completeness.missing.length - 3} más</li>}
    </ul>}
    <div className="closure-form-actions">
      <button type="button" className="secondary" onClick={() => setOpen(!open)}>{open ? 'Cerrar el formulario' : canEdit ? 'Completar el formulario' : 'Ver el formulario'}</button>
      {state.saved && <button type="button" className="secondary" onClick={copy}>{copied ? 'Copiado' : 'Copiar para enviar'}</button>}
    </div>

    {open && <div className="closure-form-body">
      {CLOSURE_FORM_SECTIONS.map(section => {
        const fields = state.catalog.filter(meta => meta.section === section.key);
        if (!fields.length) return null;
        return <fieldset key={section.key} className="closure-form-section">
          <legend>{section.label}</legend>
          <div className="closure-form-grid">{fields.map(field)}</div>
          {section.key === 'servicio' && duration !== null && <p className="closure-form-note">Duración: {duration} días (unos {Math.round(duration / 30.44)} meses).</p>}
        </fieldset>;
      })}

      <fieldset className="closure-form-section">
        <legend>Direcciones de prestación</legend>
        {sites.map((site, index) => <div className="closure-form-row" key={index}>
          <input disabled={!canEdit || busy} placeholder="Dirección" value={site.address ?? ''} onChange={e => setSites(current => current.map((s, i) => i === index ? { ...s, address: e.target.value } : s))} />
          <input disabled={!canEdit || busy} placeholder="Ciudad" value={site.city ?? ''} onChange={e => setSites(current => current.map((s, i) => i === index ? { ...s, city: e.target.value } : s))} />
          <input disabled={!canEdit || busy} placeholder="Teléfono" value={site.phone ?? ''} onChange={e => setSites(current => current.map((s, i) => i === index ? { ...s, phone: e.target.value } : s))} />
          <input disabled={!canEdit || busy} placeholder="Encargado" value={site.contact_name ?? ''} onChange={e => setSites(current => current.map((s, i) => i === index ? { ...s, contact_name: e.target.value } : s))} />
          {canEdit && <button type="button" className="secondary" onClick={() => setSites(current => current.filter((_, i) => i !== index))} aria-label={`Quitar la dirección ${index + 1}`}>Quitar</button>}
        </div>)}
        {canEdit && <button type="button" className="secondary" onClick={() => setSites(current => [...current, { ...EMPTY_SITE }])}>Agregar dirección</button>}
      </fieldset>

      <fieldset className="closure-form-section">
        <legend>Puestos vendidos</legend>
        {posts.map((post, index) => {
          const change = (patch: Partial<ClosureFormPost>) => setPosts(current => current.map((p, i) => i === index ? { ...p, ...patch } : p));
          return <div className="closure-form-post" key={index}>
            <input disabled={!canEdit || busy} placeholder="Qué se vigila y en qué modalidad" value={post.description ?? ''} onChange={e => change({ description: e.target.value })} />
            <div className="closure-form-row">
              <label><small>Desde</small><input disabled={!canEdit || busy} type="time" value={post.shift_start ?? ''} onChange={e => change({ shift_start: e.target.value })} /></label>
              <label><small>Hasta</small><input disabled={!canEdit || busy} type="time" value={post.shift_end ?? ''} onChange={e => change({ shift_end: e.target.value })} /></label>
              <label><small>Días al mes</small><input disabled={!canEdit || busy} type="number" min={1} max={31} value={post.days_per_month ?? ''} onChange={e => change({ days_per_month: e.target.value === '' ? null : Number(e.target.value) })} /></label>
              <label><small>Vigilantes</small><input disabled={!canEdit || busy} type="number" min={1} max={50} value={post.guards_required ?? ''} onChange={e => change({ guards_required: e.target.value === '' ? null : Number(e.target.value) })} /></label>
              <label className="closure-form-check"><input disabled={!canEdit || busy} type="checkbox" checked={post.armed === true} onChange={e => change({ armed: e.target.checked })} /><small>Con arma</small></label>
              <label><small>Valor mensual</small><input disabled={!canEdit || busy} type="number" min={0} value={post.monthly_value === null || post.monthly_value === undefined ? '' : String(post.monthly_value)} onChange={e => change({ monthly_value: e.target.value === '' ? null : Number(e.target.value) })} /></label>
              {canEdit && <button type="button" className="secondary" onClick={() => setPosts(current => current.filter((_, i) => i !== index))} aria-label={`Quitar el puesto ${index + 1}`}>Quitar</button>}
            </div>
          </div>;
        })}
        {canEdit && <button type="button" className="secondary" onClick={() => setPosts(current => [...current, { ...EMPTY_POST }])}>Agregar puesto</button>}
        {/* Las sumas las calcula el sistema: en el Word iban a mano y el ejemplar que llegó traía el total descuadrado. */}
        <dl className="closure-form-money">
          <div><dt>Subtotal</dt><dd>{money(totals.subtotal)}</dd></div>
          <div><dt>AIU informativo</dt><dd>{totals.aiuMissing ? 'sin registrar' : money(totals.aiu as number)}</dd></div>
          <div><dt>IVA 19 % sobre el AIU</dt><dd>{totals.iva === null ? 'sin registrar' : money(totals.iva)}</dd></div>
          <div className="closure-form-total"><dt>Total</dt><dd>{money(totals.total)}{totals.aiuMissing ? ' (sin IVA)' : ''}</dd></div>
        </dl>
      </fieldset>

      {error && <p className="closure-form-error">{error}</p>}
      {state.avisos?.length ? <ul className="closure-form-warnings">{state.avisos.map((aviso, index) => <li key={index}>{aviso}</li>)}</ul> : null}
      {canEdit && <div className="closure-form-actions">
        <button type="button" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Guardar el formulario'}</button>
        <span className="muted">Se puede guardar incompleto: queda como borrador.</span>
      </div>}
    </div>}
  </section>;
}
