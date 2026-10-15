import { useCallback, useEffect, useState } from 'react';
import { api } from '../apiClient';
import { FollowupCell } from './SiioFollowups';
import { addDays, openFollowupFor, type FollowupDraft, type FollowupList } from './followups';

// AGT-001 Vig-IA Gerencia: recomendaciones escritas por la IA (cada lunes y con el botón, máximo 3 veces al día).
// La IA sólo propone; cada recomendación muestra fecha, fuentes, útil/no útil y "Crear seguimiento".

export type RecommendationArea = 'finanzas' | 'comercial' | 'licitaciones' | 'operaciones' | 'transversal';
export type Recommendation = {
  id: string;
  position: number;
  area: RecommendationArea;
  priority: 'alta' | 'media' | 'baja';
  title: string;
  recommendation: string;
  rationale: string;
  sources: string[];
  suggested_owner: string;
  due_in_days: number;
  feedback: 'util' | 'no_util' | null;
};
export type RecommendationsState = {
  run: { id: string; trigger: 'boton' | 'semanal'; finished_at: string | null; requested_at: string; summary: string | null; missing_data: string[]; sources_as_of: Record<string, string | null> } | null;
  recommendations: Recommendation[];
  in_progress: boolean;
  button: { used_today: number; limit: number; remaining_today: number };
  last_failure: { at: string; code: string | null } | null;
};

export const AREA_LABELS: Record<RecommendationArea, string> = {
  finanzas: 'Finanzas',
  comercial: 'Comercial privado',
  licitaciones: 'Licitaciones públicas',
  operaciones: 'Operaciones',
  transversal: 'Toda la empresa',
};
const SOURCE_LABELS: Record<string, string> = {
  finanzas: 'Estado de resultados',
  pulso_mensual: 'Pulso del mes',
  comercial: 'CRM comercial',
  licitaciones: 'Licitaciones',
  operaciones: 'SecurityOps',
  seguimientos: 'Seguimiento gerencial',
};
const PRIORITY_ORDER = { alta: 0, media: 1, baja: 2 } as const;

