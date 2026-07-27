import { canConfigureTenders } from '../permissions';
import type { TenderCurrentProfile, TenderModuleView } from '../types';
import { TenderModuleTabs } from './TenderModuleTabs';

export function TenderModuleNavigation({ active, navigate, currentProfile }: {
  active: TenderModuleView;
  navigate: (hash: string) => void;
  currentProfile: TenderCurrentProfile | null | undefined;
}) {
  const canConfigure = canConfigureTenders(currentProfile);
  return <div className="tender-module-navigation">
    <TenderModuleTabs active={active} navigate={navigate} />
    {canConfigure && <button type="button" className="link-button tender-configuration-link" onClick={() => navigate('#/tenders?view=configuracion')}>Configuración</button>}
  </div>;
}
