import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../apiClient';
import { deriveSiioExecutiveSnapshot } from '../siioExecutive';
import { deriveRecommendations, navigateSiioView, uniqueOptions } from './selectors';
import { EmptyState } from './SiioUi';
import { SiioFinancialPulse } from './SiioFinancialPulse';
import { millions } from './SiioCommercialPanel';
import { PLAZO_ALTO, SiioPestanaComercial } from './SiioPestanaComercial';
import { FollowupCell, FollowupComposer } from './SiioFollowups';
import { addDays, isOverdue, openFollowupFor, todayIso, useFollowups, type FollowupDraft } from './followups';
import { closingDateLabel, type CommercialSummary } from './commercialSummary';
import { deriveEstaSemana } from './estaSemana';
import { pulseReadings, type FinancialPulse } from './financialPulse';
import { deriveOperationsSummary } from './operationsSummary';
import { SiioLoQueFalta } from './SiioLoQueFalta';
import { SiioFuentesAlDia } from './SiioFuentesAlDia';
import { SiioOperationsAttention, SiioOperationsDetail } from './SiioOperationsPanel';
import { SiioRecommendations } from './SiioRecommendations';
import { SiioPestanaParametros } from './SiioParametros';
import { alertasDeAvancys, SiioPestanaCartera, SiioPestanaClientes, SiioPestanaResultados, SiioPortada, SiioRequiereDecision, useTorreAvancys, type AlertaTorre, type PestanaTorre } from './SiioTorreAvancys';
import type { SiioFinancialMetric } from '../siioExecutive';
import type { SiioBootstrapPayload, SiioRouteState } from './types';

