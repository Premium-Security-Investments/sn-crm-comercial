import { useEffect, useMemo, useState } from 'react';
import { api } from '../apiClient';
import type { SiioFinancialMetric } from '../siioExecutive';
import { EmptyState, Panel, fmtSiioMoney } from './SiioUi';
import { longMonth, pulseBreakdown, pulseMonth, pulseReadings, relativeChange, shortMonth, type FinancialPulse, type FinancialPulseMonth, type FinancialPulseTotals } from './financialPulse';

const percentFormat = new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 1 });
const millions = (value: number | null | undefined) => value === null || value === undefined ? '—' : `$${Math.round(value / 1e6).toLocaleString('es-CO')} M`;

function signedPercent(value: number | null) {
  if (value === null) return null;
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${percentFormat.format(Math.abs(value))}`;
}

function comparison(label: string, current: number, previous: number | null | undefined, kind: 'monto' | 'margen') {
  if (previous === null || previous === undefined) return null;
  if (kind === 'margen') {
    const points = (current - previous) * 100;
    return `${label}: ${percentFormat.format(previous)} · ${points >= 0 ? '+' : '−'}${Math.abs(points).toLocaleString('es-CO', { maximumFractionDigits: 1 })} puntos`;
  }
  // A percentage over a negative base reads backwards, so losses show the change in pesos.
  if (previous < 0 || current < 0) return `${label}: ${millions(previous)} · ${current >= previous ? 'mejoró' : 'empeoró'} ${millions(Math.abs(current - previous))}`;
  return `${label}: ${millions(previous)} · ${signedPercent(relativeChange(current, previous))}`;
}

const CARDS: Array<{ key: keyof FinancialPulseTotals; label: string; kind: 'monto' | 'margen' }> = [
  { key: 'ingresos', label: 'Ingresos del mes', kind: 'monto' },
  { key: 'costos', label: 'Costos del mes', kind: 'monto' },
  { key: 'gastos_operacionales', label: 'Gastos operacionales', kind: 'monto' },
  { key: 'utilidad_operacional', label: 'Utilidad operacional', kind: 'monto' },
  { key: 'margen_operacional', label: 'Margen operacional', kind: 'margen' },
];

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
  if (key === 'margen_operacional') return value === null ? '—' : percentFormat.format(value);
  return millions(value);
}

export function SiioFinancialPulse({ period, financialRows }: { period: string; financialRows: SiioFinancialMetric[] }) {
  const [pulse, setPulse] = useState<FinancialPulse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    setState('loading');
    api<FinancialPulse | null>(`/api/siio/financial-pulse${period ? `?period=${encodeURIComponent(period)}` : ''}`)
      .then(result => { if (active) { setPulse(result); setState('ready'); } })
      .catch(() => { if (active) setState('error'); });
    return () => { active = false; };
  }, [period]);

  const derived = useMemo(() => {
    if (!pulse) return null;
    const current = pulseMonth(pulse, pulse.year, pulse.month);
    const sameMonthLastYear = pulseMonth(pulse, pulse.year - 1, pulse.month);
    const previousMonth = pulse.month > 1 ? pulseMonth(pulse, pulse.year, pulse.month - 1) : null;
    const yearMonths = Array.from({ length: pulse.month }, (_, index) => index + 1);
    const breakdown = pulseBreakdown(pulse);
    const growthRows = breakdown.filter(row => row.kind !== 'ingreso' && row.change !== null);
    const topGrowth = growthRows.sort((a, b) => (b.change || 0) - (a.change || 0))[0]?.key || null;
    const reportedOperating = financialRows.find(row => row.concept === 'UTILIDAD OPERACIONAL')?.value_current;
    const balanceOperating = pulse.months.filter(item => item.year === pulse.year).reduce((total, item) => total + item.totals.utilidad_operacional, 0);
    return { current, sameMonthLastYear, previousMonth, yearMonths, breakdown, topGrowth, readings: pulseReadings(pulse), reportedOperating, balanceOperating };
  }, [pulse, financialRows]);

  if (state === 'loading') return <Panel title="Pulso del mes"><p className="siio-secondary">Cargando el movimiento mensual…</p></Panel>;
  if (state === 'error') return <Panel title="Pulso del mes"><EmptyState title="No se pudo cargar el pulso del mes" text="Las cifras acumuladas siguen disponibles arriba." /></Panel>;
  if (!pulse || !derived?.current) return <Panel title="Pulso del mes"><EmptyState title="Sin movimiento mensual publicado" text="El pulso aparece cuando hay un corte contable publicado con saldos por cuenta." /></Panel>;

  const { current, sameMonthLastYear, previousMonth, yearMonths, breakdown, topGrowth, readings, reportedOperating, balanceOperating } = derived;
  const monthTitle = `${longMonth(pulse.month)} de ${pulse.year}`;
  const reconciliationGap = reportedOperating === null || reportedOperating === undefined ? null : Number(reportedOperating) - balanceOperating;

  return <Panel title={`Pulso de ${monthTitle}`}>
    <p className="siio-pulse-source">Movimiento del mes según el balance de cuentas · Fuente: {pulse.source.file_name} · corte {pulse.source.cutoff_date}</p>

    <div className="siio-pulse-cards">
      {CARDS.map(card => {
        const value = current.totals[card.key];
        return <div className="siio-pulse-card" key={card.key}>
          <small>{card.label}</small>
          <strong>{card.kind === 'margen' ? (value === null ? '—' : percentFormat.format(value)) : millions(value)}</strong>
          {value !== null ? <>
            {comparison(`${shortMonth(pulse.month)} ${pulse.year - 1}`, value, sameMonthLastYear?.totals[card.key], card.kind) ? <span>{comparison(`${shortMonth(pulse.month)} ${pulse.year - 1}`, value, sameMonthLastYear?.totals[card.key], card.kind)}</span> : null}
            {previousMonth && comparison(`${shortMonth(pulse.month - 1)} ${pulse.year}`, value, previousMonth.totals[card.key], card.kind) ? <span>{comparison(`${shortMonth(pulse.month - 1)} ${pulse.year}`, value, previousMonth.totals[card.key], card.kind)}</span> : null}
          </> : null}
        </div>;
      })}
    </div>

    {readings.length ? <div className="siio-pulse-readings">
      <h4>Lectura del mes</h4>
      <ul>{readings.map(reading => <li key={reading}>{reading}</li>)}</ul>
    </div> : null}

    <div className="siio-pulse-block">
      <h4>Tendencia {pulse.year} frente a {pulse.year - 1}</h4>
      <div className="siio-table-wrap"><table className="siio-pulse-table">
        <thead><tr><th>Concepto</th>{yearMonths.map(month => <th key={month}>{shortMonth(month)}{pulseMonth(pulse, pulse.year, month)?.provision_declared === false ? ' *' : ''}</th>)}</tr></thead>
        <tbody>{TREND_ROWS.map(row => <tr key={row.key}>
          <th scope="row">{row.label}</th>
          {yearMonths.map(month => <td key={month}>
            <strong>{trendValue(pulseMonth(pulse, pulse.year, month), row.key)}</strong>
            <small>{pulse.year - 1}: {trendValue(pulseMonth(pulse, pulse.year - 1, month), row.key)}</small>
          </td>)}
        </tr>)}</tbody>
      </table></div>
      {pulse.months.some(item => item.year === pulse.year && !item.provision_declared) ? <p className="siio-pulse-footnote">* Mes sin provisión de ingresos declarada en el Excel: su ingreso puede verse más bajo y el del mes siguiente más alto.</p> : null}
      <p className="siio-pulse-footnote">Cada mes se calcula como la diferencia entre el cierre de ese mes y el del mes anterior, incluida la provisión de ingresos que Contabilidad registra y revierte cada mes.</p>
    </div>

    <div className="siio-pulse-block">
      <h4>Desglose de {monthTitle}</h4>
      <div className="siio-table-wrap"><table className="siio-pulse-table">
        <thead><tr><th>Rubro</th><th>{shortMonth(pulse.month)} {pulse.year}</th><th>{shortMonth(pulse.month)} {pulse.year - 1}</th><th>Cambio</th><th>% de ingresos</th><th>Acumulado {pulse.year}</th></tr></thead>
        <tbody>{breakdown.map(row => <tr key={row.key} className={row.key === topGrowth ? 'siio-pulse-highlight' : undefined}>
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
      ? <p className="siio-pulse-note">Estas cifras salen directamente del balance de cuentas. El estado de resultados reportado en el Excel incluye ajustes y reclasificaciones de Contabilidad: la utilidad operacional acumulada reportada ({fmtSiioMoney(Number(reportedOperating))}) difiere en {fmtSiioMoney(Math.abs(reconciliationGap))} de la que resulta del balance ({fmtSiioMoney(balanceOperating)}).</p>
      : null}
  </Panel>;
}
