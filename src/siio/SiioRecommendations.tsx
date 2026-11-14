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

  // Vig-IA (contrato de la maqueta, Fase 3): cabecera con la fecha y el botón; cada recomendación con la ficha de su
  // prioridad, la acción, el porqué y sus fuentes; al final, lo que no pudo evaluar.
  return <>
    <div className="siio-sub">
      <div>
        <h2 className="siio-titulo-pantalla">Recomendaciones de la semana</h2>
        <p className="siio-nota">{state?.run ? generatedLabel(state.run) : 'Se generan cada lunes a las 6:30 a. m. y cuando alguien presiona el botón.'}</p>
      </div>
      {canGenerate ? <div className="siio-reco-accion">
        <button type="button" className="siio-boton-primario" onClick={() => void generate()} disabled={busy || state?.in_progress || remaining === 0}>
          {busy || state?.in_progress ? 'Vig-IA está analizando… (hasta 2 minutos)' : 'Generar recomendaciones'}
        </button>
        <p className="siio-nota">{remaining === 0 ? 'Ya se generaron 3 veces hoy. Vuelva mañana.' : `Quedan ${remaining} de ${state?.button.limit ?? 3} por hoy`}</p>
      </div> : null}
    </div>

    {message ? <p className="siio-alert-text" role="alert">{message}</p> : null}
    {loadError ? <p className="siio-nota">No se pudieron cargar las recomendaciones.</p> : null}
    {state && !state.run && !loadError ? <p className="siio-nota">Todavía no hay recomendaciones. {canGenerate ? 'Presione «Generar recomendaciones» para la primera.' : ''}</p> : null}
    {state?.run?.summary ? <p className="siio-reco-resumen">{state.run.summary}</p> : null}

    {items.map(item => <article key={item.id} className="siio-panel siio-reco" aria-label={item.title}>
      <header>
        <span className={`siio-plazo ${item.priority === 'baja' ? '' : item.priority}`}><strong>{item.priority === 'alta' ? 'Alta' : item.priority === 'media' ? 'Media' : 'Baja'}</strong><small>{AREA_LABELS[item.area]}</small></span>
        <h3>{item.title}</h3>
      </header>
      <p>{item.recommendation}</p>
      <p className="siio-reco-porque"><strong>Por qué:</strong> {item.rationale}</p>
      <footer>
        <span role="group" aria-label="¿Le sirvió esta recomendación?">
          <button type="button" className={`siio-enlace${item.feedback === 'util' ? ' activo' : ''}`} aria-pressed={item.feedback === 'util'} onClick={() => void giveFeedback(item, 'util')}>Útil</button>
          <button type="button" className={`siio-enlace${item.feedback === 'no_util' ? ' activo' : ''}`} aria-pressed={item.feedback === 'no_util'} onClick={() => void giveFeedback(item, 'no_util')}>No útil</button>
        </span>
        {followups?.permissions.view ? <FollowupCell
          existing={openFollowupFor(followups, recommendationOriginRef(item))}
          today={today}
          canCreate={Boolean(followups.permissions.create)}
          onCreate={() => onCreateFollowup({ title: item.title, owner_label: item.suggested_owner, due_date: addDays(today, item.due_in_days), origin_type: 'recomendacion_ia', origin_ref: recommendationOriginRef(item), origin_label: `Recomendación de Vig-IA: ${item.title}`.slice(0, 300) })}
        /> : null}
        <span className="siio-nota">Fuentes: {item.sources.map(source => SOURCE_LABELS[source] || source).join(' · ')} · Responsable sugerido: <strong>{item.suggested_owner}</strong></span>
      </footer>
    </article>)}

    {state?.run?.missing_data?.length ? <section className="siio-panel" aria-label="Lo que Vig-IA no pudo evaluar">
      <h2>Lo que Vig-IA no pudo evaluar (y quién lo destraba)</h2>
      <ul className="siio-lista">{state.run.missing_data.map(entry => <li key={entry}>{entry}</li>)}</ul>
    </section> : null}
    {state?.run ? <p className="siio-nota">Las escribe la IA con las cifras publicadas en la Torre (sin nombres de personas). Son propuestas: una persona decide si se vuelven un seguimiento.</p> : null}
  </>;
}
