import { useEffect, useRef, useState } from 'react';
import {
  Bot, Briefcase, CalendarClock, ChevronDown, FileCheck2, Gauge, LayoutDashboard, LogOut, Eye, Radar, RefreshCw, ShieldCheck, Sun, Target,
  type LucideIcon,
} from 'lucide-react';

// Íconos del menú lateral, los mismos de SIIO Programación (lucide-react), por destino (Juan, 2026-10-13).
const NAV_ICONS: Record<string, LucideIcon> = {
  '#/siio': Gauge,
  '#/home': Sun,
  '#/dashboard2': LayoutDashboard,
  '#/opportunities': Briefcase,
  '#/goals': Target,
  '#/tenders?view=radar': Radar,
  '#/tenders?view=seguimiento': Eye,
  '#/tenders?view=oportunidades': FileCheck2,
  '#/agents': Bot,
  '#/users': ShieldCheck,
  // Programación de turnos (aplicación aparte).
  'https://main.dud08epu9vf89.amplifyapp.com': CalendarClock,
};

export function NavIcon({ href }: { href: string }) {
  const Icon = NAV_ICONS[href];
  return Icon ? <Icon size={18} strokeWidth={1.8} aria-hidden="true" className="nav-icon" /> : <span className="nav-icon" aria-hidden="true" />;
}

const initials = (name: string) => name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase() || '').join('') || '·';

/**
 * Perfil de la sesión arriba a la derecha (Juan, 2026-10-13): antes ocupaba el pie del menú lateral. El botón
 * muestra iniciales y nombre; al abrirlo, correo, rol, el cambio de vista (si aplica), Actualizar y Salir.
 */
export function UserMenu({ name, email, role, viewMode, onChangeViewMode, onRefresh, onSignOut }: {
  name: string; email: string; role: string;
  viewMode?: 'admin' | 'comercial'; onChangeViewMode?: (mode: 'admin' | 'comercial') => void;
  onRefresh: () => void; onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return <div className="user-menu" ref={ref}>
    <button type="button" className="user-menu-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className="user-avatar" aria-hidden="true">{initials(name || email)}</span>
      <span className="user-menu-name">{name || email}</span>
      <ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && <div className="user-menu-panel" role="menu">
      <div className="user-menu-identity"><strong>{name || email}</strong>{name && email && <span>{email}</span>}<span>{role}</span></div>
      {viewMode && onChangeViewMode && <div className="user-menu-view" role="group" aria-label="Modo de vista">
        <button type="button" role="menuitemradio" aria-checked={viewMode === 'admin'} className={viewMode === 'admin' ? 'active' : ''} onClick={() => onChangeViewMode('admin')}>Vista Admin</button>
        <button type="button" role="menuitemradio" aria-checked={viewMode === 'comercial'} className={viewMode === 'comercial' ? 'active' : ''} onClick={() => onChangeViewMode('comercial')}>Vista Comercial</button>
      </div>}
      <button type="button" role="menuitem" className="user-menu-item" onClick={() => { setOpen(false); onRefresh(); }}><RefreshCw size={16} aria-hidden="true" />Actualizar datos</button>
      <button type="button" role="menuitem" className="user-menu-item is-exit" onClick={onSignOut}><LogOut size={16} aria-hidden="true" />Salir</button>
    </div>}
  </div>;
}