function generatedLabel(run: NonNullable<RecommendationsState['run']>) {
  const at = new Date(run.finished_at || run.requested_at);
  const when = at.toLocaleString('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
  return `${run.trigger === 'semanal' ? 'Corrida del lunes' : 'Generadas con el botón'} · ${when}`;
}

export function recommendationOriginRef(item: Pick<Recommendation, 'id'>) {
  return `ia:${item.id}`;
}

export function SiioRecommendations({ canGenerate, followups, today, onCreateFollowup }: {
  canGenerate: boolean;
  followups: FollowupList | null;
  today: string;
  onCreateFollowup: (draft: FollowupDraft) => void;
}) {
  const [state, setState] = useState<RecommendationsState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(() => {
    api<RecommendationsState>('/api/siio/recommendations')
      .then(result => { setState(result); setLoadError(false); })
      .catch(() => setLoadError(true));
  }, []);
  useEffect(load, [load]);

  const generate = async () => {
    setBusy(true);
    setMessage('');
    try {
      setState(await api<RecommendationsState>('/api/siio/recommendations/generate', { method: 'POST' }));
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Vig-IA no pudo generar las recomendaciones.');
      load();
    } finally {
      setBusy(false);
    }
  };

  const giveFeedback = async (item: Recommendation, feedback: 'util' | 'no_util') => {
    const next = item.feedback === feedback ? null : feedback;
    setState(current => current && { ...current, recommendations: current.recommendations.map(entry => entry.id === item.id ? { ...entry, feedback: next } : entry) });
    try {
      await api(`/api/siio/recommendations/${item.id}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feedback: next }) });
    } catch {
      load();
    }
  };

  const remaining = state?.button.remaining_today ?? 0;
  const items = [...(state?.recommendations || [])].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.position - b.position);

  return <section className="panel siio-recommendations" aria-labelledby="siio-recommendations-title">
    <header className="siio-recommendations-head">
      <div>
        <span className="siio-eyebrow">Vig-IA Gerencia</span>
        <h2 id="siio-recommendations-title">Recomendaciones de la semana</h2>
        <p className="siio-secondary">{state?.run ? generatedLabel(state.run) : 'Se generan cada lunes a las 6:30 a. m. y cuando alguien presiona el botón.'}</p>
      </div>
      {canGenerate ? <div className="siio-recommendations-action">
        <button type="button" onClick={() => void generate()} disabled={busy || state?.in_progress || remaining === 0}>
          {busy || state?.in_progress ? 'Vig-IA está analizando… (hasta 2 minutos)' : 'Generar recomendaciones'}
        </button>
        <small>{remaining === 0 ? 'Ya se generaron 3 veces hoy. Vuelva mañana.' : `Quedan ${remaining} de ${state?.button.limit ?? 3} por hoy`}</small>
      </div> : null}
    </header>

    {message ? <p className="siio-followup-error" role="alert">{message}</p> : null}
    {loadError ? <p className="siio-secondary">No se pudieron cargar las recomendaciones.</p> : null}
    {state && !state.run && !loadError ? <p className="siio-secondary">Todavía no hay recomendaciones. {canGenerate ? 'Presione "Generar recomendaciones" para la primera.' : ''}</p> : null}

    {state?.run?.summary ? <p className="siio-recommendations-summary">{state.run.summary}</p> : null}

    {items.length ? <ol className="siio-recommendation-list">{items.map(item => <li key={item.id} className={`siio-recommendation siio-recommendation-${item.priority}`}>
      <div className="siio-recommendation-tags">
        <span className="siio-recommendation-area">{AREA_LABELS[item.area]}</span>
        <span className="siio-recommendation-priority">Prioridad {item.priority}</span>
      </div>
      <strong>{item.title}</strong>
      <p>{item.recommendation}</p>
      <p className="siio-recommendation-why"><span>Por qué:</span> {item.rationale}</p>
      <small>Fuentes: {item.sources.map(source => SOURCE_LABELS[source] || source).join(' · ')} · Responsable sugerido: {item.suggested_owner}</small>
      <div className="siio-recommendation-actions">
        <span role="group" aria-label="¿Le sirvió esta recomendación?">
          <button type="button" className={`secondary${item.feedback === 'util' ? ' is-selected' : ''}`} aria-pressed={item.feedback === 'util'} onClick={() => void giveFeedback(item, 'util')}>Útil</button>
          <button type="button" className={`secondary${item.feedback === 'no_util' ? ' is-selected' : ''}`} aria-pressed={item.feedback === 'no_util'} onClick={() => void giveFeedback(item, 'no_util')}>No útil</button>
        </span>
        {followups?.permissions.view ? <FollowupCell
          existing={openFollowupFor(followups, recommendationOriginRef(item))}
          today={today}
          canCreate={Boolean(followups.permissions.create)}
          onCreate={() => onCreateFollowup({ title: item.title, owner_label: item.suggested_owner, due_date: addDays(today, item.due_in_days), origin_type: 'recomendacion_ia', origin_ref: recommendationOriginRef(item), origin_label: `Recomendación de Vig-IA: ${item.title}`.slice(0, 300) })}
        /> : null}
      </div>
    </li>)}</ol> : null}

    {state?.run?.missing_data?.length ? <div className="siio-recommendations-missing">
      <h4>Lo que Vig-IA no pudo evaluar</h4>
      <ul>{state.run.missing_data.map(entry => <li key={entry}>{entry}</li>)}</ul>
    </div> : null}
    {state?.run ? <p className="siio-pulse-footnote">Las escribe la IA con las cifras publicadas en la Torre (sin nombres de personas). Son propuestas: una persona decide si se vuelven un seguimiento.</p> : null}
  </section>;
}
