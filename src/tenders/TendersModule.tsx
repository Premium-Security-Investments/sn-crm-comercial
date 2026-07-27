import { TenderRadarView } from './TenderRadarView';
import { TenderTrackingView } from './TenderTrackingView';
import { TenderOpportunitiesView } from './TenderOpportunitiesView';
import { TenderConfigurationView } from './TenderConfigurationView';
import { canConfigureTenders } from './permissions';
import { TenderModuleNavigation } from './components/TenderModuleNavigation';
import type { TendersModuleProps } from './types';

/** Route-level composition; every view owns its data contract. */
export function TendersModule(props: TendersModuleProps) {
  const canConfigure = canConfigureTenders(props.data.currentProfile);
  const moduleNavigation = <TenderModuleNavigation
    active={props.view}
    navigate={props.navigate}
    currentProfile={props.data.currentProfile}
  />;
  return <section className="stack tenders-page" aria-label="Módulo de licitaciones">
    {props.view === 'radar' && <TenderRadarView {...props} moduleNavigation={moduleNavigation} />}
    {props.view === 'seguimiento' && <TenderTrackingView {...props} moduleNavigation={moduleNavigation} />}
    {props.view === 'oportunidades' && <TenderOpportunitiesView {...props} moduleNavigation={moduleNavigation} />}
    {props.view === 'configuracion' && <TenderConfigurationView {...props} moduleNavigation={moduleNavigation} canConfigure={canConfigure} />}
  </section>;
}
