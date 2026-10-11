import type { ReactNode } from 'react';
import type { SiioFinancialMetric } from '../siioExecutive';
import { millions } from './SiioCommercialPanel';
import { closingDateLabel, type CommercialSummary } from './commercialSummary';
import { longMonth, pulseMonth, relativeChange, shortMonth, type FinancialPulse, type FinancialPulseTotals } from './financialPulse';

type LoadState = 'loading' | 'ready' | 'error';

const percentFormat = new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 1 });
const signedPercent = (value: number | null) => value === null ? null : `${value > 0 ? '+' : value < 0 ? '−' : ''}${percentFormat.format(Math.abs(value))}`;
const points = (current: number, previous: number) => {
  const difference = (current - previous) * 100;
  return `${difference >= 0 ? '+' : '−'}${Math.abs(difference).toLocaleString('es-CO', { maximumFractionDigits: 1 })} puntos`;
};

// Change against a reference, phrased so a loss never reads as a percentage over a negative base.
function versus(label: string, current: number | null | undefined, previous: number | null | undefined, kind: 'monto' | 'margen') {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  if (kind === 'margen') return `${label}: ${percentFormat.format(previous)} · ${points(current, previous)}`;
  if (current < 0 || previous < 0) return `${label}: ${millions(previous)} · ${current >= previous ? 'mejoró' : 'empeoró'} ${millions(Math.abs(current - previous))}`;
  return `${label}: ${millions(previous)} · ${signedPercent(relativeChange(current, previous))}`;
}

// Word-sized trend (Tufte): current year solid, prior year or goal in grey, no axis; it shows direction, not magnitude.
export function Sparkline({ current, reference, label }: { current: Array<number | null>; reference?: Array<number | null>; label: string }) {
  const values = [...current, ...(reference || [])].filter((value): value is number => value !== null && Number.isFinite(value));
  if (current.filter(value => value !== null).length < 2 || !values.length) return null;
  const width = 120;
  const height = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const steps = Math.max(current.length, reference?.length || 0) - 1 || 1;
  const path = (series: Array<number | null>) => series
    .map((value, index) => value === null ? null : `${(index / steps) * width},${height - 2 - ((value - min) / span) * (height - 4)}`)
    .filter(Boolean)
    .join(' ');
  const last = current.length - 1;
  const lastValue = current[last];
  return <svg className="siio-sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
    {min < 0 && max > 0 ? <line x1="0" x2={width} y1={height - 2 - ((0 - min) / span) * (height - 4)} y2={height - 2 - ((0 - min) / span) * (height - 4)} className="siio-sparkline-zero" /> : null}
    {reference ? <polyline points={path(reference)} className="siio-sparkline-reference" /> : null}
    <polyline points={path(current)} className="siio-sparkline-current" />
    {lastValue !== null ? <circle cx={(last / steps) * width} cy={height - 2 - ((lastValue - min) / span) * (height - 4)} r="2.5" className="siio-sparkline-dot" /> : null}
  </svg>;
}

function Figure({ label, value, detail, comparison, alert, children }: { label: string; value: string; detail?: string | null; comparison?: string | null; alert?: boolean; children?: ReactNode }) {
  return <div className={`siio-key-figure${alert ? ' siio-card-alert' : ''}`}>
    <small>{label}</small>
    <strong>{value}</strong>
    {children}
    {comparison ? <span>{comparison}</span> : null}
    {detail ? <span>{detail}</span> : null}
  </div>;
}

function monthSeries(pulse: FinancialPulse, year: number, key: keyof FinancialPulseTotals) {
  return Array.from({ length: pulse.month }, (_, index) => {
    const value = pulseMonth(pulse, year, index + 1)?.totals[key];
    return value === null || value === undefined ? null : Number(value);
  });
}

