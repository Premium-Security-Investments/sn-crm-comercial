import { useMemo } from 'react';
import { deriveSiioExecutiveSnapshot } from '../siioExecutive';
import { deriveRecommendations, deriveSourceAssessment, filterSources, navigateSiioView, uniqueOptions } from './selectors';
import { deriveCalidadFuentes, ETIQUETAS_ESTADO, resumenCalidad, type EstadoFuente } from './fuentesCalidad';
import { Badge, EmptyState, Panel, fmtSiioDate } from './SiioUi';
import type { SiioBootstrapPayload, SiioRouteState } from './types';

// La vigencia se calcula contra el último dato real de cada fuente; ya no se lee de una fecha
// escrita a mano que nadie llenaba.
const TONO_ESTADO: Record<EstadoFuente, 'green' | 'amber' | 'danger' | 'blue'> = {
  al_dia: 'green',
  atrasada: 'danger',
  sin_cadencia: 'blue',
  sin_dato: 'amber',
  historica: 'blue',
  antecedente: 'blue',
};

function sourceNameById(sources: SiioBootstrapPayload['sources'], sourceId: string) {
  return sources.find(source => source.id === sourceId)?.name || 'Pendiente de evidencia';
}

export function SiioSourcesIntelligenceView({ payload, routeState, onNavigate }: { payload: SiioBootstrapPayload; routeState: Extract<SiioRouteState, { view: 'inteligencia' }>; onNavigate: (state: SiioRouteState) => void }) {
  const snapshot = useMemo(() => deriveSiioExecutiveSnapshot({
    financialMetrics: payload.financialMetrics,
    payrollAggregates: payload.payrollAggregates,
    sources: payload.sources,
  }, routeState.filters.period), [payload.financialMetrics, payload.payrollAggregates, payload.sources, routeState.filters.period]);
  const recommendations = useMemo(() => deriveRecommendations(snapshot), [snapshot]);
  // La vigencia ya no se filtra aquí: filterSources la evaluaría contra la fecha escrita a mano.
  // Se filtra después, contra el estado calculado.
  const visibleSources = useMemo(() => filterSources(payload.sources, { ...routeState.filters, freshness: '' }), [payload.sources, routeState.filters]);
  const calidad = useMemo(() => deriveCalidadFuentes({
    sources: visibleSources,
    financialMetrics: payload.financialMetrics,
    payrollAggregates: payload.payrollAggregates,
    operationsMetrics: payload.operationsMetrics,
    programacionHoras: payload.programacionHoras,
    evidenceSourceIds: snapshot.evidenceSourceIds,
  }), [visibleSources, payload.financialMetrics, payload.payrollAggregates, payload.operationsMetrics, payload.programacionHoras, snapshot.evidenceSourceIds]);
  const calidadVisible = useMemo(
    () => (routeState.filters.freshness ? calidad.filter(fila => ETIQUETAS_ESTADO[fila.estado] === routeState.filters.freshness) : calidad),
    [calidad, routeState.filters.freshness],
  );
  const conteo = useMemo(() => resumenCalidad(calidad), [calidad]);
  const freshnessOptions = useMemo(() => uniqueOptions(Object.values(ETIQUETAS_ESTADO)), []);
  const trustOptions = useMemo(() => uniqueOptions(payload.sources.map(source => source.trust_level)), [payload.sources]);
  const sourceTypeOptions = useMemo(() => uniqueOptions(payload.sources.map(source => source.source_type)), [payload.sources]);
  const changeFilter = <Key extends keyof typeof routeState.filters>(key: Key, value: typeof routeState.filters[Key]) => {
    onNavigate(navigateSiioView('inteligencia', { ...routeState.filters, [key]: value }));
  };

  return <div className="stack">
    <section className="siio-view-filters" aria-label="Filtros de fuentes e inteligencia">
      <label>Estado del dato
        <select value={routeState.filters.freshness} onChange={event => changeFilter('freshness', event.target.value)}>
          <option value="">Todos los estados</option>
          {freshnessOptions.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label>Confianza
        <select value={routeState.filters.trust} onChange={event => changeFilter('trust', event.target.value)}>
          <option value="">Todos los niveles</option>
          {trustOptions.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label>Tipo de fuente
        <select value={routeState.filters.sourceType} onChange={event => changeFilter('sourceType', event.target.value)}>
          <option value="">Todos los tipos</option>
          {sourceTypeOptions.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    </section>

    <Panel title="Fuentes del SIIO">
      <p className="siio-pulse-footnote">
        {conteo.total} fuentes registradas: {conteo.atrasadas} atrasadas, {conteo.alDia} al día, {conteo.sinDato} sin alimentar todavía la Torre y {conteo.antecedentes} antecedentes.
        {' '}El estado no se escribe a mano: se calcula comparando la frecuencia que cada fuente declara con la fecha del último dato que puso en la Torre.
      </p>
      {!calidadVisible.length ? <EmptyState title="Sin fuentes para los filtros seleccionados" text="Ninguna fuente registrada coincide con el estado, la confianza y el tipo seleccionados." /> : <div className="siio-insight-list">
        {calidadVisible.map(({ fuente: source, ...fila }) => {
          const assessment = deriveSourceAssessment(source);
          return <article className="siio-insight" key={source.id}>
            <header><div><span className="siio-eyebrow">{source.id}{fila.alimentaLoMostrado ? ' · alimenta las cifras mostradas' : ''}</span><h3>{source.name}</h3></div><Badge tone={TONO_ESTADO[fila.estado]}>{ETIQUETAS_ESTADO[fila.estado]}</Badge></header>
            <p>{fila.lectura}</p>
            <div className="siio-insight-detail">
              <div><strong>Disponibilidad</strong><span>{assessment.availability}</span></div>
              <div><strong>Validación / confianza</strong><span>{assessment.validation}</span></div>
              <div><strong>Aplicabilidad</strong><span>{assessment.applicability}</span></div>
              <div><strong>Cumplimiento</strong><span>{assessment.compliance}</span></div>
            </div>
            <div className="siio-insight-detail">
              <div><strong>Tipo</strong><span>{source.source_type || 'Pendiente'}</span></div>
              <div><strong>Último dato en la Torre</strong><span>{fila.ultimoDato ? fmtSiioDate(fila.ultimoDato) : 'Ninguno'}</span></div>
              <div><strong>Registrada el</strong><span>{fmtSiioDate(source.last_reviewed_at)}</span></div>
              <div><strong>Frecuencia de actualización</strong><span>{source.update_frequency || 'Pendiente'}</span></div>
              <div><strong>Restricciones</strong><span>{source.restrictions || 'Sin restricciones registradas'}</span></div>
              <div><strong>Frentes relacionados</strong><span>{source.related_fronts?.length ? source.related_fronts.join(', ') : 'Sin frente relacionado'}</span></div>
            </div>
            {source.url ? <a href={source.url} target="_blank" rel="noreferrer">Consultar fuente externa</a> : null}
          </article>;
        })}
      </div>}
    </Panel>

    <Panel title="Razonamiento y recomendaciones">
      {!recommendations.length ? <EmptyState title="Sin recomendaciones disponibles" text="F5 no emitirá recomendaciones hasta contar con evidencia suficiente." /> : <div className="siio-insight-list">
        {recommendations.map(recommendation => {
          const sourceNames = recommendation.sourceIds.map(sourceId => sourceId === 'Pendiente de evidencia' ? 'Pendiente de evidencia' : `${sourceNameById(payload.sources, sourceId)} (${sourceId})`);
          return <article className={`siio-insight siio-insight-${recommendation.tone}`} key={recommendation.id}>
            <header><div><span className="siio-eyebrow">{recommendation.front} · {recommendation.priority}</span><h3>{recommendation.title}</h3></div></header>
            <p>{recommendation.finding}</p>
            <div className="siio-insight-detail">
              <div><strong>Evidencia</strong><span>{recommendation.evidence || 'Pendiente de evidencia'}</span></div>
              <div><strong>Fuentes</strong><span>{sourceNames.join(', ')}</span></div>
              <div><strong>Periodo de origen</strong><span>{recommendation.period || 'Periodo pendiente'}</span></div>
              <div><strong>Acción recomendada</strong><span>{recommendation.action}</span></div>
            </div>
          </article>;
        })}
      </div>}
    </Panel>
  </div>;
}
