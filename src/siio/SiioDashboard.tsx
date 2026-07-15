import { useEffect, useMemo, useState } from 'react';
import { api } from '../apiClient';
import { isManagementRole } from '../navPermissions';
import { deriveSiioExecutiveSnapshot } from '../siioExecutive';
import { deriveRecommendations, deriveTrackingItems, navigateSiioView, parseSiioRouteState, toSiioHash } from './selectors';
import { SiioExecutiveView } from './SiioExecutiveView';
import { SiioAgentsView } from './SiioAgentsView';
import { SiioBoardDraftAction } from './SiioBoardDraftAction';
import { SiioManagementTrackingView } from './SiioManagementTrackingView';
import { SiioNavigation } from './SiioNavigation';
import { SiioSourcesIntelligenceView } from './SiioSourcesIntelligenceView';
import type { SiioBootstrapPayload, SiioCurrentProfile, SiioRouteState, SiioView } from './types';

export function SiioDashboard({ currentProfile }: { currentProfile: SiioCurrentProfile }) {
  const [payload, setPayload] = useState<SiioBootstrapPayload | null>(null);
  const [status, setStatus] = useState('');
  const [boardDraftOpen, setBoardDraftOpen] = useState(false);
  const [routeState, setRouteState] = useState<SiioRouteState>(() => parseSiioRouteState(window.location.hash));
  const snapshot = useMemo(() => payload ? deriveSiioExecutiveSnapshot({
    financialMetrics: payload.financialMetrics,
    payrollAggregates: payload.payrollAggregates,
    sources: payload.sources,
  }) : null, [payload]);
  const trackingItems = useMemo(() => payload ? deriveTrackingItems(payload.records, payload.decisions) : [], [payload]);
  const recommendations = useMemo(() => snapshot ? deriveRecommendations(snapshot) : [], [snapshot]);

  const load = async () => {
    setStatus('Cargando SIIO / Gestión Gerencial y Control…');
    try {
      setPayload(await api<SiioBootstrapPayload>('/api/siio/bootstrap'));
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    const onHashChange = () => setRouteState(parseSiioRouteState(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (!isManagementRole(currentProfile.role)) return;
    void load();
  }, [currentProfile.role]);

  const selectView = (view: SiioView) => {
    window.location.hash = toSiioHash(navigateSiioView(view));
  };
  const onNavigate = (state: SiioRouteState) => {
    window.location.hash = toSiioHash(state);
  };

  if (!isManagementRole(currentProfile.role)) {
    return <section className="stack"><div className="error">SIIO / Gestión Gerencial y Control es una visual gerencial. Tu perfil actual no tiene acceso.</div></section>;
  }

  return <section className="stack siio-dashboard">
    <section className="executive-hero">
      <div><span className="eyebrow">SIIO · Sistema Integrado de Información Operativa</span><h2>Centro de Control Gerencial</h2><p>Información permanente para dirección: resultados financieros, nómina agregada, señales comerciales, riesgos, decisiones, fuentes y trazabilidad.</p></div>
      <div className="hero-facts"><div><small>Perfil</small><strong>{currentProfile.role}</strong></div><button type="button" onClick={() => setBoardDraftOpen(true)}>Preparar informe de Junta</button></div>
    </section>
    {status && <div className={status.includes('permiso') || status.includes('Error') ? 'error' : 'notice'}>{status}</div>}
    <SiioNavigation activeView={routeState.view} onSelect={selectView} />
    {!payload ? <div className="notice">Cargando vista gerencial…</div> : routeState.view === 'resumen'
      ? <SiioExecutiveView payload={payload} routeState={routeState} onNavigate={onNavigate} />
      : routeState.view === 'seguimiento'
        ? <SiioManagementTrackingView payload={payload} routeState={routeState} onNavigate={onNavigate} />
        : routeState.view === 'inteligencia'
          ? <SiioSourcesIntelligenceView payload={payload} routeState={routeState} onNavigate={onNavigate} />
          : <SiioAgentsView payload={payload} routeState={routeState} onNavigate={onNavigate} />}
    {payload && snapshot ? <SiioBoardDraftAction open={boardDraftOpen} onClose={() => setBoardDraftOpen(false)} payload={payload} snapshot={snapshot} trackingItems={trackingItems} recommendations={recommendations} /> : null}
  </section>;
}