function FinancialFigures({ pulse, state, financialRows }: { pulse: FinancialPulse | null; state: LoadState; financialRows: SiioFinancialMetric[] }) {
  const current = pulse ? pulseMonth(pulse, pulse.year, pulse.month) : null;
  if (state === 'loading') return <p className="siio-secondary">Cargando cifras financieras…</p>;
  if (!pulse || !current) return <p className="siio-secondary">Sin corte contable publicado con saldos por cuenta.</p>;
  const lastYear = pulseMonth(pulse, pulse.year - 1, pulse.month);
  const reference = `${shortMonth(pulse.month)} ${pulse.year - 1}`;
  const month = shortMonth(pulse.month);
  const trendLabel = (name: string) => `Tendencia de ${name} de enero a ${longMonth(pulse.month)}: ${pulse.year} en línea oscura, ${pulse.year - 1} en gris`;
  const net = financialRows.find(row => row.concept === 'UTILIDAD NETA');
  const netCurrent = net?.value_current === null || net?.value_current === undefined ? null : Number(net.value_current);
  const netPrevious = net?.value_comparison === null || net?.value_comparison === undefined ? null : Number(net.value_comparison);
  const range = pulse.month === 1 ? 'ene' : `ene–${month}`;
  return <div className="siio-key-grid siio-key-grid-4">
    <Figure label={`Ingresos ${month}`} value={millions(current.totals.ingresos)} comparison={versus(reference, current.totals.ingresos, lastYear?.totals.ingresos, 'monto')}>
      <Sparkline current={monthSeries(pulse, pulse.year, 'ingresos')} reference={monthSeries(pulse, pulse.year - 1, 'ingresos')} label={trendLabel('ingresos')} />
    </Figure>
    <Figure label={`Utilidad operacional ${month}`} value={millions(current.totals.utilidad_operacional)} comparison={versus(reference, current.totals.utilidad_operacional, lastYear?.totals.utilidad_operacional, 'monto')}>
      <Sparkline current={monthSeries(pulse, pulse.year, 'utilidad_operacional')} reference={monthSeries(pulse, pulse.year - 1, 'utilidad_operacional')} label={trendLabel('la utilidad operacional')} />
    </Figure>
    <Figure label={`Margen operacional ${month}`} value={current.totals.margen_operacional === null ? '—' : percentFormat.format(current.totals.margen_operacional)} comparison={versus(reference, current.totals.margen_operacional, lastYear?.totals.margen_operacional, 'margen')}>
      <Sparkline current={monthSeries(pulse, pulse.year, 'margen_operacional')} reference={monthSeries(pulse, pulse.year - 1, 'margen_operacional')} label={trendLabel('el margen operacional')} />
    </Figure>
    <Figure label={`Utilidad neta ${range}`} value={netCurrent === null ? '—' : millions(netCurrent)} comparison={versus(`${range} ${pulse.year - 1}`, netCurrent, netPrevious, 'monto')} detail="Acumulado del estado de resultados reportado" />
  </div>;
}

function CommercialFigures({ summary, state }: { summary: CommercialSummary | null; state: LoadState }) {
  if (state === 'loading') return <p className="siio-secondary">Cargando datos del CRM…</p>;
  if (state === 'error' || !summary) return <p className="siio-secondary">No se pudo cargar Comercial y Licitaciones.</p>;
  const { sales, pipeline, tenders } = summary;
  const attainment = sales.ytd_attainment;
  const closed = sales.by_month.slice(0, sales.closed_months);
  const pending = tenders.requires_decision + tenders.overdue_status;
  const lastClosed = sales.closed_months ? shortMonth(sales.closed_months) : '';
  return <div className="siio-key-grid siio-key-grid-3">
    <Figure label={`Ventas nuevas ${lastClosed ? `ene–${lastClosed}` : sales.year}`} value={millions(sales.ytd_monthly_value)} comparison={`Meta: ${millions(sales.ytd_goal)} · ${attainment === null ? '—' : `${Math.round(attainment * 100)}%`}`}>
      {attainment !== null ? <div className="siio-goal-bar" role="img" aria-label={`${Math.round(attainment * 100)}% de la meta`}><i style={{ width: `${Math.min(100, attainment * 100)}%` }} className={attainment < 0.9 ? 'below' : undefined} /></div> : null}
      <Sparkline current={closed.map(item => item.approved_monthly_value)} reference={closed.map(item => item.goal)} label="Ventas aprobadas por mes en línea oscura y meta mensual en gris" />
    </Figure>
    <Figure label="Pipeline ponderado" value={millions(pipeline.weighted_monthly_value)} comparison={pipeline.coverage_of_remaining_goal === null ? null : `Cubre ${pipeline.coverage_of_remaining_goal.toLocaleString('es-CO', { maximumFractionDigits: 1 })}× lo que falta (${millions(pipeline.remaining_goal)})`} detail={`${pipeline.open_count} oportunidades abiertas · ${millions(pipeline.monthly_value)} sin ponderar`} />
    <Figure label="Licitaciones por decidir" value={String(pending)} alert={pending > 0} comparison={`${tenders.requires_decision} sin decisión a ${tenders.decision_window_days} días · ${tenders.overdue_status} con cierre vencido`} detail={`${tenders.open_count} abiertas · ${millions(tenders.total_value)} en juego`} />
  </div>;
}

// Top strip of the Torre: few figures, each with its reference and trend (Few; IBCS: prior year and goal in grey).
export function SiioKeyFigures({ pulse, pulseState, summary, summaryState, financialRows }: { pulse: FinancialPulse | null; pulseState: LoadState; summary: CommercialSummary | null; summaryState: LoadState; financialRows: SiioFinancialMetric[] }) {
  return <section className="siio-key-figures" aria-label="Cifras clave">
    <div className="siio-key-group">
      <h3>Finanzas · {pulse ? `${longMonth(pulse.month)} ${pulse.year}` : 'último corte'}</h3>
      <FinancialFigures pulse={pulse} state={pulseState} financialRows={financialRows} />
    </div>
    <div className="siio-key-group">
      <h3>Comercial y Licitaciones · al {summary ? `${closingDateLabel(`${summary.as_of}T12:00:00Z`)} ${summary.as_of.slice(0, 4)}` : 'día'}</h3>
      <CommercialFigures summary={summary} state={summaryState} />
    </div>
  </section>;
}
