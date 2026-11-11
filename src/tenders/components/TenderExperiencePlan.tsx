import { useEffect, useState } from 'react';
import type { TenderRequest } from '../types';

/**
 * Mejora 9, tercera parte (Juan, 2026-11-11: «ok»): «Experiencia para esta oferta», en Preparar. Vig-IA propone qué
 * contratos del RUP van a la parte habilitante y cuáles a la ponderable; el servidor revisa la suma, el máximo, los
 * códigos y los certificados; una persona acepta o cambia y guarda.
 */
type Item = { consecutivo: string; cliente: string; valor_smmlv: number; codigos_que_cumple: string[]; cumple_codigos: boolean; certificado: string; certificado_ok: boolean };
type Plan = {
  requisito: { minimo_smmlv: number | null; maximo_contratos: number | null; codigos: string[]; codigos_regla: string; objeto: string | null; otras_condiciones: string | null; cita: string | null; ponderable_criterio: string | null; ponderable_cita: string | null };
  explicacion: string | null; dudas: string[]; ajustada_por_persona: boolean;
  habilitante: Item[]; ponderable: Item[]; suma_habilitante_smmlv: number; minimo_smmlv: number | null; cumple_minimo: boolean | null;
  faltan_certificados: Array<{ consecutivo: string; cliente: string; estado: string }>; avisos: string[];
  contratos: Array<{ consecutivo: string; cliente: string; valor_smmlv: number; certificado: string }>;
};
const CERT: Record<string, string> = { falta: 'Falta certificado', pedido: 'Certificado pedido', recibido: 'Certificado recibido', incompleto: 'Certificado incompleto', completo: 'Certificado completo' };
const number = (value: number) => value.toLocaleString('es-CO', { maximumFractionDigits: 2 });

