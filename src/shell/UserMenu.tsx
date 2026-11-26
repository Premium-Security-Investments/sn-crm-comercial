import { useEffect, useRef, useState } from 'react';
import {
  Bot, Briefcase, Building2, CalendarClock, Calculator, ChevronDown, ClipboardCheck, FileCheck2, Gauge, LayoutDashboard, LogOut, Eye, MessageCircle, Radar, RefreshCw, Scale, ShieldCheck, Sun, Target,
  type LucideIcon,
} from 'lucide-react';

// Íconos del menú lateral, los mismos de SIIO Programación (lucide-react), por destino (Juan, 2026-10-13).
const NAV_ICONS: Record<string, LucideIcon> = {
  '#/siio': Gauge,
  '#/modelos': Scale,
  '#/home': Sun,
  '#/dashboard2': LayoutDashboard,
  '#/clients': Building2,
  '#/opportunities': Briefcase,
  '#/cotizar': Calculator,
  '#/goals': Target,
  '#/tenders?view=radar': Radar,
  '#/tenders?view=seguimiento': Eye,
  '#/tenders?view=oportunidades': FileCheck2,
  '#/estudios': ClipboardCheck,
  '#/agents': Bot,
  '#/users': ShieldCheck,
  // Programación de turnos (aplicación aparte).
  '#/programacion': CalendarClock,
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
export function UserMenu({ name, email, role, whatsapp, onSaveWhatsapp, viewMode, onChangeViewMode, onRefresh, onSignOut }: {
  name: string; email: string; role: string;
  // Juan, 2026-11-25: cada uno edita su propio WhatsApp (sale en la propuesta de Cotizar). Sin `onSaveWhatsapp`, no se ofrece.
  whatsapp?: string | null; onSaveWhatsapp?: (value: string) => Promise<void>;
  viewMode?: 'admin' | 'comercial'; onChangeViewMode?: (mode: 'admin' | 'comercial') => void;
  onRefresh: () => void; onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  useEffect(() => { if (!open) { setEditing(false); setPhoneError(''); } }, [open]);
  const startEditing = () => { setPhone(whatsapp || ''); setPhoneError(''); setEditing(true); };
  const savePhone = async () => {
    if (!onSaveWhatsapp) return;
    setSaving(true); setPhoneError('');
    try { await onSaveWhatsapp(phone); setEditing(false); } catch (err) { setPhoneError(err instanceof Error ? err.message : String(err)); } finally { setSaving(false); }
  };
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
      {onSaveWhatsapp && (editing
        ? <form className="user-menu-whatsapp" onSubmit={event => { event.preventDefault(); void savePhone(); }}>
          <label>Mi WhatsApp<input type="tel" inputMode="tel" autoFocus value={phone} maxLength={20} onChange={e => setPhone(e.target.value)} placeholder="300 123 4567" /></label>
          <small>Sale en las propuestas que descarga en Cotizar. Déjelo vacío para quitarlo.</small>
          {phoneError && <small className="user-menu-error" role="alert">{phoneError}</small>}
          <div className="user-menu-whatsapp-actions">
            <button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>Cancelar</button>
          </div>
        </form>
        : <button type="button" role="menuitem" className="user-menu-item" onClick={startEditing}><MessageCircle size={16} aria-hidden="true" />{whatsapp ? `WhatsApp: ${whatsapp}` : 'Agregar mi WhatsApp'}</button>)}
      <button type="button" role="menuitem" className="user-menu-item" onClick={() => { setOpen(false); onRefresh(); }}><RefreshCw size={16} aria-hidden="true" />Actualizar datos</button>
      <button type="button" role="menuitem" className="user-menu-item is-exit" onClick={onSignOut}><LogOut size={16} aria-hidden="true" />Salir</button>
    </div>}
  </div>;
}
