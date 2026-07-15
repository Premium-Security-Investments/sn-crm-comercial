import { TenderRadarView } from './TenderRadarView';
import { TenderTrackingView } from './TenderTrackingView';
import { TenderDossiersView } from './TenderDossiersView';
import { TenderProfilesView } from './TenderProfilesView';
import { TenderModuleTabs } from './components/TenderModuleTabs';
import type { TendersModuleProps } from './types';

/** Route-level composition; every view owns its data contract. */
export function TendersModule(props: TendersModuleProps) {
  return <section className="stack tenders-page" aria-label="Módulo de licitaciones">
    <TenderModuleTabs active={props.view} navigate={props.navigate} />
    {props.view === 'radar' && <TenderRadarView {...props} />}
    {props.view === 'seguimiento' && <TenderTrackingView {...props} />}
    {props.view === 'expedientes' && <TenderDossiersView {...props} />}
    {props.view === 'perfiles' && <TenderProfilesView {...props} />}
  </section>;
}
