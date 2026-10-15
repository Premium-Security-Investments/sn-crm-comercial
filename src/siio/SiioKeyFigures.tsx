import type { ReactNode } from 'react';
import type { SiioFinancialMetric } from '../siioExecutive';
import { millions } from './SiioCommercialPanel';
import { SiioColumnChart, SiioLineChart, type ChartSeries } from './SiioCharts';
import { closingDateLabel, type CommercialSummary } from './commercialSummary';
import { hasMaterialBalanceDifference, isComparable, longMonth, pulseMonth, relativeChange, shortMonth, type FinancialPulse, type FinancialPulseMonth, type FinancialPulseTotals } from './financialPulse';

type LoadState = 'loading' | 'ready' | 'error';

const percentFormat = new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 1 });
const percentText = (value: number) => percentFormat.format(value).replace('-', '−');
const signedPercent = (value: number | null) => value === null ? null : `${value > 0 ? '+' : value < 0 ? '−' : ''}${percentFormat.format(Math.abs(value))}`;
const points = (current: number, previous: number) => {
  const difference = (current - previous) * 100;
  return `${difference >= 0 ? '+' : '−'}${Math.abs(difference).toLocaleString('es-CO', { maximumFractionDigits: 1 })} puntos`;
};

// Change against a reference, phrased so a loss never reads as a percentage over a negative base.
function versus(label: string, current: number | null | undefined, previous: number | null | undefined, kind: 'monto' | 'margen') {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  if (kind === 'margen') return `${label}: ${percentText(previous)} · ${points(current, previous)}`;
  if (current < 0 || previous < 0) return `${label}: ${millions(previous)} · ${current >= previous ? 'mejoró' : 'empeoró'} ${millions(Math.abs(current - previous))}`;
  return `${label}: ${millions(previous)} · ${signedPercent(relativeChange(current, previous))}`;
}

function Figure({ label, value, detail, comparison, alert, children }: { label: string; value: string; detail?: string | null; comparison?: string | null; alert?: boolean; children?: ReactNode }) {
  return <div className={`siio-key-figure${alert ? ' siio-card-alert' : ''}`}>
    <small>{label}</small>
    <strong>{value}</strong>
    {comparison ? <span className="siio-key-comparison">{comparison}</span> : null}
    {children}
    {detail ? <span>{detail}</span> : null}
  </div>;
}

// Months whose balance does not add up are left out of the charts instead of drawing a false bar.
function monthSeries(pulse: FinancialPulse, year: number, key: keyof FinancialPulseTotals) {
  return Array.from({ length: pulse.month }, (_, index) => {
    const month = pulseMonth(pulse, year, index + 1);
    const value = isComparable(month) ? month.totals[key] : null;
    return value === null || value === undefined ? null : Number(value);
  });
}

function caveatNote(pulse: FinancialPulse) {
  const label = (item: FinancialPulseMonth) => `${shortMonth(item.month)} ${item.year}`;
  const notes = [
    ...pulse.months.filter(item => item.month <= pulse.month && !item.provision_declared).map(item => `${label(item)} sin provisión de ingresos`),
    ...pulse.months.filter(item => item.month <= pulse.month && hasMaterialBalanceDifference(item)).map(item => `${label(item)} sin dato: el balance no cuadra en el Excel`),
  ];
  return notes.length ? ` · ${notes.join(' · ')}` : '';
}

