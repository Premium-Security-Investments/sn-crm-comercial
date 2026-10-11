import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../apiClient';
import { deriveSiioExecutiveSnapshot } from '../siioExecutive';
import { deriveRecommendations, deriveTrackingItems, navigateSiioView, uniqueOptions } from './selectors';
import { Badge, EmptyState, Panel } from './SiioUi';
import { SiioFinancialPulse } from './SiioFinancialPulse';
import { PrivateAttentionTable, SiioPrivateDetail, SiioTenderDetail, TenderAttentionTable, millions } from './SiioCommercialPanel';
import { SiioKeyFigures, SiioTrendCharts } from './SiioKeyFigures';
import { privateReadings, tenderReadings, type CommercialSummary } from './commercialSummary';
import { pulseReadings, type FinancialPulse } from './financialPulse';
import type { SiioFinancialMetric } from '../siioExecutive';
import type { SiioBootstrapPayload, SiioRouteState, SiioTrackingKind } from './types';

function formatPeriod(period: string | null | undefined) {
  if (!period) return 'Sin datos publicados';
  const label = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${period}T12:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const payrollMillions = (value: number | null | undefined) => `$${(Number(value || 0) / 1e6).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} M`;

function formatMetric(value: number | null | undefined, percent = false) {
  if (value === null || value === undefined) return 'Sin datos';
  return percent
    ? new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 1 }).format(value).replace('-', '−')
    : millions(Number(value));
}

type LoadState = 'loading' | 'ready' | 'error';

function useSiioData<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  useEffect(() => {
    let active = true;
    setState('loading');
    api<T>(path)
      .then(result => { if (active) { setData(result); setState('ready'); } })
      .catch(() => { if (active) setState('error'); });
    return () => { active = false; };
  }, [path]);
  return [data, state] as const;
}

// Detail on demand: the first screen monitors, the folded sections hold the tables.
function DetailSection({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return <details className="panel siio-detail">
    <summary>
      <span className="siio-detail-text"><span className="siio-detail-title">{title}</span><span className="siio-detail-hint">{hint}</span></span>
      <span className="siio-detail-action" aria-hidden="true"><span className="siio-detail-open">Ver detalle ▾</span><span className="siio-detail-close">Ocultar ▴</span></span>
    </summary>
    {children}
  </details>;
}

function monthName(month: number) {
  return new Intl.DateTimeFormat('es-CO', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, month - 1, 15))).replace('.', '');
}

// Accumulated figures cover January through the cut month; the comparison is the same range one year earlier.
function metricBasis(metric: SiioFinancialMetric, period: string) {
  if (!period) return { current: '', comparison: 'comparativo' };
  const [year, month] = period.split('-').map(Number);
  if (metric.base_value !== 'acumulado') return { current: formatPeriod(period), comparison: `${monthName(month)} ${year - 1}` };
  const range = month === 1 ? monthName(1) : `${monthName(1)}–${monthName(month)}`;
  return { current: `Acumulado ${range} ${year}`, comparison: `${range} ${year - 1}` };
}

function metricChange(metric: SiioFinancialMetric) {
  const current = metric.value_current;
  const comparison = metric.value_comparison;
  if (current === null || current === undefined || comparison === null || comparison === undefined) {
    return metric.variation_pct === null || metric.variation_pct === undefined ? null : `${formatMetric(metric.variation_pct, true)}`;
  }
  const difference = Number(current) - Number(comparison);
  const sign = difference > 0 ? '+' : difference < 0 ? '−' : '';
  if (metric.category === 'margen') return `${sign}${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(Math.abs(difference) * 100)} puntos`;
  // A percentage over a negative base reads backwards, so negative results show the change in pesos.
  if (Number(current) < 0 || Number(comparison) < 0) return `${difference < 0 ? 'Empeoró' : 'Mejoró'} ${millions(Math.abs(difference))}`;
  if (!Number(comparison)) return null;
  return `${sign}${new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 1 }).format(Math.abs(difference / Number(comparison)))}`;
}

