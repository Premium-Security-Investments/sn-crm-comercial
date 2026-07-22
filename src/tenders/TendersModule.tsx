import { TenderRadarView } from './TenderRadarView';
import { TenderTrackingView } from './TenderTrackingView';
import { TenderOpportunitiesView } from './TenderOpportunitiesView';
import { TenderProfilesView } from './TenderProfilesView';
import { TenderModuleTabs } from './components/TenderModuleTabs';
import type { TendersModuleProps } from './types';

/** Route-level composition; every view owns its data contract. */
export function TendersModule(props: TendersModuleProps) {
  const moduleNavigation = <TenderModuleTabs active={props.view} navigate={props.navigate} />;
  return <section className="stack tenders-page" aria-label="Módulo de licitaciones">
    {props.view === 'radar' && <TenderRadarView {...props} moduleNavigation={moduleNavigation} />}
    {props.view === 'seguimiento' && <TenderTrackingView {...props} moduleNavigation={moduleNavigation} />}
    {props.view === 'oportunidades' && <TenderOpportunitiesView {...props} moduleNavigation={moduleNavigation} />}
    {props.view === 'configuracion' && <TenderProfilesView {...props} moduleNavigation={moduleNavigation} />}
  </section>;
}