function FinancialFigures({ pulse, state, financialRows }: { pulse: FinancialPulse | null; state: LoadState; financialRows: SiioFinancialMetric[] }) {
  const current = pulse ? pulseMonth(pulse, pulse.year, pulse.month) : null;
  if (state === 'loading') return <p className="siio-secondary">Cargando cifras financieras…</p>;
  if (!pulse || !current) return <p className="siio-secondary">Sin corte contable publicado con saldos por cuenta.</p>;
  // Same month last year is the reference; if its balance does not add up, the previous month stands in and the
  // card says why.
  const sameMonthLastYear = pulseMonth(pulse, pulse.year - 1, pulse.month);
  const previousMonth = pulse.month > 1 ? pulseMonth(pulse, pulse.year, pulse.month - 1) : null;
  const useLastYear = isComparable(sameMonthLastYear);
  const lastYear = useLastYear ? sameMonthLastYear : isComparable(previousMonth) ? previousMonth : null;
  const reference = lastYear ? `${shortMonth(lastYear.month)} ${lastYear.year}` : '';
  const caveat = sameMonthLastYear && !useLastYear ? `Frente al mes anterior: ${shortMonth(pulse.month)} ${pulse.year - 1} no es comparable porque su balance no cuadra en el Excel.` : null;
  const notComparable = sameMonthLastYear && !lastYear ? `${shortMonth(pulse.month)} ${pulse.year - 1}: no comparable, su balance no cuadra en el Excel` : null;
  const month = shortMonth(pulse.month);
  const net = financialRows.find(row => row.concept === 'UTILIDAD NETA');
  const netCurrent = net?.value_current === null || net?.value_current === undefined ? null : Number(net.value_current);
  const netPrevious = net?.value_comparison === null || net?.value_comparison === undefined ? null : Number(net.value_comparison);
  const range = pulse.month === 1 ? 'ene' : `ene–${month}`;
  return <div className="siio-key-grid siio-key-grid-4">
    <Figure label={`Ingresos ${month}`} value={millions(current.totals.ingresos)} comparison={notComparable ?? versus(reference, current.totals.ingresos, lastYear?.totals.ingresos, 'monto')} detail={caveat}>
    </Figure>
    <Figure label={`Utilidad operacional ${month}`} value={millions(current.totals.utilidad_operacional)} comparison={notComparable ?? versus(reference, current.totals.utilidad_operacional, lastYear?.totals.utilidad_operacional, 'monto')}>
    </Figure>
    <Figure label={`Margen operacional ${month}`} value={current.totals.margen_operacional === null ? '—' : percentText(current.totals.margen_operacional)} comparison={notComparable ?? versus(reference, current.totals.margen_operacional, lastYear?.totals.margen_operacional, 'margen')}>
    </Figure>
    <Figure label={`Utilidad neta ${range}`} value={netCurrent === null ? '—' : millions(netCurrent)} comparison={versus(`${range} ${pulse.year - 1}`, netCurrent, netPrevious, 'monto')} detail="Acumulado del estado de resultados reportado" />
  </div>;
}

function PrivateFigures({ summary, state }: { summary: CommercialSummary | null; state: LoadState }) {
  if (state === 'loading') return <p className="siio-secondary">Cargando datos del CRM…</p>;
  if (state === 'error' || !summary) return <p className="siio-secondary">No se pudieron cargar las ventas a privados.</p>;
  const { sales, pipeline } = summary;
  const attainment = sales.ytd_attainment;
  const lastClosed = sales.closed_months ? shortMonth(sales.closed_months) : '';
  return <div className="siio-key-grid siio-key-grid-2">
    <Figure label={`Ventas nuevas ${lastClosed ? `ene–${lastClosed}` : sales.year}`} value={millions(sales.ytd_monthly_value)} comparison={`Meta: ${millions(sales.ytd_goal)} · ${attainment === null ? '—' : `${Math.round(attainment * 100)}%`}`} detail="Valor mensual del servicio">
      {attainment !== null ? <div className="siio-goal-bar" role="img" aria-label={`${Math.round(attainment * 100)}% de la meta`}><i style={{ width: `${Math.min(100, attainment * 100)}%` }} className={attainment < 0.9 ? 'below' : undefined} /></div> : null}
    </Figure>
    <Figure label="Pipeline ponderado" value={millions(pipeline.weighted_monthly_value)} comparison={pipeline.coverage_of_remaining_goal === null ? null : `Cubre ${pipeline.coverage_of_remaining_goal.toLocaleString('es-CO', { maximumFractionDigits: 1 })}× lo que falta (${millions(pipeline.remaining_goal)})`} detail={`${pipeline.open_count} oportunidades abiertas · ${millions(pipeline.monthly_value)} sin ponderar`} />
  </div>;
}

function TenderFigures({ summary, state }: { summary: CommercialSummary | null; state: LoadState }) {
  if (state === 'loading') return <p className="siio-secondary">Cargando licitaciones…</p>;
  if (state === 'error' || !summary) return <p className="siio-secondary">No se pudieron cargar las licitaciones.</p>;
  const { tenders } = summary;
  const pending = tenders.requires_decision + tenders.overdue_status;
  return <div className="siio-key-grid siio-key-grid-2">
    <Figure label="Por decidir" value={String(pending)} alert={pending > 0} comparison={`${tenders.requires_decision} sin decisión a ${tenders.decision_window_days} días · ${tenders.overdue_status} con cierre vencido`} />
    <Figure label="En juego" value={millions(tenders.total_value)} comparison={`${tenders.open_count} licitaciones activas`} detail="Valor total de los procesos" />
  </div>;
}

