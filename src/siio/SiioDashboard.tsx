import { useEffect, useMemo, useState } from 'react';
import './siio.css';
import { api } from '../apiClient';
import { isReadOnlyRole } from '../../access-control.js';
import { isDirectiveViewerRole } from '../navPermissions';
import { deriveSiioExecutiveSnapshot } from '../siioExecutive';
import { deriveRecommendations, deriveTrackingItems, navigateSiioView, parseSiioRouteState, toSiioHash } from './selectors';
import { SiioExecutiveView } from './SiioExecutiveView';
import { SiioFinancialImportPanel } from './SiioFinancialImportPanel';
import { SiioAgentsView } from './SiioAgentsView';
import { SiioBoardDraftAction } from './SiioBoardDraftAction';
import { SiioBoardReadonlyView } from './SiioBoardReadonlyView';
import { SiioManagementTrackingView } from './SiioManagementTrackingView';
import { SiioNavigation } from './SiioNavigation';
import { SiioSourcesIntelligenceView } from './SiioSourcesIntelligenceView';
import type { SiioBootstrapPayload, SiioCurrentProfile, SiioRouteState, SiioView } from './types';

// Etiqueta legible del perfil en el encabezado de la Torre de Control (antes salía el código interno, p. ej. "admin").
const SIIO_ROLE_LABELS: Record<string, string> = { admin: 'Administrador', gerencia: 'Gerencia', director: 'Directivo', consulta: 'Directivo de solo consulta', junta: 'Junta' };

export function SiioDashboard({ currentProfile }: { currentProfile: SiioCurrentProfile }) {
  const [payload, setPayload] = useState<SiioBootstrapPayload | null>(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [boardDraftOpen, setBoardDraftOpen] = useState(false);
  const [routeState, setRouteState] = useState<SiioRouteState>(() => parseSiioRouteState(window.location.hash));
  const selectedFinancialPeriod = routeState.view === 'resumen' || routeState.view === 'inteligencia' ? routeState.filters.period : '';
  const snapshot = useMemo(() => payload ? deriveSiioExecutiveSnapshot({
    financialMetrics: payload.financialMetrics,
    payrollAggregates: payload.payrollAggregates,
    sources: payload.sources,
  }, selectedFinancialPeriod) : null, [payload, selectedFinancialPeriod]);
  const trackingItems = useMemo(() => payload ? deriveTrackingItems(payload.records, payload.decisions) : [], [payload]);
  const recommendations = useMemo(() => snapshot ? deriveRecommendations(snapshot) : [], [snapshot]);

  const load = async () => {
    setLoading(true);
    setStatus('Cargando SIIO / Gestión Gerencial y Control…');
    try {
      setPayload(await api<SiioBootstrapPayload>('/api/siio/bootstrap'));
      setStatus('');
    } catch (error) {
      setPayload(null);
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const onHashChange = () => setRouteState(parseSiioRouteState(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (!isDirectiveViewerRole(currentProfile.role) && currentProfile.role !== 'junta') return;
    void load();
  }, [currentProfile.role]);

  const selectView = (view: SiioView) => {
    window.location.hash = toSiioHash(navigateSiioView(view));
  };
  const onNavigate = (state: SiioRouteState) => {
    window.location.hash = toSiioHash(state);
  };

  // El directivo de solo consulta ve la vista gerencial completa (no la de junta), sin acciones de escritura.
  const readOnly = isReadOnlyRole(currentProfile.role);
  if (!isDirectiveViewerRole(currentProfile.role)) {
    if (currentProfile.role === 'junta') return <SiioBoardReadonlyView payload={payload} loading={loading} status={status} onRetry={load} />;
    return <section className="stack"><div className="error">SIIO / Gestión Gerencial y Control es una visual gerencial. Tu perfil actual no tiene acceso.</div></section>;
  }

  return <section className="stack siio-dashboard">
    <section className="executive-hero">
      <div><span className="eyebrow">SIIO — Sistema Interno de Inteligencia Operativa</span><h2>Información para la dirección</h2><p>Resultados financieros, nómina agregada, señales comerciales, riesgos, decisiones, fuentes y trazabilidad en un solo lugar.</p></div>
      <div className="hero-facts"><div><small>Perfil</small><strong>{SIIO_ROLE_LABELS[currentProfile.role] || currentProfile.role}</strong></div>{!readOnly && <button type="button" onClick={() => setBoardDraftOpen(true)}>Preparar informe de Junta</button>}</div>
    </section>
    {status && <div className={status.includes('permiso') || status.includes('Error') ? 'error' : 'notice'}>{status}</div>}
    <SiioNavigation activeView={routeState.view} onSelect={selectView} />
    {!payload ? <div className="notice">Cargando vista gerencial…</div> : routeState.view === 'resumen'
      ? <><SiioFinancialImportPanel canImport={['admin', 'gerencia'].includes(currentProfile.role)} onPublished={load} /><SiioExecutiveView payload={payload} routeState={routeState} onNavigate={onNavigate} /></>
      : routeState.view === 'seguimiento'
        ? <SiioManagementTrackingView payload={payload} routeState={routeState} onNavigate={onNavigate} />
        : routeState.view === 'inteligencia'
          ? <SiioSourcesIntelligenceView payload={payload} routeState={routeState} onNavigate={onNavigate} />
          : <SiioAgentsView payload={payload} routeState={routeState} onNavigate={onNavigate} />}
    {payload && snapshot && !readOnly ? <SiioBoardDraftAction open={boardDraftOpen} onClose={() => setBoardDraftOpen(false)} payload={payload} snapshot={snapshot} trackingItems={trackingItems} recommendations={recommendations} /> : null}
  </section>;
}
