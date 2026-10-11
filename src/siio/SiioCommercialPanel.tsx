import { useEffect, useState } from 'react';
import { api } from '../apiClient';
import { EmptyState, Panel } from './SiioUi';
import { closingDateLabel, commercialReadings, type CommercialSummary } from './commercialSummary';

const millions = (value: number) => `${value < 0 ? '−' : ''}$${Math.abs(Math.round(value / 1e6)).toLocaleString('es-CO')} M`;
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

export function SiioCommercialPanel({ financialPeriodLabel }: { financialPeriodLabel: string }) {
  const [summary, setSummary] = useState<CommercialSummary | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    api<CommercialSummary>('/api/siio/commercial-summary')
      .then(result => { if (active) { setSummary(result); setState('ready'); } })
      .catch(() => { if (active) setState('error'); });
    return () => { active = false; };
  }, []);

  if (state === 'loading') return <Panel title="Comercial y Licitaciones"><p className="siio-secondary">Cargando datos del CRM…</p></Panel>;
  if (state === 'error' || !summary) return <Panel title="Comercial y Licitaciones"><EmptyState title="No se pudo cargar Comercial y Licitaciones" text="El resto de la Torre sigue disponible." /></Panel>;

  const { sales, pipeline, tenders, data_quality: quality } = summary;
  const readings = commercialReadings(summary);
  const attention = tenders.calendar.filter(item => item.attention);
  const attainment = sales.ytd_attainment;

  return <Panel title="Comercial y Licitaciones">
    <p className="siio-pulse-source">CRM al {closingDateLabel(`${summary.as_of}T12:00:00Z`)} {summary.as_of.slice(0, 4)} · valores comerciales mensuales; licitaciones por valor total del proceso. Las cifras financieras de arriba van a {financialPeriodLabel}.</p>

    <div className="siio-pulse-cards">
      <div className="siio-pulse-card">
        <small>Ventas nuevas {sales.closed_months ? `ene–${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][sales.closed_months - 1]}` : sales.year}</small>
        <strong>{millions(sales.ytd_monthly_value)}</strong>
        <span>Meta: {millions(sales.ytd_goal)} · {percent(attainment)}</span>
        {attainment !== null ? <div className="siio-goal-bar" role="img" aria-label={`${percent(attainment)} de la meta`}><i style={{ width: `${Math.min(100, attainment * 100)}%` }} className={attainment < 0.9 ? 'below' : undefined} /></div> : null}
      </div>
      <div className="siio-pulse-card">
        <small>Pipeline ponderado</small>
        <strong>{millions(pipeline.weighted_monthly_value)}</strong>
        <span>de {millions(pipeline.monthly_value)} abiertos en {pipeline.open_count} oportunidades</span>
      </div>
      <div className="siio-pulse-card">
        <small>Cobertura de la meta restante</small>
        <strong>{pipeline.coverage_of_remaining_goal === null ? '—' : `${pipeline.coverage_of_remaining_goal.toLocaleString('es-CO', { maximumFractionDigits: 1 })}×`}</strong>
        <span>Falta {millions(pipeline.remaining_goal)} para la meta del año</span>
      </div>
      <div className="siio-pulse-card">
        <small>Licitaciones abiertas</small>
        <strong>{tenders.open_count}</strong>
        <span>{millions(tenders.total_value)} en juego (valor total)</span>
      </div>
      <div className={`siio-pulse-card${tenders.requires_decision + tenders.overdue_status ? ' siio-card-alert' : ''}`}>
        <small>Requieren decisión</small>
        <strong>{tenders.requires_decision + tenders.overdue_status}</strong>
        <span>{tenders.requires_decision} sin decisión a {tenders.decision_window_days} días · {tenders.overdue_status} con cierre vencido</span>
      </div>
    </div>

    {readings.length ? <div className="siio-pulse-readings"><h4>Lectura</h4><ul>{readings.map(reading => <li key={reading}>{reading}</li>)}</ul></div> : null}

    <div className="siio-pulse-block">
      <h4>Requiere decisión</h4>
      {attention.length || pipeline.stale_large.length ? <div className="siio-table-wrap"><table className="siio-pulse-table siio-commercial-table">
        <thead><tr><th>Asunto</th><th>Valor</th><th>Fecha / días</th><th>Situación</th></tr></thead>
        <tbody>
          {attention.map(item => <tr key={item.id} className="siio-pulse-highlight">
            <th scope="row">Licitación · {item.entity}</th>
            <td>{millions(item.total_value)} total</td>
            <td>Cierra {closingDateLabel(item.deadline_at)}{item.days_to_deadline !== null ? ` (${item.days_to_deadline < 0 ? `hace ${-item.days_to_deadline}` : `en ${item.days_to_deadline}`} días)` : ''}</td>
            <td>{item.attention === 'requiere_decision' ? 'Sin decisión de presentarse' : 'Cierre vencido, estado sin actualizar'}</td>
          </tr>)}
          {pipeline.stale_large.map(item => <tr key={item.id}>
            <th scope="row">Oportunidad · {item.company_name}</th>
            <td>{millions(item.monthly_value)} / mes</td>
            <td>{item.days_without_activity} días sin actividad</td>
            <td>{item.stage}{item.owner_name ? ` · ${item.owner_name}` : ''}</td>
          </tr>)}
        </tbody>
      </table></div> : <p className="siio-secondary">Nada pendiente de decisión.</p>}
    </div>

    <div className="siio-pulse-block">
      <h4>Calendario de licitaciones</h4>
      {tenders.calendar.length ? <div className="siio-table-wrap"><table className="siio-pulse-table siio-commercial-table">
        <thead><tr><th>Entidad</th><th>Valor total</th><th>Cierre</th><th>Decisión</th><th>Estado</th></tr></thead>
        <tbody>{tenders.calendar.map(item => <tr key={item.id}>
          <th scope="row">{item.entity}</th>
          <td>{millions(item.total_value)}</td>
          <td>{closingDateLabel(item.deadline_at)}</td>
          <td>{item.decision === 'go' ? 'Presentarse' : 'Pendiente'}</td>
          <td>{OFFER_STATUS[item.offer_status || ''] || '—'}</td>
        </tr>)}</tbody>
      </table></div> : <p className="siio-secondary">No hay licitaciones activas.</p>}
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
      </div>
    </div>

    <p className="siio-pulse-note">Calidad del dato: {quality.open_without_value} de {quality.open_total} oportunidades abiertas sin valor; {quality.open_stale} sin actividad en más de {pipeline.stale_days} días; {quality.approved_without_date} ventas aprobadas sin fecha de aprobación (por eso las ventas se cuentan por mes de cotización).</p>
  </Panel>;
}
