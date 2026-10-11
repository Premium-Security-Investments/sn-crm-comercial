import { EmptyState } from './SiioUi';
import { closingDateLabel, type CommercialSummary } from './commercialSummary';

export const millions = (value: number) => `${value < 0 ? '−' : ''}$${Math.abs(Math.round(value / 1e6)).toLocaleString('es-CO')} M`;
const percent = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}%`;

const OFFER_STATUS: Record<string, string> = {
  pendiente_decision: 'Pendiente de decisión',
  en_preparacion: 'En preparación',
  lista_para_presentar: 'Lista para presentar',
  presentada: 'Presentada',
};

function Pending({ title, need }: { title: string; need: string }) {
  return <div className="siio-commercial-pending"><strong>{title}</strong><span>Pendiente: {need}</span></div>;
}

// Rows for the "Requiere atención" table: tenders that need a decision or an update, then large stalled opportunities.
export function CommercialAttentionRows({ summary }: { summary: CommercialSummary }) {
  const attention = summary.tenders.calendar.filter(item => item.attention);
  return <>
    {attention.map(item => <tr key={item.id} className={item.attention === 'cierre_vencido_sin_actualizar' ? 'siio-row-alert' : undefined}>
      <th scope="row"><small>Licitación</small>{item.entity}</th>
      <td>{millions(item.total_value)} total</td>
      <td>Cierra {closingDateLabel(item.deadline_at)}{item.days_to_deadline !== null ? ` (${item.days_to_deadline < 0 ? `hace ${-item.days_to_deadline}` : `en ${item.days_to_deadline}`} días)` : ''}</td>
      <td><span className="siio-alert-text">{item.attention === 'requiere_decision' ? 'Sin decisión de presentarse' : 'Cierre vencido, estado sin actualizar'}</span></td>
    </tr>)}
    {summary.pipeline.stale_large.map(item => <tr key={item.id}>
      <th scope="row"><small>Oportunidad</small>{item.company_name}</th>
      <td>{millions(item.monthly_value)} / mes</td>
      <td>{item.days_without_activity} días sin actividad</td>
      <td>{item.stage}{item.owner_name ? ` · ${item.owner_name}` : ''}</td>
    </tr>)}
  </>;
}

// Detail of the commercial block; the headline figures and the attention rows live at the top of the Torre.
export function SiioCommercialDetail({ summary, state }: { summary: CommercialSummary | null; state: 'loading' | 'ready' | 'error' }) {
  if (state === 'loading') return <p className="siio-secondary">Cargando datos del CRM…</p>;
  if (state === 'error' || !summary) return <EmptyState title="No se pudo cargar Comercial y Licitaciones" text="El resto de la Torre sigue disponible." />;

  const { pipeline, tenders, data_quality: quality } = summary;
  const rest = tenders.calendar.filter(item => !item.attention);

  return <div className="siio-detail-body">
    <p className="siio-pulse-source">CRM al {closingDateLabel(`${summary.as_of}T12:00:00Z`)} {summary.as_of.slice(0, 4)} · valores comerciales mensuales; licitaciones por valor total del proceso.</p>

    <div className="siio-pulse-block">
      <h4>Otras licitaciones activas</h4>
      <p className="siio-pulse-footnote">Las que requieren decisión o actualización están arriba, en "Requiere atención".</p>
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

    <div className="siio-pulse-block">
      <h4>Pipeline comercial por etapa</h4>
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

    <div className="siio-pulse-block">
      <h4>En construcción</h4>
      <div className="siio-commercial-pending-grid">
        <Pending title="Puente de ingresos" need="ingreso mensual actualizado (Avancys o archivo mensual) y fecha de inicio del servicio de cada venta aprobada." />
        <Pending title="Tasa de adjudicación" need={tenders.awarded + tenders.not_awarded ? `${percent(tenders.award_rate)} (${tenders.awarded} de ${tenders.awarded + tenders.not_awarded})` : 'registrar en el CRM las licitaciones adjudicadas y no adjudicadas.'} />
        <Pending title="Concentración de clientes" need="ingresos por cliente desde Avancys." />
        <Pending title="Cierres que se corren" need="guardar el historial de fechas de cierre estimadas en el CRM." />
        <Pending title="Comparación con presupuesto" need="presupuesto mensual del año por rubro." />
        <Pending title="Cobertura necesaria" need="tasa de cierre histórica (ofertas ganadas sobre enviadas) para fijar cuántas veces debe cubrir el pipeline la meta." />
      </div>
    </div>

    <p className="siio-pulse-note">Calidad del dato: {quality.open_without_value} de {quality.open_total} oportunidades abiertas sin valor; {quality.open_stale} sin actividad en más de {pipeline.stale_days} días; {quality.approved_without_date} ventas aprobadas sin fecha de aprobación (por eso las ventas se cuentan por mes de cotización).</p>
  </div>;
}