function formatPeriod(period: string | null | undefined) {
  if (!period) return 'Sin datos publicados';
  const label = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${period}T12:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const payrollMillions = (value: number | null | undefined) => `$${(Number(value || 0) / 1e6).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} M`;

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

// «A», «A y B», «A, B y C».
const enumerar = (nombres: string[]) => (nombres.length < 2 ? nombres.join('') : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`);

const PESTANAS: ReadonlyArray<[PestanaTorre, string]> = [
  ['portada', 'Portada'], ['resultados', 'Resultados'], ['clientes', 'Clientes'], ['cartera', 'Cartera'], ['comercial', 'Comercial y licitaciones'], ['vigia', 'Vig-IA'], ['parametros', 'Parámetros'], ['fuentes', 'Fuentes y detalle'],
];

// Nombres cortos para la Portada: «Rama Judicial – Dirección Ejecutiva…» → «Rama Judicial»; «SIC SUPERINTENDENCIA DE
// INDUSTRIA Y COMERCIO» → «SIC»; lo escrito en mayúsculas sostenidas, en tipo título.
const MENORES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'el', 'en', 'para']);
export function nombreCorto(nombre: string) {
  const base = nombre.split(/\s+[–-]\s+/)[0].trim();
  const palabras = base.split(/\s+/);
  const mayusculas = base === base.toUpperCase();
  if (mayusculas && palabras.length > 2 && /^[A-ZÁÉÍÓÚÑ]{2,4}$/.test(palabras[0])) return palabras[0];
  if (!mayusculas) return base;
  return palabras.map((palabra, indice) => {
    const minuscula = palabra.toLowerCase();
    return indice && MENORES.has(minuscula) ? minuscula : minuscula.replace(/^./, letra => letra.toUpperCase());
  }).join(' ');
}

// Licitaciones en la Portada (Juan, 2026-11-15): la decisión como pregunta, con las primeras que cierran, cuándo,
// cuántas hay por decidir y cuánto hay en juego; la ficha dice cuántos días quedan para decidir.
function licitacionesPorDecidir(porDecidir: CommercialSummary['tenders']['calendar']): Pick<AlertaTorre, 'ficha' | 'frase'> {
  const orden = [...porDecidir].sort((a, b) => (a.days_to_deadline ?? 9999) - (b.days_to_deadline ?? 9999));
  const primeras = orden.slice(0, 2).filter(item => item.deadline_at);
  const enJuego = porDecidir.reduce((suma, item) => suma + (item.total_value || 0), 0);
  const mismoDia = primeras.length === 2 && closingDateLabel(primeras[0].deadline_at) === closingDateLabel(primeras[1].deadline_at);
  const nombres = primeras.map(item => nombreCorto(item.entity));
  const cierre = !primeras.length ? '' : mismoDia ? `Cierran el ${closingDateLabel(primeras[0].deadline_at)}`
    : primeras.length === 2 ? `Cierran el ${closingDateLabel(primeras[0].deadline_at)} y el ${closingDateLabel(primeras[1].deadline_at)}` : `Cierra el ${closingDateLabel(primeras[0].deadline_at)}`;
  const dias = orden[0]?.days_to_deadline;
  const limite = primeras[0]?.deadline_at ? closingDateLabel(new Date(Date.parse(primeras[0].deadline_at) - 86400000).toISOString()) : null;
  return {
    ficha: dias !== null && dias !== undefined && dias >= 1 ? { valor: `${dias - 1} ${dias - 1 === 1 ? 'día' : 'días'}`, unidad: limite ? `decidir antes del ${limite.split(' ')[0]}` : 'para decidir' } : { valor: `${porDecidir.length}`, unidad: 'por decidir' },
    frase: <><strong>{nombres.length ? `¿Nos presentamos a ${enumerar(nombres)}?` : `${porDecidir.length} licitaciones esperan la decisión de presentarse.`}</strong>{nombres.length ? ` ${cierre}; ` : ' '}{porDecidir.length === 1 ? 'es la única por decidir' : `hay ${porDecidir.length} licitaciones por decidir`}, {millions(enJuego)} en juego.</>,
  };
}

export function SiioExecutiveView({ payload, routeState, onNavigate, fuentesExtra = null }: { payload: SiioBootstrapPayload; routeState: Extract<SiioRouteState, { view: 'resumen' }>; onNavigate: (state: SiioRouteState) => void; fuentesExtra?: ReactNode }) {
  const snapshot = useMemo(() => deriveSiioExecutiveSnapshot({
    financialMetrics: payload.financialMetrics,
    payrollAggregates: payload.payrollAggregates,
    sources: payload.sources,
  }, routeState.filters.period), [payload.financialMetrics, payload.payrollAggregates, payload.sources, routeState.filters.period]);
  const periodOptions = useMemo(() => uniqueOptions(payload.financialMetrics.map(metric => metric.period_month)), [payload.financialMetrics]);
  const areaOptions = useMemo(() => uniqueOptions(payload.payrollAggregates.map(row => row.area)), [payload.payrollAggregates]);
  const selectedPeriod = snapshot.financialPeriod || '';
  // El último mes del Excel de Finanzas: hasta ahí manda su cierre; lo de después es de Avancys.
  const ultimoExcel = useMemo(() => payload.financialMetrics.map(metric => metric.period_month).filter(Boolean).sort().pop() || null, [payload.financialMetrics]);
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
  const operations = useMemo(() => deriveOperationsSummary(payload.operationsMetrics || []), [payload.operationsMetrics]);
  const followups = useFollowups();
  const [followupDraft, setFollowupDraft] = useState<FollowupDraft | null>(null);
  const today = followups.data?.today || todayIso();
  const attentionFollowups = followups.data?.permissions.view ? { list: followups.data, onCreate: setFollowupDraft } : undefined;
  const openFollowups = followups.data?.followups.filter(item => item.status === 'abierto') || [];
  const lateFollowups = openFollowups.filter(item => isOverdue(item, today));
  const [pulse, pulseState] = useSiioData<FinancialPulse | null>(`/api/siio/financial-pulse${selectedPeriod ? `?period=${encodeURIComponent(selectedPeriod)}` : ''}`);
  const [commercial, commercialState] = useSiioData<CommercialSummary>('/api/siio/commercial-summary');
  // Lo que tiene fecha: seguimientos vencidos o por vencer (y su conteo de vencidos para la Portada).
  const estaSemana = useMemo(() => deriveEstaSemana({ commercial, followups: followups.data, today }), [commercial, followups.data, today]);
  const financeNotes = pulse ? pulseReadings(pulse).filter(text => !/provisión|^Enero cerró/.test(text)).slice(0, 2) : [];
  const alertBasis = (recommendation: { id: string; period?: string | null }) => recommendation.id === 'payroll-source-alert'
    ? `Nómina de ${formatPeriod(recommendation.period || snapshot.payrollPeriod).toLowerCase()}`
    : financialRows[0] ? `Estado de resultados, ${metricBasis(financialRows[0], selectedPeriod).current.toLowerCase()}` : 'Periodo financiero seleccionado';
  const torre = useTorreAvancys(pulse);
  const [pestana, setPestana] = useState<PestanaTorre>('portada');
  const refPestanas = useRef<HTMLElement | null>(null);
  const irA = (destino: PestanaTorre) => { setPestana(destino); refPestanas.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  // Lo que requiere decisión hoy: lo de Avancys (clientes, cartera, mes abierto) y lo comercial, en tarjetas.
  const alertas: AlertaTorre[] = (() => {
    const lista: AlertaTorre[] = [];
    const porDecidir = (commercial?.tenders.calendar || []).filter(item => item.attention === 'requiere_decision');
    if (porDecidir.length) {
      const dias = porDecidir.map(item => item.days_to_deadline).filter((valor): valor is number => valor !== null && valor >= 0);
      const minimo = dias.length ? Math.min(...dias) : null;
      lista.push({ clave: 'licitaciones', pestana: 'comercial', prioridad: minimo !== null && minimo <= PLAZO_ALTO ? 'alta' : 'media', responsable: 'Licitaciones',
        ...licitacionesPorDecidir(porDecidir) });
    }
    if (estaSemana.vencidos) lista.push({ clave: 'vencidos', pestana: 'comercial', prioridad: 'alta', responsable: 'Comercial',
      ficha: { valor: `${estaSemana.vencidos}`, unidad: estaSemana.vencidos === 1 ? 'vencida' : 'vencidas' },
      frase: <><strong>Registrar {estaSemana.vencidos === 1 ? 'la decisión que ya venció' : `las ${estaSemana.vencidos} decisiones que ya vencieron`}.</strong> Tenían fecha y no se registró qué se decidió.</> });
    // El forecast desactualizado es una de las cuatro cifras de la Portada (opción A): no se repite en esta lista.
    lista.push(...alertasDeAvancys(torre));
    const paradas = commercial?.pipeline.stale_large || [];
    if (paradas.length) lista.push({ clave: 'ofertas', pestana: 'comercial', prioridad: 'media', responsable: 'Comercial',
      ficha: { valor: millions(paradas.reduce((suma, item) => suma + (item.monthly_value || 0), 0)), unidad: 'al mes, paradas' },
      frase: <><strong>Retomar o descartar {paradas.length === 1 ? '1 oferta grande' : `${paradas.length} ofertas grandes`}.</strong> {enumerar([...paradas].sort((a, b) => b.monthly_value - a.monthly_value).slice(0, 2).map(item => `${nombreCorto(item.company_name)} (${millions(item.monthly_value)})`))}{paradas.length > 2 ? ', las mayores' : ''}; más de 30 días sin moverse.</> });
    return lista;
  })();
  const pipelinePortada = commercial?.pipeline;
  const forecastPortada = pipelinePortada?.open_count ? {
    abiertas: pipelinePortada.open_count, sinGestion: pipelinePortada.stale_count, dias: pipelinePortada.stale_days,
    nadie: (pipelinePortada.by_owner || []).filter(fila => fila.owner_name && fila.open > 0 && fila.stale === fila.open).map(fila => fila.owner_name as string),
  } : null;
  const validationLabel = snapshot.financialValidationStatus === 'validado' ? 'Validación humana registrada' : snapshot.financialValidationStatus === 'sin_datos' ? 'Sin datos publicados' : 'Pendiente de validación financiera';

  return <div className="stack">
    {/* La Torre por pantallas (contrato de la maqueta, Fase 3): la Portada es la primera pestaña — la frase del
        último mes cerrado, los tres bloques y lo que requiere decisión con fichas de plazo. Lo demás, una pestaña
        por pregunta. Lo que no ayuda a decidir no entra. */}
    <nav className="siio-navigation module-segmented-nav siio-pestanas" role="tablist" aria-label="Pantallas de la Torre" ref={refPestanas}>
      {PESTANAS.map(([clave, etiqueta]) => <button key={clave} type="button" role="tab" aria-selected={pestana === clave}
        className={pestana === clave ? 'active' : ''} onClick={() => setPestana(clave)}>{etiqueta}</button>)}
    </nav>

    {pestana === 'portada' ? <section role="tabpanel" aria-label="Portada">
      <SiioPortada t={torre} onIr={(destino, mes) => { if (mes) torre.setMes(mes); irA(destino); }} forecast={forecastPortada} />
      <SiioRequiereDecision alertas={alertas} onIr={irA} />
    </section> : null}

    {pestana === 'resultados' ? <section className="siio-pantalla" role="tabpanel" aria-label="Resultados"><SiioPestanaResultados t={torre} /></section> : null}
    {pestana === 'clientes' ? <section className="siio-pantalla" role="tabpanel" aria-label="Clientes">
      <SiioPestanaClientes t={torre} />
      {/* El servicio que se le presta al cliente va al lado de lo que deja: ARA en Bogotá, por ejemplo. El detalle de
          operaciones se mudó aquí desde Fuentes (poda de la Fase 1). */}
      <section className="siio-panel" aria-label="Cumplimiento del servicio">
        <h2>Cumplimiento del servicio</h2>
        <SiioOperationsAttention summary={operations} />
        <details className="siio-plegado">
          <summary>Operaciones · detalle por cliente y uso por regional</summary>
          <SiioOperationsDetail summary={operations} />
        </details>
      </section>
    </section> : null}
    {pestana === 'cartera' ? <section className="siio-pantalla" role="tabpanel" aria-label="Cartera"><SiioPestanaCartera t={torre} /></section> : null}
    {pestana === 'comercial' ? <section className="siio-pantalla" role="tabpanel" aria-label="Comercial y licitaciones">
      {followupDraft && followupDraft.origin_type !== 'recomendacion_ia' ? <FollowupComposer key={followupDraft.origin_ref || followupDraft.title} draft={followupDraft} onCancel={() => setFollowupDraft(null)} onSaved={() => { setFollowupDraft(null); void followups.reload(); }} /> : null}
      <SiioPestanaComercial summary={commercial} state={commercialState} semana={estaSemana} followups={attentionFollowups} today={today}
        abiertos={openFollowups.length} vencidos={lateFollowups.length} onVerSeguimientos={() => onNavigate(navigateSiioView('seguimiento'))} />
    </section> : null}
    {pestana === 'vigia' ? <section className="siio-pantalla" role="tabpanel" aria-label="Vig-IA">
      <SiioRecommendations canGenerate={['admin', 'gerencia'].includes(payload.currentProfile?.role)} followups={followups.data} today={today} onCreateFollowup={setFollowupDraft} />
      {followupDraft?.origin_type === 'recomendacion_ia' ? <FollowupComposer key={followupDraft.origin_ref || followupDraft.title} draft={followupDraft} onCancel={() => setFollowupDraft(null)} onSaved={() => { setFollowupDraft(null); void followups.reload(); }} /> : null}
    </section> : null}
    {pestana === 'parametros' ? <section className="siio-pantalla" role="tabpanel" aria-label="Parámetros"><SiioPestanaParametros creditos={torre.torre?.creditos ?? null} /></section> : null}
    {pestana === 'fuentes' ? <section className="siio-pantalla" role="tabpanel" aria-label="Fuentes y detalle">
      {/* Fuentes (contrato de la maqueta, Fase 3): primero quién tiene atrasado qué; después el Excel de Finanzas, que sigue
          siendo la fuente del cierre de los meses anteriores a Avancys, y el detalle plegado. Lo que duplicaba una
          pantalla en vivo salió en la poda de la Fase 1 (acumulado, ingreso y horas por cliente, concentración, devengado). */}
      <SiioFuentesAlDia t={torre} excelHasta={ultimoExcel ? ultimoExcel.slice(0, 7) : null}
        forecast={commercial ? { abiertas: commercial.pipeline.open_count, sin_gestion: commercial.pipeline.stale_count, dias: commercial.pipeline.stale_days } : null} />
      <div className="siio-dos-col">
        <section className="siio-panel" aria-label="El Excel de Finanzas">
          <h2>El Excel de Finanzas</h2>
          <p className="siio-nota" style={{ marginTop: 4 }}>Fuente del cierre oficial de los meses anteriores a Avancys y de la provisión de ingresos. Último publicado: <strong>{formatPeriod(ultimoExcel)}</strong>.</p>
          {fuentesExtra}
          <details className="siio-plegado">
            <summary>Detalle del Excel: lectura del mes y alertas</summary>
            <section className="siio-view-filters" aria-label="Periodo del Excel de Finanzas">
              <label>Periodo financiero
                <select value={routeState.filters.period} onChange={event => onNavigate(navigateSiioView('resumen', { ...routeState.filters, period: event.target.value }))}>
                  <option value="">Último periodo publicado ({formatPeriod(selectedPeriod)})</option>
                  {periodOptions.map(period => <option key={period} value={period}>{formatPeriod(period)}</option>)}
                </select>
              </label>
              <span className={`siio-chip ${snapshot.financialValidationStatus === 'validado' ? 'finanzas' : 'confirmar'}`}>{validationLabel}</span>
            </section>
            {snapshot.financialValidationStatus !== 'validado' ? <p className="siio-nota siio-preliminary-notice" role="status">Lectura preliminar — requiere validación financiera antes de usarse como conclusión ejecutiva.</p> : null}
            {financeNotes.length ? <ul className="siio-lista">{financeNotes.map(note => <li key={note}>{note}</li>)}</ul> : null}
            {recommendations.length ? <>
              <h3 className="siio-alerts-title">Alertas automáticas</h3>
              <p className="siio-nota">Reglas fijas del SIIO que se encienden cuando se cumple una condición; no son recomendaciones de una persona ni de la IA.</p>
              <ul className="siio-alert-list">{recommendations.map(recommendation => <li key={recommendation.id}>
                <strong>{recommendation.title}</strong>
                <span>{recommendation.finding}</span>
                <small>{alertBasis(recommendation)}</small>
                {attentionFollowups ? <FollowupCell existing={openFollowupFor(followups.data, `alerta:${recommendation.id}:${recommendation.period || ''}`)} today={today} canCreate={Boolean(followups.data?.permissions.create)} onCreate={() => setFollowupDraft({ title: `Revisar: ${recommendation.title.replace(/^Lectura preliminar: /, '')}`, owner_label: recommendation.id === 'payroll-source-alert' ? 'Gestión Humana' : 'Finanzas', due_date: addDays(today, 14), origin_type: 'finanzas', origin_ref: `alerta:${recommendation.id}:${recommendation.period || ''}`, origin_label: alertBasis(recommendation) })} /> : null}
              </li>)}</ul>
            </> : null}
            {financialRows.length ? <SiioFinancialPulse pulse={pulse} state={pulseState} financialRows={financialRows} /> : <EmptyState title="Sin métricas financieras publicadas" text="No hay indicadores para el periodo seleccionado." />}
          </details>
        </section>
        <section className="siio-panel" aria-label="Más detalle">
          <h2>Más detalle</h2>
          <details className="siio-plegado">
            <summary>Nómina agregada por área (sin datos individuales)</summary>
            <p className="siio-nota">Periodo de nómina: <strong>{formatPeriod(snapshot.payrollPeriod)}</strong> · millones de pesos{snapshot.payrollPeriod && selectedPeriod && snapshot.payrollPeriod !== selectedPeriod ? ` · el Excel va a ${formatPeriod(selectedPeriod).toLowerCase()}` : ''} · alertas de nómina agregadas: <strong>{payrollTotals.alerts}</strong>.</p>
            <section className="siio-view-filters" aria-label="Filtro de nómina agregada">
              <label>Área de nómina
                <select value={routeState.filters.area} onChange={event => onNavigate(navigateSiioView('resumen', { ...routeState.filters, area: event.target.value }))}>
                  <option value="">Todas las áreas</option>
                  {areaOptions.map(area => <option key={area} value={area}>{area}</option>)}
                </select>
              </label>
            </section>
            {/* Una sola representación (poda de la Fase 1): la tabla del kit, que en el celular se apila. */}
            {!payrollRows.length ? <p className="siio-nota"><strong>Sin agregados de nómina publicados.</strong> No se muestran datos individuales.</p> : <div className="siio-tabla-wrap"><table className="siio-tabla apilable">
              <thead><tr><th>Área</th><th className="num">Personas</th><th className="num">Devengado</th><th className="num">Deducciones</th><th className="num total">Neto</th></tr></thead>
              <tbody>{payrollRows.map(row => <tr key={`${row.period_month}:${row.area || 'sin-area'}`}>
                <td><span className="nombre">{row.area || 'Área pendiente'}</span>{row.alert ? <span className="siio-chip marca">validar fuente</span> : null}</td>
                <td className="num" data-etiqueta="Personas"><strong>{row.total_people || 0}</strong></td>
                <td className="num" data-etiqueta="Devengado"><strong>{payrollMillions(row.total_accrued)}</strong></td>
                <td className="num" data-etiqueta="Deducciones"><strong>{payrollMillions(row.total_deductions)}</strong></td>
                <td className="num total"><strong>{payrollMillions(row.net_total)}</strong></td>
              </tr>)}</tbody>
              <tfoot><tr><th>Total</th><th className="num" data-etiqueta="Personas">{payrollTotals.people}</th><th className="num" data-etiqueta="Devengado">{payrollMillions(payrollTotals.accrued)}</th><th className="num" data-etiqueta="Deducciones">{payrollMillions(payrollTotals.deductions)}</th><th className="num total">{payrollMillions(payrollTotals.net)}</th></tr></tfoot>
            </table></div>}
          </details>
          <details className="siio-plegado">
            <summary>Lo que falta para completar la Torre, y el dato que destraba cada cosa</summary>
            <SiioLoQueFalta summary={commercial} />
          </details>
        </section>
      </div>
    </section> : null}
  </div>;
}
