import { useMemo } from 'react';
import type { SiioFinancialMetric } from '../siioExecutive';
import { EmptyState } from './SiioUi';
import { longMonth, pulseBreakdown, pulseMonth, pulseReadings, shortMonth, type FinancialPulse, type FinancialPulseMonth, type FinancialPulseTotals } from './financialPulse';

const percentFormat = new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 1 });
const millions = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '—';
  const rounded = Math.round(value / 1e6);
  return `${rounded < 0 ? '−' : ''}$${Math.abs(rounded).toLocaleString('es-CO')} M`;
};
const cutoffLabel = (value: string) => new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));

const TREND_ROWS: Array<{ key: keyof FinancialPulseTotals; label: string }> = [
  { key: 'ingresos', label: 'Ingresos' },
  { key: 'costos', label: 'Costos' },
  { key: 'gastos_operacionales', label: 'Gastos operacionales' },
  { key: 'utilidad_operacional', label: 'Utilidad operacional' },
  { key: 'margen_operacional', label: 'Margen operacional' },
];

function trendValue(month: FinancialPulseMonth | null, key: keyof FinancialPulseTotals) {
  if (!month) return '—';
  const value = month.totals[key];
  if (key === 'margen_operacional') return value === null ? '—' : percentFormat.format(value).replace('-', '−');
  return millions(value);
}

// Month detail of the financial pulse; the parent view loads the pulse once and shares it with the key figures.
export function SiioFinancialPulse({ pulse, state, financialRows }: { pulse: FinancialPulse | null; state: 'loading' | 'ready' | 'error'; financialRows: SiioFinancialMetric[] }) {
  const derived = useMemo(() => {
    if (!pulse) return null;
    const current = pulseMonth(pulse, pulse.year, pulse.month);
    const yearMonths = Array.from({ length: pulse.month }, (_, index) => index + 1);
    const breakdown = pulseBreakdown(pulse);
    const growthRows = breakdown.filter(row => row.kind !== 'ingreso' && row.change !== null);
    const topGrowth = growthRows.sort((a, b) => (b.change || 0) - (a.change || 0))[0]?.key || null;
    const reportedOperating = financialRows.find(row => row.concept === 'UTILIDAD OPERACIONAL')?.value_current;
    const balanceOperating = pulse.months.filter(item => item.year === pulse.year).reduce((total, item) => total + item.totals.utilidad_operacional, 0);
    return { current, yearMonths, breakdown, topGrowth, readings: pulseReadings(pulse), reportedOperating, balanceOperating };
  }, [pulse, financialRows]);

  if (state === 'loading') return <p className="siio-secondary">Cargando el movimiento mensual…</p>;
  if (state === 'error') return <EmptyState title="No se pudo cargar el pulso del mes" text="Las cifras acumuladas siguen disponibles." />;
  if (!pulse || !derived?.current) return <EmptyState title="Sin movimiento mensual publicado" text="El pulso aparece cuando hay un corte contable publicado con saldos por cuenta." />;

  const { yearMonths, breakdown, topGrowth, readings, reportedOperating, balanceOperating } = derived;
  const monthTitle = `${longMonth(pulse.month)} de ${pulse.year}`;
  const reconciliationGap = reportedOperating === null || reportedOperating === undefined ? null : Number(reportedOperating) - balanceOperating;

  return <div className="siio-detail-body">
    <p className="siio-pulse-source">Movimiento del mes según el balance de cuentas · Fuente: {pulse.source.file_name} · corte {cutoffLabel(pulse.source.cutoff_date)}</p>

    {readings.length ? <div className="siio-pulse-readings">
      <h4>Lectura del mes</h4>
      <ul>{readings.map(reading => <li key={reading}>{reading}</li>)}</ul>
    </div> : null}

    <div className="siio-pulse-block">
      <h4>Tendencia {pulse.year} frente a {pulse.year - 1}</h4>
      <div className="siio-table-wrap"><table className="siio-pulse-table">
        <thead><tr><th>Concepto</th>{yearMonths.map(month => <th key={month}>{shortMonth(month)}{pulseMonth(pulse, pulse.year, month)?.provision_declared === false ? ' *' : ''}{pulseMonth(pulse, pulse.year, month)?.balance_difference || pulseMonth(pulse, pulse.year - 1, month)?.balance_difference ? ' †' : ''}</th>)}</tr></thead>
        <tbody>{TREND_ROWS.map(row => <tr key={row.key}>
          <th scope="row">{row.label}</th>
          {yearMonths.map(month => <td key={month}>
            <strong>{trendValue(pulseMonth(pulse, pulse.year, month), row.key)}</strong>
            <small>{pulse.year - 1}: {trendValue(pulseMonth(pulse, pulse.year - 1, month), row.key)}</small>
          </td>)}
        </tr>)}</tbody>
      </table></div>
      {pulse.months.some(item => item.year === pulse.year && !item.provision_declared) ? <p className="siio-pulse-footnote">* Mes sin provisión de ingresos declarada en el Excel: su ingreso puede verse más bajo y el del mes siguiente más alto.</p> : null}
      {pulse.months.some(item => item.balance_difference) ? <p className="siio-pulse-footnote">† El balance de ese mes ({pulse.months.filter(item => item.balance_difference).map(item => `${longMonth(item.month)} ${item.year}`).join(', ')}) no cuadra en el Excel: sus cifras pueden no ser exactas hasta que Contabilidad lo corrija.</p> : null}
      <p className="siio-pulse-footnote">Cada mes se calcula como la diferencia entre el cierre de ese mes y el del mes anterior, incluida la provisión de ingresos que Contabilidad registra y revierte cada mes.</p>
    </div>

    <div className="siio-pulse-block">
      <h4>Desglose de {monthTitle}</h4>
      <div className="siio-table-wrap"><table className="siio-pulse-table">
        <thead><tr><th>Rubro</th><th>{shortMonth(pulse.month)} {pulse.year}</th><th>{shortMonth(pulse.month)} {pulse.year - 1}</th><th>Cambio</th><th>% de ingresos</th><th>Acumulado {pulse.year}</th></tr></thead>
        <tbody>{breakdown.map(row => <tr key={row.key}>
          <th scope="row">{row.label}{row.key === topGrowth ? <em> · el que más creció</em> : null}</th>
          <td>{millions(row.current)}</td>
          <td>{millions(row.sameMonthLastYear)}</td>
          <td>{row.change === null ? '—' : `${row.change >= 0 ? '+' : '−'}${millions(Math.abs(row.change))}`}</td>
          <td>{row.shareOfIncome === null ? '—' : percentFormat.format(row.shareOfIncome)}</td>
          <td>{millions(row.yearToDate)}</td>
        </tr>)}</tbody>
      </table></div>
    </div>

    {reconciliationGap !== null && Math.abs(reconciliationGap) >= 1e6
      ? <p className="siio-pulse-note">Estas cifras salen directamente del balance de cuentas. El estado de resultados reportado en el Excel incluye ajustes y reclasificaciones de Contabilidad: la utilidad operacional acumulada reportada ({millions(Number(reportedOperating))}) difiere en {millions(Math.abs(reconciliationGap))} de la que resulta del balance ({millions(balanceOperating)}).</p>
      : null}
  </div>;
}
