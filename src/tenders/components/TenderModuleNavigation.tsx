import { canConfigureTenders, canManageTenderLessons } from '../permissions';
import type { TenderCurrentProfile, TenderModuleView } from '../types';
import { TenderModuleTabs } from './TenderModuleTabs';

export function TenderModuleNavigation({ active, navigate, currentProfile }: {
  active: TenderModuleView;
  navigate: (hash: string) => void;
  currentProfile: TenderCurrentProfile | null | undefined;
}) {
  const canConfigure = canConfigureTenders(currentProfile);
  const canManageLessons = canManageTenderLessons(currentProfile);
  return <div className="tender-module-navigation">
    <TenderModuleTabs active={active} navigate={navigate} />
    {/* Orden y lugar (Juan, 2026-11-10): Empresa, Aliados y Lecciones, juntos y alineados a la derecha. */}
    <div className="tender-module-actions">
      {/* Información base de la empresa (Juan, 2026-10-13): botón visible "Empresa" en vez del enlace "Configuración". */}
      {canConfigure && <button type="button" className={`secondary tender-configuration-link tender-company-button${active === 'configuracion' ? ' is-active' : ''}`} aria-pressed={active === 'configuracion'} onClick={() => navigate('#/tenders?view=configuracion')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" /><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" /><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" /><path d="M10 6h4M10 10h4M10 14h4M10 18h4" /></svg>
        Empresa
      </button>}
      {/* Aliados para uniones temporales (Juan, 2026-11-09): al lado de «Empresa» y «Lecciones»; lo ve quien entra a Licitaciones. */}
      <button type="button" className={`secondary tender-configuration-link tender-company-button${active === 'aliados' ? ' is-active' : ''}`} aria-pressed={active === 'aliados'} onClick={() => navigate('#/tenders?view=aliados')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
        Aliados
      </button>
      {/* Lecciones de la empresa (Juan, 2026-11-07): al lado de «Empresa», sólo para quien tiene el permiso de lecciones. */}
      {canManageLessons && <button type="button" className={`secondary tender-configuration-link tender-company-button${active === 'lecciones' ? ' is-active' : ''}`} aria-pressed={active === 'lecciones'} onClick={() => navigate('#/tenders?view=lecciones')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /><path d="M9 7h7M9 11h5" /></svg>
        Lecciones
      </button>}
    </div>
  </div>;
}
