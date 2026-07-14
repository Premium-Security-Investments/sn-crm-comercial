import { TenderRadarView } from './TenderRadarView';
import { TenderTrackingView } from './TenderTrackingView';
import { TenderDossiersView } from './TenderDossiersView';
import { TenderProfilesView } from './TenderProfilesView';
import { TenderModuleTabs } from './components/TenderModuleTabs';
import type { TendersModuleProps } from './types';

/**
 * Route-level composition only: data loading stays in the currently proven
 * tender board until each view can own that behavior in a later migration.
 */
export function TendersModule(props: TendersModuleProps) {
  // Kept explicit so the transitional adapter remains visible at the boundary.
  const { renderLegacy } = props;
  return <section className="stack tenders-page" aria-label="Módulo de licitaciones">
    <TenderModuleTabs active={props.view} navigate={props.navigate} />
    {props.view === 'radar' && <TenderRadarView {...props} renderLegacy={renderLegacy} />}
    {props.view === 'seguimiento' && <TenderTrackingView {...props} />}
    {props.view === 'expedientes' && <TenderDossiersView {...props} renderLegacy={renderLegacy} />}
    {props.view === 'perfiles' && <TenderProfilesView {...props} renderLegacy={renderLegacy} />}
  </section>;
}
