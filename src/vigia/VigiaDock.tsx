// El chat de Vig-IA vive en un panel a la derecha que siempre está a la vista, aunque la página sea larga (Juan,
// 2026-11-25: «el chat se está yendo muy abajo cuando Mi día tiene muchas cosas y ni se ve; esa debería ser la posición
// de todos los chats de Vig-IA»). En computador es una columna fija al lado del contenido; en celular, un botón abajo a
// la derecha que abre el chat por encima de la página. Si no hay chat, la página queda igual.
import { useState, type ReactNode } from 'react';
import './vigia-dock.css';

export function VigiaDock({ dock, label = 'Vig-IA', children }: { dock: ReactNode; label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!dock) return <>{children}</>;
  return <div className={`vigia-dock-layout${open ? ' is-open' : ''}`}>
    <div className="vigia-dock-main">{children}</div>
    <aside className="vigia-dock" aria-label={label}>{dock}</aside>
    <button type="button" className="vigia-dock-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? 'Cerrar' : 'Vig-IA'}
    </button>
  </div>;
}
