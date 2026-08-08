import { useMemo } from 'react';
import { deriveSiioExecutiveSnapshot } from '../siioExecutive';
import { deriveRecommendations, deriveTrackingItems, navigateSiioView, uniqueOptions } from './selectors';
import { Badge, EmptyState, Panel, fmtSiioMoney } from './SiioUi';
import type { SiioBootstrapPayload, SiioRouteState, SiioTrackingKind } from './types';

function formatPeriod(period: string | null | undefined) {
  return period ? new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${period}T12:00:00Z`)) : 'Sin datos publicados';
}

function formatMetric(value: number | null | undefined, percent = false) {
  if (value === null || value === undefined) return 'Sin datos';
  return percent
    ? new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 1 }).format(value)
    : fmtSiioMoney(value);
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
  const intelligenceLink = () => onNavigate(navigateSiioView('inteligencia', { period: selectedPeriod }));
  const validationLabel = snapshot.financialValidationStatus === 'validado' ? 'Validado por Finanzas' : snapshot.financialValidationStatus === 'sin_datos' ? 'Sin datos publicados' : 'Pendiente de validación financiera';

  return <div className="stack">
    <section className="siio-view-filters" aria-label="Filtros del resumen ejecutivo">
      <label>Periodo financiero
        <select value={routeState.filters.period} onChange={event => onNavigate(navigateSiioView('resumen', { ...routeState.filters, period: event.target.value }))}>
          <option value="">Último periodo publicado</option>
          {periodOptions.map(period => <option key={period} value={period}>{formatPeriod(period)}</option>)}
        </select>
      </label>
    </section>

    <div className="siio-executive-status">
      <div><span className="siio-eyebrow">Resumen ejecutivo</span><strong>Información disponible para gestión</strong></div>
      <Badge tone={snapshot.financialValidationStatus === 'validado' ? 'green' : 'amber'}>{validationLabel}</Badge>
    </div>

    {snapshot.financialValidationStatus !== 'validado' ? <div className="notice siio-preliminary-notice" role="status">Lectura preliminar — requiere validación financiera antes de usarse como conclusión ejecutiva.</div> : null}

    <div className="siio-period-line"><span>Periodo financiero</span><strong>{formatPeriod(selectedPeriod)}</strong></div>
    <div className="siio-executive-grid">
      {financialRows.map(metric => <div className="card kpi blue" key={metric.concept}>
        <div className="kpi-head"><small>{metric.concept}</small></div>
        <strong>{formatMetric(metric.value_current, metric.category === 'margen')}</strong>
        <span>{formatPeriod(selectedPeriod)}</span>
        <em>{metric.variation_pct === null || metric.variation_pct === undefined ? 'Comparativo pendiente' : `${formatMetric(metric.variation_pct, true)} vs. comparativo`}</em>
      </div>)}
    </div>

    <Panel title="Gestión que requiere atención">
      <div className="siio-management-signals">
        <button type="button" onClick={() => trackingLink('riesgos')}><span>Alertas y riesgos</span><strong>{count('riesgos')}</strong></button>
        <button type="button" onClick={() => trackingLink('decisiones')}><span>Decisiones pendientes</span><strong>{count('decisiones')}</strong></button>
        <button type="button" onClick={() => trackingLink('bloqueos')}><span>Bloqueos</span><strong>{count('bloqueos')}</strong></button>
        <button type="button" onClick={() => trackingLink('compromisos')}><span>Compromisos</span><strong>{count('compromisos')}</strong></button>
        <div className="siio-management-signal-static"><span>Alertas de nómina agregadas</span><strong>{payrollTotals.alerts}</strong></div>
      </div>
    </Panel>

    {!financialRows.length ? <EmptyState title="Sin métricas financieras publicadas" text="No hay indicadores para el periodo seleccionado." /> : null}

    <Panel title="Recomendaciones principales">
      {recommendations.length ? <div className="siio-insight-list">{recommendations.slice(0, 3).map(recommendation => <article key={recommendation.id} className={`siio-insight siio-insight-${recommendation.tone}`}><strong>{recommendation.title}</strong><p>{recommendation.finding}</p><button type="button" className="secondary" onClick={intelligenceLink}>Ver fuentes e inteligencia</button></article>)}</div> : <EmptyState title="Sin recomendaciones" text="F5 no emitirá recomendaciones hasta contar con evidencia suficiente." />}
    </Panel>

    <Panel title="Nómina agregada">
      <div className="siio-period-line"><span>Periodo de nómina</span><strong>{formatPeriod(snapshot.payrollPeriod)}</strong></div>
      <section className="siio-view-filters" aria-label="Filtro de nómina agregada">
        <label>Área de nómina
          <select value={routeState.filters.area} onChange={event => onNavigate(navigateSiioView('resumen', { ...routeState.filters, area: event.target.value }))}>
            <option value="">Todas las áreas</option>
            {areaOptions.map(area => <option key={area} value={area}>{area}</option>)}
          </select>
        </label>
      </section>
      {!payrollRows.length ? <EmptyState title="Sin agregados de nómina publicados" text="No se muestran datos individuales." /> : <>
        <div className="siio-table-wrap siio-payroll-table"><table><thead><tr><th>Área</th><th>Personas</th><th>Devengado agregado</th><th>Deducciones agregadas</th><th>Neto total</th><th>Control</th></tr></thead><tbody>{payrollRows.map(row => <tr key={`${row.period_month}:${row.area || 'sin-area'}`}><td><strong>{row.area || 'Área pendiente'}</strong></td><td>{row.total_people || 0}</td><td>{fmtSiioMoney(row.total_accrued)}</td><td>{fmtSiioMoney(row.total_deductions)}</td><td>{fmtSiioMoney(row.net_total)}</td><td>{row.alert ? <Badge tone="amber">Validar fuente</Badge> : <Badge tone="green">Consistente</Badge>}</td></tr>)}</tbody><tfoot><tr><th>Total</th><th>{payrollTotals.people}</th><th>{fmtSiioMoney(payrollTotals.accrued)}</th><th>{fmtSiioMoney(payrollTotals.deductions)}</th><th>{fmtSiioMoney(payrollTotals.net)}</th><th>Control agregado</th></tr></tfoot></table></div>
        <div className="siio-payroll-cards">{payrollRows.map(row => <article className="siio-payroll-card" key={`${row.period_month}:${row.area || 'sin-area'}:card`}>
          <div><span className="siio-secondary">Área</span><strong>{row.area || 'Área pendiente'}</strong></div>
          <div><span className="siio-secondary">Personas</span><strong>{row.total_people || 0}</strong></div>
          <div><span className="siio-secondary">Devengado</span><strong>{fmtSiioMoney(row.total_accrued)}</strong></div>
          <div><span className="siio-secondary">Deducciones</span><strong>{fmtSiioMoney(row.total_deductions)}</strong></div>
          <div><span className="siio-secondary">Neto</span><strong>{fmtSiioMoney(row.net_total)}</strong></div>
          <div><span className="siio-secondary">Control</span>{row.alert ? <Badge tone="amber">Validar fuente</Badge> : <Badge tone="green">Consistente</Badge>}</div>
        </article>)}
        <article className="siio-payroll-card siio-payroll-total-card">
          <div><span className="siio-secondary">Área</span><strong>Total</strong></div>
          <div><span className="siio-secondary">Personas</span><strong>{payrollTotals.people}</strong></div>
          <div><span className="siio-secondary">Devengado</span><strong>{fmtSiioMoney(payrollTotals.accrued)}</strong></div>
          <div><span className="siio-secondary">Deducciones</span><strong>{fmtSiioMoney(payrollTotals.deductions)}</strong></div>
          <div><span className="siio-secondary">Neto</span><strong>{fmtSiioMoney(payrollTotals.net)}</strong></div>
          <div><span className="siio-secondary">Control</span><strong>Control agregado</strong></div>
        </article>
        </div>
      </>}
    </Panel>

    <Panel title="Vigencia de fuentes">
      <button type="button" className="secondary" onClick={intelligenceLink}>Consultar fuentes y vigencia</button>
    </Panel>
  </div>;
}
