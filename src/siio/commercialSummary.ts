export type CommercialTender = {
  id: string;
  entity: string;
  total_value: number;
  deadline_at: string | null;
  days_to_deadline: number | null;
  decision: 'go' | 'no_go' | null;
  offer_status: string | null;
  attention: 'requiere_decision' | 'cierre_vencido_sin_actualizar' | null;
};

export type CommercialSummary = {
  as_of: string;
  sales: { year: number; closed_months: number; ytd_monthly_value: number; ytd_goal: number; ytd_attainment: number | null; year_goal: number; year_monthly_value: number; by_month: Array<{ month: string; approved_monthly_value: number; goal: number }> };
  pipeline: {
    open_count: number; monthly_value: number; weighted_monthly_value: number; remaining_goal: number; coverage_of_remaining_goal: number | null;
    stale_count: number; without_value_count: number; stale_days: number;
    by_stage: Array<{ code: string; name: string; probability: number; count: number; monthly_value: number; weighted_monthly_value: number; stale: number; without_value: number }>;
    stale_large: Array<{ id: string; company_name: string; stage: string; monthly_value: number; days_without_activity: number; owner_name: string | null }>;
  };
  tenders: { open_count: number; total_value: number; requires_decision: number; overdue_status: number; decision_window_days: number; award_rate: number | null; awarded: number; not_awarded: number; calendar: CommercialTender[] };
  data_quality: { approved_without_date: number; open_without_value: number; open_stale: number; open_total: number };
};

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const money = (value: number) => `$${Math.round(value / 1e6).toLocaleString('es-CO')} millones`;
const pct = (value: number) => `${Math.round(value * 100)}%`;

export function closingDateLabel(value: string | null) {
  if (!value) return 'sin fecha';
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', timeZone: 'America/Bogota' }).format(new Date(value));
}

// Deterministic reading for the commercial block: every sentence states its own figures.
export function commercialReadings(summary: CommercialSummary): string[] {
  const readings: string[] = [];
  const { sales, pipeline, tenders } = summary;
  if (sales.closed_months && sales.ytd_attainment !== null) {
    const lastMonth = MONTHS[sales.closed_months - 1];
    readings.push(`Ventas nuevas aprobadas de enero a ${lastMonth}: ${money(sales.ytd_monthly_value)} mensuales, ${pct(sales.ytd_attainment)} de la meta del periodo (${money(sales.ytd_goal)}).`);
  }
  if (pipeline.coverage_of_remaining_goal !== null) {
    readings.push(`El pipeline ponderado (${money(pipeline.weighted_monthly_value)} mensuales) cubre ${pipeline.coverage_of_remaining_goal.toLocaleString('es-CO', { maximumFractionDigits: 1 })} veces lo que falta para la meta del año (${money(pipeline.remaining_goal)}).`);
  }
  const urgent = tenders.calendar.filter(item => item.attention === 'requiere_decision');
  if (urgent.length) {
    const first = urgent[0];
    readings.push(`${urgent.length} ${urgent.length === 1 ? 'licitación cierra' : 'licitaciones cierran'} en los próximos ${tenders.decision_window_days} días sin decisión de presentarse; la primera es ${first.entity} (${money(first.total_value)}) el ${closingDateLabel(first.deadline_at)}.`);
  }
  const overdue = tenders.calendar.filter(item => item.attention === 'cierre_vencido_sin_actualizar');
  if (overdue.length) readings.push(`${overdue.map(item => item.entity).join(', ')}: la fecha de cierre ya pasó y el estado no se ha actualizado.`);
  const advanced = pipeline.by_stage.filter(stage => stage.code !== 'prospecto');
  const advancedStale = advanced.reduce((total, stage) => total + stage.stale, 0);
  const advancedTotal = advanced.reduce((total, stage) => total + stage.count, 0);
  if (advancedStale) readings.push(`${advancedStale} de ${advancedTotal} oportunidades con oferta enviada o más avanzadas llevan más de ${pipeline.stale_days} días sin actividad.`);
  return readings;
}

// Public tenders and private sales are different businesses (total contract value vs monthly
// service value), so their readings are shown apart.
export function tenderReadings(summary: CommercialSummary): string[] {
  return commercialReadings(summary).filter(text => /licitaci|fecha de cierre/i.test(text));
}

export function privateReadings(summary: CommercialSummary): string[] {
  return commercialReadings(summary).filter(text => !/licitaci|fecha de cierre/i.test(text));
}

// Orange marks only what is truly urgent: overdue status or a close within a week.
export const URGENT_DAYS = 7;
export function isUrgentTender(item: CommercialTender) {
  return item.attention === 'cierre_vencido_sin_actualizar' || (item.attention === 'requiere_decision' && item.days_to_deadline !== null && item.days_to_deadline <= URGENT_DAYS);
}