export function TenderExperiencePlan({ opportunityId, request, canEdit }: { opportunityId: string; request: TenderRequest; canEdit: boolean }) {
  const [state, setState] = useState<{ installed: boolean; plan: Plan | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState<{ habilitante: string[]; ponderable: string[] } | null>(null);
  const load = async () => {
    try {
      const next = await request<{ installed: boolean; plan: Plan | null }>('/api/tender-experience-plan?opportunity_id=' + encodeURIComponent(opportunityId));
      setState(next); setDraft(null);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
  };
  useEffect(() => { void load(); }, [opportunityId]);
  const propose = async () => {
    setBusy(true); setMessage('Vig-IA está leyendo el pliego y su experiencia; tarda un minuto…');
    try {
      const result = await request<{ status: string; reason?: string }>('/api/tender-experience-plan/propose', { method: 'POST', body: JSON.stringify({ opportunity_id: opportunityId }) });
      setMessage(result.status === 'ran' ? 'Propuesta lista.' : result.reason === 'sin_requisito_de_experiencia' ? 'El análisis de este proceso no tiene requisitos de experiencia.' : result.reason === 'apagada' ? 'Vig-IA está apagada.' : 'Vig-IA no pudo armar la propuesta; intente de nuevo.');
      await load();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try { await request('/api/tender-experience-plan/selection', { method: 'POST', body: JSON.stringify({ opportunity_id: opportunityId, ...draft }) }); setMessage('Selección guardada.'); await load(); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  };
  if (!state?.installed) return null;
  const plan = state.plan;
  const current = draft || (plan ? { habilitante: plan.habilitante.map(item => item.consecutivo), ponderable: plan.ponderable.map(item => item.consecutivo) } : null);
  const move = (consecutivo: string, to: 'habilitante' | 'ponderable' | 'fuera') => {
    if (!current) return;
    const next = { habilitante: current.habilitante.filter(item => item !== consecutivo), ponderable: current.ponderable.filter(item => item !== consecutivo) };
    if (to !== 'fuera') next[to] = [...next[to], consecutivo];
    setDraft(next);
  };
  const list = (title: string, items: Item[], part: 'habilitante' | 'ponderable') => <div className="tw-xp-part">
    <h4>{title} · {items.length}</h4>
    {items.length === 0 ? <p className="tw-muted">Ningún contrato.</p> : <ul>{items.map(item => <li key={item.consecutivo}>
      <div className="tw-ally-line"><b>{item.consecutivo}</b> <span>{item.cliente}</span> <span className="tw-ally-meta">{number(item.valor_smmlv)} SMMLV</span>
        {canEdit && <select aria-label={`Mover el contrato ${item.consecutivo}`} value={part} onChange={event => move(item.consecutivo, event.target.value as 'habilitante' | 'ponderable' | 'fuera')}>
          <option value="habilitante">Habilitante</option><option value="ponderable">Ponderable</option><option value="fuera">Quitar</option></select>}</div>
      <div className="tw-ally-tags">
        <span className={`tw-ally-tag${item.certificado_ok ? ' is-good' : ' is-alert'}`}>{CERT[item.certificado] || item.certificado}</span>
        {!item.cumple_codigos && <span className="tw-ally-tag is-alert">No tiene los códigos que pide el pliego</span>}
        {item.codigos_que_cumple.length > 0 && <span className="tw-ally-tag is-neutral">Códigos: {item.codigos_que_cumple.join(', ')}</span>}
      </div>
    </li>)}</ul>}
  </div>;
  const chosen = new Set(current ? [...current.habilitante, ...current.ponderable] : []);
  // Lo que se ve sigue a la selección en curso; los contratos agregados a mano traen sólo su certificado (los códigos se
  // revisan al guardar).
  const known = new Map(plan ? [...plan.habilitante, ...plan.ponderable].map(item => [item.consecutivo, item]) : []);
  const lookup = (consecutivo: string): Item => known.get(consecutivo) || (() => {
    const base = plan?.contratos.find(item => item.consecutivo === consecutivo);
    return { consecutivo, cliente: base?.cliente || '', valor_smmlv: base?.valor_smmlv || 0, certificado: base?.certificado || 'falta', certificado_ok: base?.certificado === 'completo' || base?.certificado === 'recibido', cumple_codigos: true, codigos_que_cumple: [] };
  })();
  const shownHab = current ? current.habilitante.map(lookup) : [];
  const shownPon = current ? current.ponderable.map(lookup) : [];
  const shownSum = Math.round(shownHab.reduce((sum, item) => sum + item.valor_smmlv, 0) * 100) / 100;
  const meets = plan?.minimo_smmlv != null ? shownSum >= plan.minimo_smmlv : null;
  return <section className="tw-card tw-xp">
    <small>Experiencia para esta oferta</small>
    {message && <p className="tw-muted" role="status">{message}</p>}
    {!plan ? <p>Vig-IA lee lo que pide el pliego de experiencia y propone qué contratos del RUP usar. {canEdit && <button type="button" disabled={busy} onClick={() => void propose()}>Proponer con Vig-IA</button>}</p> : <>
      <div className="tw-xp-req">
        <p><b>Lo que pide el pliego:</b> {[plan.requisito.minimo_smmlv !== null ? `mínimo ${number(plan.requisito.minimo_smmlv)} SMMLV` : null, plan.requisito.maximo_contratos ? `hasta ${plan.requisito.maximo_contratos} contratos` : null, plan.requisito.codigos.length ? `códigos ${plan.requisito.codigos.join(', ')} (${plan.requisito.codigos_regla === 'todos' ? 'todos' : plan.requisito.codigos_regla === 'alguno' ? 'alguno' : 'el pliego no dice si todos o alguno'})` : null].filter(Boolean).join(' · ') || 'no quedó claro; ver dudas'}.</p>
        {plan.requisito.objeto && <p><b>Objeto:</b> {plan.requisito.objeto}</p>}
        {plan.requisito.ponderable_criterio && <p><b>Lo que da puntaje:</b> {plan.requisito.ponderable_criterio}</p>}
        {(plan.requisito.cita || plan.requisito.ponderable_cita) && <details><summary>Lo que dice el pliego</summary>{plan.requisito.cita && <blockquote>«{plan.requisito.cita}»</blockquote>}{plan.requisito.ponderable_cita && <blockquote>«{plan.requisito.ponderable_cita}»</blockquote>}</details>}
      </div>
      <p className={meets === false ? 'tw-reanalysis-warn' : ''}><b>Habilitante:</b> {number(shownSum)} SMMLV{plan.minimo_smmlv !== null ? ` de ${number(plan.minimo_smmlv)} — ${meets ? 'cumple' : 'NO cumple'}` : ''}{plan.ajustada_por_persona ? ' · selección ajustada por una persona' : ' · propuesta de Vig-IA'}</p>
      <div className="tw-xp-parts">{list('Habilitante', shownHab, 'habilitante')}{list('Ponderable', shownPon, 'ponderable')}</div>
      {canEdit && <div className="row-actions">
        <select aria-label="Agregar un contrato" value="" onChange={event => { if (event.target.value) move(event.target.value, 'habilitante'); }}>
          <option value="">Agregar un contrato a la habilitante…</option>
          {plan.contratos.filter(item => !chosen.has(item.consecutivo)).map(item => <option key={item.consecutivo} value={item.consecutivo}>{item.consecutivo} · {item.cliente} · {number(item.valor_smmlv)} SMMLV</option>)}
        </select>
        {draft && <button type="button" disabled={busy} onClick={() => void save()}>Guardar selección</button>}
        <button type="button" className="secondary" disabled={busy} onClick={() => void propose()}>Volver a proponer</button>
      </div>}
      {draft && <p className="tw-muted">Hay cambios sin guardar. Los códigos y los avisos se revisan al guardar.</p>}
      {plan.faltan_certificados.length > 0 && <p className="tw-reanalysis-warn">Falta certificado completo de: {plan.faltan_certificados.map(item => `${item.consecutivo} (${item.cliente})`).join(', ')}. Pídalos y súbalos en Empresa → Experiencia.</p>}
      {plan.avisos.map(aviso => <p key={aviso} className="tw-reanalysis-warn">{aviso}</p>)}
      {plan.explicacion && <details><summary>Por qué Vig-IA propone esto</summary><p>{plan.explicacion}</p>{plan.dudas.length > 0 && <ul>{plan.dudas.map(duda => <li key={duda}>{duda}</li>)}</ul>}</details>}
    </>}
  </section>;
}
