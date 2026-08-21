import type { TenderGoNoGoDecision } from '../types';

export type TenderGoNoGoDecisionSummaryProps = {
  loading: boolean;
  current: TenderGoNoGoDecision | null;
};

const date = (value?: string | null) => value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Sin fecha';
const decisionLabel = (value?: string | null) => value === 'go' ? 'GO registrado' : value === 'no_go' ? 'NO GO registrado' : 'Pendiente de decisión';

export function TenderGoNoGoDecisionSummary({ loading, current }: TenderGoNoGoDecisionSummaryProps) {
  return <article className="tender-go-no-go-current tender-go-no-go-decision-summary">
    <small>Decisión humana vigente</small>
    <strong>{loading ? 'Cargando…' : decisionLabel(current?.decision)}</strong>
    {loading ? null : current ? <><p>{current.justification || 'Sin comentario humano.'}</p><span>{current.psi_sales_profiles?.full_name || current.decided_by} · {date(current.decided_at)}</span></> : <span>Sin decisión humana registrada</span>}
  </article>;
}
