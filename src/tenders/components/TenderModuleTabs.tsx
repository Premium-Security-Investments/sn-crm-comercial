import type { TenderModuleView } from '../types';

const views: Array<{ view: TenderModuleView; label: string }> = [
  { view: 'radar', label: 'Radar de oportunidades' },
  { view: 'seguimiento', label: 'Seguimiento' },
  { view: 'oportunidades', label: 'Oportunidades' },
];

export function TenderModuleTabs({ active, navigate }: { active: TenderModuleView; navigate: (hash: string) => void }) {
  return <nav className="tender-module-tabs module-segmented-nav" aria-label="Vistas de licitaciones">
    {views.map(({ view, label }) => {
      const hash = `#/tenders?view=${view}`;
      return <button
        type="button"
        key={view}
        aria-current={active === view ? 'page' : undefined}
        className={active === view ? 'active' : ''}
        onClick={() => navigate(hash)}
      >{label}</button>;
    })}
  </nav>;
}