export function SiioExecutiveView({ payload, routeState, onNavigate }: { payload: SiioBootstrapPayload; routeState: Extract<SiioRouteState, { view: 'resumen' }>; onNavigate: (state: SiioRouteState) => void }) {
  const snapshot = useMemo(() => deriveSiioExecutiveSnapshot({
    financialMetrics: payload.financialMetrics,
    payrollAggregates: payload.payrollAggregates,
    sources: payload.sources,
  }, routeState.filters.period), [payload.financialMetrics, payload.payrollAggregates, payload.sources, routeState.filters.period]);
  const trackingItems = useMemo(() => deriveTrackingItems(payload.records, payload.decisions), [payload.records, payload.decisions]);
  const periodOptions = useMemo(() => uniqueOptions(payload.financialMetrics.map(metric => metric.period_month)), [payload.financialMetrics]);
  const areaOptions = useMemo(() => uniqueOptions(payload.payrollAggregates.map(row => row.area)), [payload.payrollAggregates]);
  const selectedPeriod = snapshot.financialPeriod || '';
  const financialRows = snapshot.financialRows;
  const payrollRows = useMemo(() => payload.payrollAggregates.filter(row =>
    (!routeState.filters.area || row.area === routeState.filters.area)
    && (!snapshot.payrollPeriod || row.period_month === snapshot.payrollPeriod)
  ), [payload.payrollAggregates, routeState.filters.area, snapshot.payrollPeriod]);
  const payrollTotals = useMemo(() => payrollRows.reduce((total, row) => ({
    people: total.people + Number(row.total_people || 0),
    accrued: total.accrued + Number(row.total_accrued || 0),
    deductions: total.deductions + Number(row.total_deductions || 0),
    net: total.net + Number(row.net_total || 0),
    alerts: total.alerts + (row.alert ? 1 : 0),
  }), { people: 0, accrued: 0, deductions: 0, net: 0, alerts: 0 }), [payrollRows]);
  const recommendations = useMemo(() => deriveRecommendations(snapshot), [snapshot]);
  const count = (kind: SiioTrackingKind) => trackingItems.filter(item => item.kind === kind && item.activityState === 'active').length;
  const trackingLink = (kind: SiioTrackingKind) => onNavigate(navigateSiioView('seguimiento', { kind }));
  const [pulse, pulseState] = useSiioData<FinancialPulse | null>(`/api/siio/financial-pulse${selectedPeriod ? `?period=${encodeURIComponent(selectedPeriod)}` : ''}`);
  const [commercial, commercialState] = useSiioData<CommercialSummary>('/api/siio/commercial-summary');
  const signals = (['decisiones', 'bloqueos', 'riesgos', 'compromisos'] as SiioTrackingKind[]).map(kind => ({ kind, total: count(kind) })).filter(item => item.total > 0);
  // Each business reads apart: tenders (total contract value), private sales (monthly value), finance.
  const tenderNotes = commercial ? tenderReadings(commercial) : [];
  const privateNotes = commercial ? privateReadings(commercial).filter(text => !/^(Ventas nuevas|El pipeline ponderado)/.test(text)) : [];
  const financeNotes = pulse ? pulseReadings(pulse).filter(text => !/provisión|^Enero cerró/.test(text)).slice(0, 2) : [];
  const alertBasis = (recommendation: { id: string; period?: string | null }) => recommendation.id === 'payroll-source-alert'
    ? `Nómina de ${formatPeriod(recommendation.period || snapshot.payrollPeriod).toLowerCase()}`
    : financialRows[0] ? `Estado de resultados, ${metricBasis(financialRows[0], selectedPeriod).current.toLowerCase()}` : 'Periodo financiero seleccionado';
  const validationLabel = snapshot.financialValidationStatus === 'validado' ? 'Validación humana registrada' : snapshot.financialValidationStatus === 'sin_datos' ? 'Sin datos publicados' : 'Pendiente de validación financiera';

  return <div className="stack">
    <section className="siio-view-filters" aria-label="Filtros del resumen ejecutivo">
      <span className="siio-eyebrow">Resumen ejecutivo</span>
      <label>Periodo financiero
        <select value={routeState.filters.period} onChange={event => onNavigate(navigateSiioView('resumen', { ...routeState.filters, period: event.target.value }))}>
          <option value="">Último periodo publicado ({formatPeriod(selectedPeriod)})</option>
          {periodOptions.map(period => <option key={period} value={period}>{formatPeriod(period)}</option>)}
        </select>
      </label>
      <Badge tone={snapshot.financialValidationStatus === 'validado' ? 'green' : 'amber'}>{validationLabel}</Badge>
    </section>

    {snapshot.financialValidationStatus !== 'validado' ? <div className="notice siio-preliminary-notice" role="status">Lectura preliminar — requiere validación financiera antes de usarse como conclusión ejecutiva.</div> : null}

    <SiioKeyFigures pulse={pulse} pulseState={pulseState} summary={commercial} summaryState={commercialState} financialRows={financialRows} />

    <SiioTrendCharts pulse={pulse} summary={commercial} />

    <Panel title="Requiere atención">
      <section className="siio-attention-section" aria-label="Licitaciones públicas">
        <h3>Licitaciones públicas</h3>
        {tenderNotes.length ? <div className="siio-pulse-readings"><ul>{tenderNotes.map(note => <li key={note}>{note}</li>)}</ul></div> : null}
        {commercial ? <TenderAttentionTable summary={commercial} /> : null}
      </section>
      <section className="siio-attention-section" aria-label="Comercial privado">
        <h3>Comercial privado</h3>
        {privateNotes.length ? <div className="siio-pulse-readings"><ul>{privateNotes.map(note => <li key={note}>{note}</li>)}</ul></div> : null}
        {commercial ? <PrivateAttentionTable summary={commercial} /> : null}
      </section>
      <section className="siio-attention-section" aria-label="Finanzas">
        <h3>Finanzas y nómina</h3>
        {financeNotes.length ? <div className="siio-pulse-readings"><ul>{financeNotes.map(note => <li key={note}>{note}</li>)}</ul></div> : null}
        {recommendations.length ? <>
          <h4 className="siio-alerts-title">Alertas automáticas</h4>
          <p className="siio-pulse-footnote">Reglas fijas del SIIO que se encienden cuando se cumple una condición; no son recomendaciones de una persona ni de la IA.</p>
          <ul className="siio-alert-list">{recommendations.map(recommendation => <li key={recommendation.id}>
            <strong>{recommendation.title}</strong>
            <span>{recommendation.finding}</span>
            <small>{alertBasis(recommendation)}</small>
          </li>)}</ul>
        </> : null}
        <p className="siio-secondary">{signals.length
          ? signals.map(item => <button type="button" key={item.kind} className="secondary" onClick={() => trackingLink(item.kind)}>{item.total} {item.kind} en seguimiento</button>)
          : 'Sin decisiones, bloqueos, riesgos ni compromisos abiertos en el seguimiento gerencial.'}</p>
      </section>
    </Panel>

    <DetailSection title={`Finanzas · detalle de ${pulse ? formatPeriod(selectedPeriod).toLowerCase() : 'periodo'}`} hint="Lectura del mes, tendencia, desglose por rubro y acumulado del año">
      {financialRows.length ? <SiioFinancialPulse pulse={pulse} state={pulseState} financialRows={financialRows} /> : <EmptyState title="Sin métricas financieras publicadas" text="No hay indicadores para el periodo seleccionado." />}
      {financialRows.length ? <div className="siio-pulse-block">
        <h4>Acumulado del año según el estado de resultados reportado</h4>
        <div className="siio-executive-grid siio-key-grid">
          {financialRows.map(metric => <div className="siio-key-figure" key={metric.concept}>
            <small>{metric.concept}</small>
            <strong>{formatMetric(metric.value_current, metric.category === 'margen')}</strong>
            <span className="siio-key-comparison">{metric.value_comparison === null || metric.value_comparison === undefined
              ? 'Comparativo pendiente'
              : `${metricBasis(metric, selectedPeriod).comparison}: ${formatMetric(metric.value_comparison, metric.category === 'margen')}${metricChange(metric) ? ` · ${metricChange(metric)}` : ''}`}</span>
            <span>{metricBasis(metric, selectedPeriod).current}</span>
          </div>)}
        </div>
      </div> : null}
      <div className="siio-pulse-block">
        <h4>En construcción</h4>
        <div className="siio-commercial-pending-grid">
          <div className="siio-commercial-pending"><strong>Comparación con presupuesto</strong><span>Pendiente: presupuesto mensual del año por rubro.</span></div>
        </div>
      </div>
    </DetailSection>

    <DetailSection title="Comercial privado · detalle" hint="Pipeline por etapa, indicadores en construcción y calidad del dato del CRM">
      <SiioPrivateDetail summary={commercial} state={commercialState} />
    </DetailSection>

    <DetailSection title="Licitaciones públicas · detalle" hint="Otras licitaciones activas e indicadores en construcción">
      <SiioTenderDetail summary={commercial} state={commercialState} />
    </DetailSection>

    <DetailSection title="Seguimiento gerencial y nómina agregada" hint="Riesgos, decisiones, bloqueos, compromisos y nómina por área">
    <Panel title="Gestión que requiere atención">
      <div className="siio-management-signals">
        <button type="button" onClick={() => trackingLink('riesgos')}><span>Riesgos registrados</span><strong>{count('riesgos')}</strong></button>
        <button type="button" onClick={() => trackingLink('decisiones')}><span>Decisiones pendientes</span><strong>{count('decisiones')}</strong></button>
        <button type="button" onClick={() => trackingLink('bloqueos')}><span>Bloqueos</span><strong>{count('bloqueos')}</strong></button>
        <button type="button" onClick={() => trackingLink('compromisos')}><span>Compromisos</span><strong>{count('compromisos')}</strong></button>
        <div className="siio-management-signal-static"><span>Alertas de nómina agregadas</span><strong>{payrollTotals.alerts}</strong></div>
      </div>
    </Panel>

    <Panel title="Nómina agregada">
      <div className="siio-period-line"><span>Periodo de nómina</span><strong>{formatPeriod(snapshot.payrollPeriod)}</strong></div>
      {snapshot.payrollPeriod && selectedPeriod && snapshot.payrollPeriod !== selectedPeriod ? <p className="siio-pulse-footnote">La nómina va a {formatPeriod(snapshot.payrollPeriod).toLowerCase()}; las cifras financieras, a {formatPeriod(selectedPeriod).toLowerCase()}. Valores en millones de pesos.</p> : <p className="siio-pulse-footnote">Valores en millones de pesos.</p>}
      <section className="siio-view-filters" aria-label="Filtro de nómina agregada">
        <label>Área de nómina
          <select value={routeState.filters.area} onChange={event => onNavigate(navigateSiioView('resumen', { ...routeState.filters, area: event.target.value }))}>
            <option value="">Todas las áreas</option>
            {areaOptions.map(area => <option key={area} value={area}>{area}</option>)}
          </select>
        </label>
      </section>
      {!payrollRows.length ? <p className="siio-secondary siio-quiet-empty"><strong>Sin agregados de nómina publicados.</strong> No se muestran datos individuales.</p> : <>
        <div className="siio-table-wrap siio-payroll-table"><table><thead><tr><th>Área</th><th>Personas</th><th>Devengado agregado</th><th>Deducciones agregadas</th><th>Neto total</th><th>Control</th></tr></thead><tbody>{payrollRows.map(row => <tr key={`${row.period_month}:${row.area || 'sin-area'}`}><td><strong>{row.area || 'Área pendiente'}</strong></td><td>{row.total_people || 0}</td><td>{payrollMillions(row.total_accrued)}</td><td>{payrollMillions(row.total_deductions)}</td><td>{payrollMillions(row.net_total)}</td><td>{row.alert ? <Badge tone="amber">Validar fuente</Badge> : <Badge tone="green">Consistente</Badge>}</td></tr>)}</tbody><tfoot><tr><th>Total</th><th>{payrollTotals.people}</th><th>{payrollMillions(payrollTotals.accrued)}</th><th>{payrollMillions(payrollTotals.deductions)}</th><th>{payrollMillions(payrollTotals.net)}</th><th>Control agregado</th></tr></tfoot></table></div>
        <div className="siio-payroll-cards">{payrollRows.map(row => <article className="siio-payroll-card" key={`${row.period_month}:${row.area || 'sin-area'}:card`}>
          <div><span className="siio-secondary">Área</span><strong>{row.area || 'Área pendiente'}</strong></div>
          <div><span className="siio-secondary">Personas</span><strong>{row.total_people || 0}</strong></div>
          <div><span className="siio-secondary">Devengado</span><strong>{payrollMillions(row.total_accrued)}</strong></div>
          <div><span className="siio-secondary">Deducciones</span><strong>{payrollMillions(row.total_deductions)}</strong></div>
          <div><span className="siio-secondary">Neto</span><strong>{payrollMillions(row.net_total)}</strong></div>
          <div><span className="siio-secondary">Control</span>{row.alert ? <Badge tone="amber">Validar fuente</Badge> : <Badge tone="green">Consistente</Badge>}</div>
        </article>)}
        <article className="siio-payroll-card siio-payroll-total-card">
          <div><span className="siio-secondary">Área</span><strong>Total</strong></div>
          <div><span className="siio-secondary">Personas</span><strong>{payrollTotals.people}</strong></div>
          <div><span className="siio-secondary">Devengado</span><strong>{payrollMillions(payrollTotals.accrued)}</strong></div>
          <div><span className="siio-secondary">Deducciones</span><strong>{payrollMillions(payrollTotals.deductions)}</strong></div>
          <div><span className="siio-secondary">Neto</span><strong>{payrollMillions(payrollTotals.net)}</strong></div>
          <div><span className="siio-secondary">Control</span><strong>Control agregado</strong></div>
        </article>
        </div>
      </>}
    </Panel>
    </DetailSection>

  </div>;
}
