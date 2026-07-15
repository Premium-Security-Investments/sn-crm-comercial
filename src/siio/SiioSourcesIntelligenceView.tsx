import { useMemo } from 'react';
import { deriveSiioExecutiveSnapshot } from '../siioExecutive';
import { deriveRecommendations, filterSources, navigateSiioView, sourceFreshness, uniqueOptions } from './selectors';
import { Badge, EmptyState, Panel, fmtSiioDate } from './SiioUi';
import type { SiioBootstrapPayload, SiioRouteState } from './types';

const freshnessLabels = {
  vigente: 'Vigente',
  próxima_a_vencer: 'Próxima a vencer',
  vencida: 'Vencida',
  sin_fecha: 'Sin fecha de revisión',
} as const;

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
  const visibleSources = useMemo(() => filterSources(payload.sources, routeState.filters, snapshot.evidenceSourceIds), [payload.sources, routeState.filters, snapshot.evidenceSourceIds]);
  const freshnessOptions = useMemo(() => uniqueOptions(payload.sources.map(source => sourceFreshness(source))), [payload.sources]);
  const trustOptions = useMemo(() => uniqueOptions(payload.sources.map(source => source.trust_level)), [payload.sources]);
  const sourceTypeOptions = useMemo(() => uniqueOptions(payload.sources.map(source => source.source_type)), [payload.sources]);
  const changeFilter = <Key extends keyof typeof routeState.filters>(key: Key, value: typeof routeState.filters[Key]) => {
    onNavigate(navigateSiioView('inteligencia', { ...routeState.filters, [key]: value }));
  };

  return <div className="stack">
    <section className="siio-view-filters" aria-label="Filtros de fuentes e inteligencia">
      <label>Vigencia
        <select value={routeState.filters.freshness} onChange={event => changeFilter('freshness', event.target.value)}>
          <option value="">Todas las vigencias</option>
          {freshnessOptions.map(option => <option key={option} value={option}>{freshnessLabels[option as keyof typeof freshnessLabels] || option}</option>)}
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

    <Panel title="Fuentes de evidencia de los periodos mostrados">
      {!visibleSources.length ? <EmptyState title="Sin fuentes de evidencia para los filtros seleccionados" text="No hay fuentes vinculadas al periodo financiero seleccionado ni al periodo de nómina mostrado que coincidan con la vigencia, confianza y tipo seleccionados." /> : <div className="siio-insight-list">
        {visibleSources.map(source => <article className="siio-insight" key={source.id}>
          <header><div><span className="eyebrow">{source.id}</span><h3>{source.name}</h3></div><Badge tone={sourceFreshness(source) === 'vencida' ? 'danger' : sourceFreshness(source) === 'próxima_a_vencer' ? 'amber' : 'green'}>{freshnessLabels[sourceFreshness(source)]}</Badge></header>
          <div className="siio-insight-detail">
            <div><strong>Tipo</strong><span>{source.source_type || 'Pendiente'}</span></div>
            <div><strong>Confianza</strong><span>{source.trust_level || 'Pendiente'}</span></div>
            <div><strong>Última revisión</strong><span>{fmtSiioDate(source.last_reviewed_at)}</span></div>
            <div><strong>Próxima revisión</strong><span>{fmtSiioDate(source.next_review_at)}</span></div>
            <div><strong>Frecuencia de actualización</strong><span>{source.update_frequency || 'Pendiente'}</span></div>
            <div><strong>Restricciones</strong><span>{source.restrictions || 'Sin restricciones registradas'}</span></div>
            <div><strong>Frentes relacionados</strong><span>{source.related_fronts?.length ? source.related_fronts.join(', ') : 'Sin frente relacionado'}</span></div>
            <div><strong>Estado de la fuente</strong><span>{source.status || 'Pendiente'}</span></div>
          </div>
          {source.url ? <a href={source.url} target="_blank" rel="noreferrer">Consultar fuente externa</a> : null}
        </article>)}
      </div>}
    </Panel>

    <Panel title="Razonamiento y recomendaciones">
      {!recommendations.length ? <EmptyState title="Sin recomendaciones disponibles" text="F5 no emitirá recomendaciones hasta contar con evidencia suficiente." /> : <div className="siio-insight-list">
        {recommendations.map(recommendation => {
          const sourceNames = recommendation.sourceIds.map(sourceId => sourceId === 'Pendiente de evidencia' ? 'Pendiente de evidencia' : `${sourceNameById(payload.sources, sourceId)} (${sourceId})`);
          return <article className={`siio-insight siio-insight-${recommendation.tone}`} key={recommendation.id}>
            <header><div><span className="eyebrow">{recommendation.front} · {recommendation.priority}</span><h3>{recommendation.title}</h3></div></header>
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
