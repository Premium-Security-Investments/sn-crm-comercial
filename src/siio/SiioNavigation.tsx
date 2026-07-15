import type { SiioView } from './types';

const items: ReadonlyArray<{ view: SiioView; label: string }> = [
  { view: 'resumen', label: 'Resumen ejecutivo' },
  { view: 'seguimiento', label: 'Seguimiento gerencial' },
  { view: 'inteligencia', label: 'Fuentes e inteligencia' },
  { view: 'agentes', label: 'Agentes' },
];

export function SiioNavigation({ activeView, onSelect }: { activeView: SiioView; onSelect: (view: SiioView) => void }) {
  return <nav className="siio-navigation module-segmented-nav" aria-label="Navegación SIIO">
    {items.map(({ view, label }) => <button
      type="button"
      key={view}
      className={activeView === view ? 'active' : ''}
      aria-current={activeView === view ? 'page' : undefined}
      onClick={() => onSelect(view)}
    >{label}</button>)}
  </nav>;
}