// Top strip of the Torre: few figures, each with its reference and trend (Few; IBCS: prior year and goal in grey).
export function SiioKeyFigures({ pulse, pulseState, summary, summaryState, financialRows }: { pulse: FinancialPulse | null; pulseState: LoadState; summary: CommercialSummary | null; summaryState: LoadState; financialRows: SiioFinancialMetric[] }) {
  return <section className="siio-key-figures" aria-label="Cifras clave">
    <div className="siio-key-group">
      <h3>Finanzas · {pulse ? `${longMonth(pulse.month)} ${pulse.year}` : 'último corte'}</h3>
      <FinancialFigures pulse={pulse} state={pulseState} financialRows={financialRows} />
    </div>
    <div className="siio-key-row">
      <div className="siio-key-group">
        <h3>Comercial privado · al {summary ? `${closingDateLabel(`${summary.as_of}T12:00:00Z`)} ${summary.as_of.slice(0, 4)}` : 'día'}</h3>
        <PrivateFigures summary={summary} state={summaryState} />
      </div>
      <div className="siio-key-group">
        <h3>Licitaciones públicas · al {summary ? `${closingDateLabel(`${summary.as_of}T12:00:00Z`)} ${summary.as_of.slice(0, 4)}` : 'día'}</h3>
        <TenderFigures summary={summary} state={summaryState} />
      </div>
    </div>
  </section>;
}

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const axisMillions = (value: number) => `${value < 0 ? '−' : ''}${Math.abs(Math.round(value / 1e6)).toLocaleString('es-CO')}`;
const axisPercent = (value: number) => `${(value * 100).toLocaleString('es-CO', { maximumFractionDigits: 0 })}%`.replace('-', '−');

// Trend block under the key figures: real charts with months, scale and values.
export function SiioTrendCharts({ pulse, summary }: { pulse: FinancialPulse | null; summary: CommercialSummary | null }) {
  const months = pulse ? Array.from({ length: pulse.month }, (_, index) => MONTHS_SHORT[index]) : [];
  const yearSeries = (key: keyof FinancialPulseTotals): ChartSeries[] => pulse ? [
    { name: String(pulse.year), values: monthSeries(pulse, pulse.year, key), tone: 'accent' },
    { name: String(pulse.year - 1), values: monthSeries(pulse, pulse.year - 1, key), tone: 'reference' },
  ] : [];
  const closed = summary ? summary.sales.by_month.slice(0, summary.sales.closed_months) : [];
  if (!pulse && !closed.length) return null;
  return <section className="panel siio-trends" aria-label="Tendencia">
    <h2>Tendencia</h2>
    <div className="siio-chart-grid-layout">
      {pulse ? <SiioColumnChart title="Ingresos por mes" note={`Millones de pesos${caveatNote(pulse)}`} categories={months} series={yearSeries('ingresos')} format={millions} axisFormat={axisMillions} /> : null}
      {pulse ? <SiioColumnChart title="Utilidad operacional por mes" note={`Millones de pesos${caveatNote(pulse)}`} categories={months} series={yearSeries('utilidad_operacional')} format={millions} axisFormat={axisMillions} /> : null}
      {pulse ? <SiioLineChart title="Margen operacional por mes" note={`Utilidad operacional sobre ingresos${caveatNote(pulse)}`} categories={months} series={yearSeries('margen_operacional')} format={percentText} axisFormat={axisPercent} /> : null}
      {closed.length ? <SiioColumnChart title="Ventas nuevas a privados por mes" note="Valor mensual del servicio, por mes de cotización · millones · sin licitaciones" categories={closed.map((_, index) => MONTHS_SHORT[index])} series={[{ name: `Ventas ${summary?.sales.year}`, values: closed.map(item => item.approved_monthly_value), tone: 'accent' }, { name: 'Meta del mes', values: closed.map(item => item.goal || null), tone: 'reference' }]} format={millions} axisFormat={axisMillions} labelAll={false} /> : null}
    </div>
  </section>;
}
