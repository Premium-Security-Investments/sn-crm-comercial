import { EmptyState } from './SiioUi';
import { closingDateLabel, isUrgentTender, type CommercialSummary, type CommercialTender } from './commercialSummary';
import { FollowupCell } from './SiioFollowups';
import { addDays, openFollowupFor, type FollowupDraft, type FollowupList } from './followups';

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
const percent = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}%`;

const OFFER_STATUS: Record<string, string> = {
  pendiente_decision: 'Pendiente de decisión',
  en_preparacion: 'En preparación',
  lista_para_presentar: 'Lista para presentar',
  presentada: 'Presentada',
};

function LoadState({ state, summary }: { state: 'loading' | 'ready' | 'error'; summary: CommercialSummary | null }) {
  if (state === 'loading') return <p className="siio-secondary">Cargando datos del CRM…</p>;
  if (state === 'error' || !summary) return <EmptyState title="No se pudieron cargar los datos del CRM" text="El resto de la Torre sigue disponible." />;
  return null;
}

// Public tenders that need a go/no-go decision or a status update; total contract value.
export function TenderAttentionTable({ summary, followups, today }: { summary: CommercialSummary; followups?: AttentionFollowups; today: string }) {
  const attention = summary.tenders.calendar.filter(item => item.attention);
  if (!attention.length) return <p className="siio-secondary">Ninguna licitación pendiente de decisión.</p>;
  return <div className="siio-table-wrap"><table className="siio-pulse-table siio-commercial-table">
    <thead><tr><th>Entidad</th><th>Valor total</th><th>Cierre</th><th>Situación</th>{followups ? <th>Seguimiento</th> : null}</tr></thead>
    <tbody>{attention.map(item => {
      const urgent = isUrgentTender(item);
      return <tr key={item.id} className={item.attention === 'cierre_vencido_sin_actualizar' ? 'siio-row-alert' : undefined}>
        <th scope="row">{item.entity}</th>
        <td>{millions(item.total_value)}</td>
        <td>{closingDateLabel(item.deadline_at)}{item.days_to_deadline !== null ? ` (${item.days_to_deadline < 0 ? `hace ${-item.days_to_deadline}` : `en ${item.days_to_deadline}`} días)` : ''}</td>
        <td><span className={urgent ? 'siio-alert-text' : undefined}>{item.attention === 'requiere_decision' ? 'Sin decisión de presentarse' : 'Cierre vencido, estado sin actualizar'}</span></td>
        {followups ? <td><FollowupCell existing={openFollowupFor(followups.list, item.id)} today={today} canCreate={Boolean(followups.list?.permissions.create)} onCreate={() => followups.onCreate(tenderFollowupDraft(item, today))} /></td> : null}
      </tr>;
    })}</tbody>
  </table></div>;
}

// Large private opportunities without recent activity; monthly service value.
export function PrivateAttentionTable({ summary, followups, today }: { summary: CommercialSummary; followups?: AttentionFollowups; today: string }) {
  const stale = summary.pipeline.stale_large;
  if (!stale.length) return <p className="siio-secondary">Ninguna oportunidad grande quieta.</p>;
  return <div className="siio-table-wrap"><table className="siio-pulse-table siio-commercial-table">
    <thead><tr><th>Cliente</th><th>Valor mensual</th><th>Sin actividad</th><th>Etapa · comercial</th>{followups ? <th>Seguimiento</th> : null}</tr></thead>
    <tbody>{stale.map(item => <tr key={item.id}>
      <th scope="row">{item.company_name}</th>
      <td>{millions(item.monthly_value)} / mes</td>
      <td>{item.days_without_activity} días</td>
      <td>{item.stage}{item.owner_name ? ` · ${item.owner_name}` : ''}</td>
      {followups ? <td><FollowupCell existing={openFollowupFor(followups.list, item.id)} today={today} canCreate={Boolean(followups.list?.permissions.create)} onCreate={() => followups.onCreate({ title: `Retomar contacto con ${item.company_name}`, owner_label: item.owner_name || 'Comercial', due_date: addDays(today, 7), origin_type: 'oportunidad', origin_ref: item.id, origin_label: item.company_name, auto_rule: 'opportunity_activity' })} /></td> : null}
    </tr>)}</tbody>
  </table></div>;
}

export function SiioPrivateDetail({ summary, state }: { summary: CommercialSummary | null; state: 'loading' | 'ready' | 'error' }) {
  if (!summary || state !== 'ready') return <LoadState state={state} summary={summary} />;
  const { pipeline, data_quality: quality } = summary;
  return <div className="siio-detail-body">
    <p className="siio-pulse-source">CRM al {closingDateLabel(`${summary.as_of}T12:00:00Z`)} {summary.as_of.slice(0, 4)} · ventas a clientes privados, en valor mensual del servicio. No incluye licitaciones.</p>

    <div className="siio-pulse-block">
      <h4>Pipeline por etapa</h4>
      <div className="siio-table-wrap"><table className="siio-pulse-table">
        <thead><tr><th>Etapa</th><th>Oportunidades</th><th>Valor mensual</th><th>Probabilidad</th><th>Ponderado</th><th>Sin actividad &gt;{pipeline.stale_days} días</th></tr></thead>
        <tbody>{pipeline.by_stage.map(stage => <tr key={stage.code}>
          <th scope="row">{stage.name}</th>
          <td>{stage.count}</td>
          <td>{millions(stage.monthly_value)}</td>
          <td>{percent(stage.probability)}</td>
          <td>{millions(stage.weighted_monthly_value)}</td>
          <td>{stage.stale}</td>
        </tr>)}</tbody>
      </table></div>
    </div>


    <p className="siio-pulse-note">Calidad del dato: {quality.open_without_value} de {quality.open_total} oportunidades abiertas sin valor; {quality.open_stale} sin actividad en más de {pipeline.stale_days} días; {quality.approved_without_date} ventas aprobadas sin fecha de aprobación (por eso las ventas se cuentan por mes de cotización).</p>
  </div>;
}

export function SiioTenderDetail({ summary, state }: { summary: CommercialSummary | null; state: 'loading' | 'ready' | 'error' }) {
  if (!summary || state !== 'ready') return <LoadState state={state} summary={summary} />;
  const { tenders } = summary;
  const rest = tenders.calendar.filter(item => !item.attention);
  return <div className="siio-detail-body">
    <p className="siio-pulse-source">Licitaciones públicas activas, en valor total del proceso. Las descartadas no aparecen.</p>

    <div className="siio-pulse-block">
      <h4>Otras licitaciones activas</h4>
      <p className="siio-pulse-footnote">Las que cierran pronto o ya cerraron están arriba, en "Decisiones con fecha"; las demás que piden decisión, en "Requiere atención".</p>
      {rest.length ? <div className="siio-table-wrap"><table className="siio-pulse-table siio-commercial-table">
        <thead><tr><th>Entidad</th><th>Valor total</th><th>Cierre</th><th>Decisión</th><th>Estado</th></tr></thead>
        <tbody>{rest.map(item => <tr key={item.id}>
          <th scope="row">{item.entity}</th>
          <td>{millions(item.total_value)}</td>
          <td>{closingDateLabel(item.deadline_at)}</td>
          <td>{item.decision === 'go' ? 'Presentarse' : 'Pendiente'}</td>
          <td>{OFFER_STATUS[item.offer_status || ''] || '—'}</td>
        </tr>)}</tbody>
      </table></div> : <p className="siio-secondary">No hay otras licitaciones activas.</p>}
    </div>

  </div>;
}
