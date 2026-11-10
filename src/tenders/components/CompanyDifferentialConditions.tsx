import { useEffect, useState } from 'react';
import type { TenderRequest } from '../types';
import { CONDITION_STATUSES } from '../../../verticales/licitaciones/differential-conditions.js';

/**
 * Mejora 10 (Juan, 2026-11-10): las condiciones diferenciales de la empresa en Empresa —empresa de mujeres, tamaño y
 * personas con discapacidad en la nómina— con su soporte y la fecha de la certificación. Las ponen Juan o Katherine;
 * Vig-IA las usa para avisar en cada pliego dónde dan beneficio.
 */
type Condition = { code: string; label: string; help: string; status: string; value: string | null; detail: string | null; evidence: string | null; certified_on: string | null; updated_at?: string | null };
type Payload = { installed: boolean; conditions: Condition[] };

export function CompanyDifferentialConditions({ request, canEdit }: { request: TenderRequest; canEdit: boolean }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [editing, setEditing] = useState<Condition | null>(null);
  const [message, setMessage] = useState('');
  const load = async () => { try { setPayload(await request<Payload>('/api/tender-company-differential-conditions')); } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); } };
  useEffect(() => { void load(); }, []);
  const save = async (condition: Condition) => {
    try {
      await request('/api/tender-company-differential-conditions', { method: 'POST', body: JSON.stringify(condition) });
      setEditing(null); setMessage('Condición guardada.'); await load();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
  };
  if (!payload?.installed) return null;
  return <section className="panel company-differential" aria-labelledby="company-differential-heading">
    <header className="company-base-section-head"><div><span className="eyebrow">Condiciones diferenciales</span><h3 id="company-differential-heading">Lo que puede dar beneficio en un pliego</h3><p>Vig-IA las busca en cada licitación (garantía más baja, puntaje o desempate) y avisa en Decidir.</p></div></header>
    {message && <div className="notice" role="status">{message}</div>}
    <div className="company-differential-grid">{payload.conditions.map(condition => editing?.code === condition.code
      ? <form key={condition.code} className="company-differential-card is-editing" onSubmit={event => { event.preventDefault(); void save(editing); }}>
        <strong>{condition.label}</strong>
        <label>Estado<select value={editing.status} onChange={event => setEditing({ ...editing, status: event.target.value })}>{Object.entries(CONDITION_STATUSES).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
        {condition.code === 'tamano_empresarial' && <label>Tamaño<select value={editing.value || ''} onChange={event => setEditing({ ...editing, value: event.target.value || null })}><option value="">Sin definir</option><option value="gran_empresa">Gran Empresa</option><option value="mediana">Mediana</option><option value="pequena">Pequeña</option><option value="micro">Micro</option></select></label>}
        <label>Detalle<textarea rows={3} value={editing.detail || ''} onChange={event => setEditing({ ...editing, detail: event.target.value })} maxLength={1000} /></label>
        <label>Soporte<input value={editing.evidence || ''} onChange={event => setEditing({ ...editing, evidence: event.target.value })} maxLength={500} placeholder="Documento y dónde está" /></label>
        <label>Fecha de la certificación<input type="date" value={editing.certified_on || ''} onChange={event => setEditing({ ...editing, certified_on: event.target.value || null })} /></label>
        <div className="row-actions"><button type="submit">Guardar</button><button type="button" className="secondary" onClick={() => setEditing(null)}>Cancelar</button></div>
      </form>
      : <article key={condition.code} className={`company-differential-card is-${condition.status}`}>
        <div className="company-differential-head"><strong>{condition.label}</strong><span className="company-differential-status">{CONDITION_STATUSES[condition.status as keyof typeof CONDITION_STATUSES] || condition.status}{condition.code === 'tamano_empresarial' && condition.value === 'gran_empresa' ? ' · Gran Empresa' : ''}</span></div>
        <small className="muted">{condition.help}</small>
        {condition.detail && <p>{condition.detail}</p>}
        {condition.evidence && <small><b>Soporte:</b> {condition.evidence}</small>}
        {condition.certified_on && <small><b>Certificada el:</b> {condition.certified_on}</small>}
        {canEdit && <button type="button" className="secondary" onClick={() => setEditing(condition)}>Editar</button>}
      </article>)}</div>
  </section>;
}

type Benefit = { code: string; label: string; verdict: 'aplica' | 'no_aplica' | 'por_confirmar'; kinds: string[]; action: string; mentions: Array<{ document: string; excerpt: string; kinds: string[] }> };
const KIND_LABEL: Record<string, string> = { garantia: 'garantía', desempate: 'desempate', puntaje: 'puntaje', experiencia: 'experiencia' };
const VERDICT_LABEL: Record<string, string> = { aplica: 'Nos aplica', no_aplica: 'No nos aplica', por_confirmar: 'Por confirmar' };

/** En Decidir: dónde este pliego premia una condición diferencial y qué hacer (Juan, 2026-11-10). */
export function TenderDifferentialBenefits({ opportunityId, request }: { opportunityId: string; request: TenderRequest }) {
  const [benefits, setBenefits] = useState<Benefit[] | null>(null);
  useEffect(() => {
    let active = true;
    void request<{ installed: boolean; benefits: Benefit[] }>(`/api/tender-differential-benefits?opportunity_id=${encodeURIComponent(opportunityId)}`)
      .then(payload => { if (active) setBenefits(payload.installed ? payload.benefits : []); }, () => undefined);
    return () => { active = false; };
  }, [opportunityId, request]);
  if (!benefits?.length) return null;
  return <div className="tw-differential">
    <strong>Condiciones diferenciales en este pliego</strong>
    <ul>{benefits.map(benefit => <li key={benefit.code} className={`tw-differential-${benefit.verdict}`}>
      <b>{benefit.label}</b> · {VERDICT_LABEL[benefit.verdict]}{benefit.kinds.length ? ` · ${benefit.kinds.map(kind => KIND_LABEL[kind] || kind).join(', ')}` : ''}
      <span>{benefit.action}</span>
      <details><summary>Dónde lo dice ({benefit.mentions.length})</summary><ul>{benefit.mentions.map((mention, index) => <li key={index}><small><b>{mention.document}:</b> {mention.excerpt}</small></li>)}</ul></details>
    </li>)}</ul>
  </div>;
}
