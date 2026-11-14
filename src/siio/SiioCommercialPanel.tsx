import { EmptyState } from './SiioUi';
import { closingDateLabel, type CommercialSummary, type CommercialTender } from './commercialSummary';
import { addDays, type FollowupDraft, type FollowupList } from './followups';

// Follow-up hooks for the attention rows; absent when the viewer has no follow-up access.
export type AttentionFollowups = { list: FollowupList | null; onCreate: (draft: FollowupDraft) => void };

export function tenderFollowupDraft(item: CommercialTender, today: string): FollowupDraft {
  if (item.attention === 'cierre_vencido_sin_actualizar') {
    return { title: `Actualizar en el CRM el estado de la licitación ${item.entity}`, owner_label: 'Licitaciones', due_date: addDays(today, 2), origin_type: 'licitacion', origin_ref: item.id, origin_label: item.entity, auto_rule: 'tender_status' };
  }
  const deadline = item.deadline_at ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(item.deadline_at)) : null;
  const due = deadline && addDays(deadline, -1) > today ? addDays(deadline, -1) : today;
  return { title: `Decidir si nos presentamos a ${item.entity}`, owner_label: 'Licitaciones', due_date: due, origin_type: 'licitacion', origin_ref: item.id, origin_label: item.entity, auto_rule: 'tender_decision' };
}

export const millions = (value: number) => `${value < 0 ? '−' : ''}$${Math.abs(Math.round(value / 1e6)).toLocaleString('es-CO')} M`;
const percent = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)} %`;

function LoadState({ state, summary }: { state: 'loading' | 'ready' | 'error'; summary: CommercialSummary | null }) {
  if (state === 'loading') return <p className="siio-secondary">Cargando datos del CRM…</p>;
  if (state === 'error' || !summary) return <EmptyState title="No se pudieron cargar los datos del CRM" text="El resto de la Torre sigue disponible." />;
  return null;
}

// Pipeline de privados por etapa (valor mensual del servicio) y la calidad del dato del CRM; va plegado en Comercial.
export function SiioPrivateDetail({ summary, state }: { summary: CommercialSummary | null; state: 'loading' | 'ready' | 'error' }) {
  if (!summary || state !== 'ready') return <LoadState state={state} summary={summary} />;
  const { pipeline, data_quality: quality } = summary;
  return <div>
    <div className="siio-tabla-wrap"><table className="siio-tabla">
      <thead><tr><th>Etapa</th><th className="num">Oportunidades</th><th className="num">Valor al mes</th><th className="num">Probabilidad</th><th className="num">Ponderado</th><th className="num">Sin gestión &gt;{pipeline.stale_days} días</th></tr></thead>
      <tbody>{pipeline.by_stage.map(stage => <tr key={stage.code}>
        <td><span className="nombre">{stage.name}</span></td>
        <td className="num"><strong>{stage.count}</strong></td>
        <td className="num"><strong>{millions(stage.monthly_value)}</strong></td>
        <td className="num">{percent(stage.probability)}</td>
        <td className="num"><strong>{millions(stage.weighted_monthly_value)}</strong></td>
        <td className={`num${stage.stale ? ' mal' : ''}`}><strong>{stage.stale}</strong></td>
      </tr>)}</tbody>
    </table></div>
    <p className="siio-nota" style={{ marginTop: 6 }}>CRM al {closingDateLabel(`${summary.as_of}T12:00:00Z`)} · ventas a clientes privados, sin licitaciones. Calidad del dato: {quality.open_without_value} de {quality.open_total} oportunidades abiertas sin valor; {quality.approved_without_date} ventas aprobadas sin fecha de aprobación (por eso las ventas se cuentan por mes de cotización).</p>
  </div>;
}
