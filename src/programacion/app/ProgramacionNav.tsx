// Menú de Programación dentro del menú lateral del SIIO: una sección desplegable con sus pantallas agrupadas, como el
// menú de SecurityOps (Juan, 2026-11-21). Se abre sola al entrar a Programación y se cierra al salir; también se puede
// abrir o cerrar a mano.
import { useEffect, useState } from 'react';
import { CalendarClock, ChevronDown } from 'lucide-react';
import { PAGINAS, PREFIJO, enlace, leerRuta, rolProgramacion } from './paginas.ts';
import './programacion-nav.css';

const enProgramacion = () => window.location.hash.startsWith(PREFIJO);

export function ProgramacionNav({ label, onNavigate }: { label: string; onNavigate?: () => void }) {
  const [dentro, setDentro] = useState(enProgramacion);
  const [abierto, setAbierto] = useState(enProgramacion);
  const [actual, setActual] = useState(() => leerRuta()[0]);
  const [rol, setRol] = useState(rolProgramacion);

  useEffect(() => {
    const cambio = () => {
      const ahora = enProgramacion();
      setDentro(ahora);
      setAbierto(ahora);
      setActual(leerRuta()[0]);
    };
    const rolCambio = () => setRol(rolProgramacion());
    window.addEventListener('hashchange', cambio);
    window.addEventListener('programacion-rol', rolCambio);
    return () => { window.removeEventListener('hashchange', cambio); window.removeEventListener('programacion-rol', rolCambio); };
  }, []);

  const visibles = PAGINAS.filter((p) => !p.soloAdmin || rol === 'admin');
  const secciones = [...new Set(visibles.map((p) => p.seccion))];

  return (
    <div className={`prog-nav${abierto ? ' abierto' : ''}`}>
      <button type="button" className={`prog-nav-cabecera${dentro ? ' active' : ''}`} aria-expanded={abierto} onClick={() => setAbierto((v) => !v)}>
        <CalendarClock size={18} strokeWidth={1.8} aria-hidden="true" className="nav-icon" />
        <span>{label}</span>
        <ChevronDown size={16} aria-hidden="true" className="prog-nav-flecha" />
      </button>
      {abierto && (
        <div className="prog-nav-lista">
          {secciones.map((s) => (
            <div key={s} className="prog-nav-grupo">
              <span className="prog-nav-titulo">{s}</span>
              {visibles.filter((p) => p.seccion === s).map((p) => (
                <a key={p.id} href={enlace(p.id)} onClick={onNavigate} className={dentro && p.id === actual ? 'active' : ''} aria-current={dentro && p.id === actual ? 'page' : undefined}>
                  <p.icono size={15} strokeWidth={1.8} aria-hidden="true" />
                  <span>{p.menu ?? p.titulo}</span>
                </a>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
