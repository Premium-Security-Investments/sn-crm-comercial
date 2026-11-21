// Estructura de la aplicación: menú lateral por secciones, encabezado de cada pantalla y contenido.
import { useEffect, useState, type ReactNode } from 'react';
import {
  LayoutDashboard, Inbox, CalendarClock, CalendarPlus, CalendarDays, Building2, Database, Calculator,
  ShieldCheck, FlaskConical, MapPin, type LucideIcon,
} from 'lucide-react';
import { db, type Acceso } from './supabase.ts';
import { TableroDia } from './Tablero.tsx';
import { Novedades } from './Novedades.tsx';
import { CambiosDelDia } from './CambiosDelDia.tsx';
import { PorProgramar } from './PorProgramar.tsx';
import { CalendarioPuesto } from './CalendarioPuesto.tsx';
import { Clientes } from './Clientes.tsx';
import { Maestros } from './Maestros.tsx';
import { Cierre } from './Cierre.tsx';
import { Accesos } from './Accesos.tsx';
import { Simulador } from './Simulador.tsx';

export type Pagina = 'tablero' | 'novedades' | 'dia' | 'programar' | 'calendario' | 'clientes' | 'maestros' | 'cierre' | 'accesos' | 'simulador';

interface DefPagina { id: Pagina; titulo: string; menu?: string; ayuda: string; icono: LucideIcon; seccion: string; soloAdmin?: boolean }
const PAGINAS: DefPagina[] = [
  { id: 'tablero', titulo: 'Tablero del día', menu: 'Tablero', ayuda: 'Cobertura de lo contratado, turnos sin cubrir y novedades del día.', icono: LayoutDashboard, seccion: 'Operación' },
  { id: 'novedades', titulo: 'Novedades', menu: 'Novedades', ayuda: 'Lo que ya pasó y debe quedar en la nómina (incluido lo que resolvió el supervisor): revise cada una y aplíquela, aplíquela con ajuste o devuélvala.', icono: Inbox, seccion: 'Operación' },
  { id: 'dia', titulo: 'Alertas del día', menu: 'Alertas del día', ayuda: 'Reportes del supervisor y lo que quedó sin cubrir: en horario, el programador escoge el reemplazo. Debajo, todo el día para consultar.', icono: CalendarClock, seccion: 'Operación' },
  { id: 'calendario', titulo: 'Calendario por puesto', ayuda: 'El mes completo de un puesto: quién cubre cada día y qué cambió frente a lo programado.', icono: CalendarDays, seccion: 'Operación' },
  { id: 'programar', titulo: 'Por programar', ayuda: 'Guardas sin turnos en el periodo abierto: copie el mes anterior o asígneles un turno tipo.', icono: CalendarPlus, seccion: 'Operación' },
  { id: 'clientes', titulo: 'Clientes', ayuda: 'Lo contratado por puesto y quién lo cubre en el periodo abierto.', icono: Building2, seccion: 'Gestión' },
  { id: 'maestros', titulo: 'Datos maestros', ayuda: 'Clientes, puestos, empleados y turnos tipo; cargue desde Avancys.', icono: Database, seccion: 'Gestión' },
  { id: 'cierre', titulo: 'Cierre y nómina', ayuda: 'Revisión, cálculo por guarda, listado para nómina y cierre del periodo.', icono: Calculator, seccion: 'Gestión' },
  { id: 'accesos', titulo: 'Usuarios', ayuda: 'Qué hace cada persona en Programación y en qué ciudad. La entrada se da en el SIIO.', icono: ShieldCheck, seccion: 'Administración', soloAdmin: true },
  { id: 'simulador', titulo: 'Simulador de cálculo', menu: 'Simulador', ayuda: '¿Cuánto cuesta este cambio? Escoja un guarda real, cambie días y vea cuánto suben o bajan las extras y el costo.', icono: FlaskConical, seccion: 'Herramientas' },
];

// Dentro del SIIO, la pantalla vive bajo #/programacion (#/programacion/calendario/12): se puede enlazar y "atrás" funciona.
const PREFIJO = '#/programacion';

export function Inicio({ acceso, ciudad, ciudades, setCiudad }: {
  acceso: Acceso; ciudad: string; ciudades: { id: string; nombre: string }[]; setCiudad: (c: string) => void;
}) {
  const leerHash = (): [Pagina, string | null] => {
    const resto = window.location.hash.startsWith(PREFIJO) ? window.location.hash.slice(PREFIJO.length) : '';
    const [p, param] = resto.replace(/^\/?/, '').split('/');
    return [(PAGINAS.some((x) => x.id === p) ? p : 'tablero') as Pagina, param ? decodeURIComponent(param) : null];
  };
  const [[pagina, parametro], setRuta] = useState<[Pagina, string | null]>(leerHash);
  useEffect(() => {
    const cambio = () => setRuta(leerHash());
    window.addEventListener('hashchange', cambio);
    return () => window.removeEventListener('hashchange', cambio);
  }, []);
  const setPagina = (p: Pagina, param?: string | number) => { window.location.hash = `${PREFIJO}/${param !== undefined ? `${p}/${param}` : p}`; };
  const [pendientes, setPendientes] = useState(0);
  const visibles = PAGINAS.filter((p) => !p.soloAdmin || acceso.rol === 'admin');
  const actual = visibles.find((p) => p.id === pagina) ?? visibles[0];

  useEffect(() => {
    const leer = () => db().rpc('solicitudes_pendientes', { p_ciudad: ciudad }).then(({ data }) => setPendientes(Number(data ?? 0)));
    leer();
    const t = setInterval(leer, 60000);
    return () => clearInterval(t);
  }, [ciudad, pagina]);

  const contenido: Record<Pagina, ReactNode> = {
    tablero: <TableroDia key={ciudad} ciudad={ciudad} irA={setPagina} />,
    novedades: <Novedades key={ciudad} acceso={acceso} ciudad={ciudad} />,
    dia: <CambiosDelDia key={ciudad} acceso={acceso} ciudad={ciudad} irA={(p) => setPagina(p)} />,
    calendario: <CalendarioPuesto key={`${ciudad}-${parametro}`} ciudad={ciudad} puestoInicial={parametro ? Number(parametro) : null} />,
    programar: <PorProgramar key={ciudad} acceso={acceso} ciudad={ciudad} />,
    clientes: <Clientes key={ciudad} acceso={acceso} ciudad={ciudad} />,
    maestros: <Maestros key={ciudad} acceso={acceso} ciudad={ciudad} />,
    cierre: <Cierre key={ciudad} acceso={acceso} ciudad={ciudad} />,
    accesos: <Accesos ciudades={ciudades} />,
    simulador: <Simulador key={ciudad} ciudad={ciudad} />,
  };

  const secciones = [...new Set(visibles.map((p) => p.seccion))];
  // Dentro del SIIO el menú del SIIO ya está a la izquierda: las secciones de Programación van arriba, como pestañas
  // agrupadas, con la ciudad primero (Juan, 2026-10-17: la ciudad es lo primero que se escoge).
  return (
    <div className="prog-embebida">
      <div className="prog-barra">
        <label className="ciudad-menu">
          <span><MapPin size={14} aria-hidden="true" /> Ciudad</span>
          {acceso.ciudad_id || ciudades.length < 2
            ? <strong>{ciudades.find((c) => c.id === ciudad)?.nombre ?? ciudad}</strong>
            : <select value={ciudad} onChange={(e) => setCiudad(e.target.value)} aria-label="Ciudad">
                {ciudades.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>}
        </label>
        <nav className="prog-pestanas" aria-label="Secciones de Programación">
          {secciones.map((s) => (
            <div key={s} className="prog-grupo">
              <span className="prog-grupo-titulo">{s}</span>
              {visibles.filter((p) => p.seccion === s).map((p) => (
                <button key={p.id} type="button" className={p.id === actual.id ? 'activo' : ''} onClick={() => setPagina(p.id)} aria-current={p.id === actual.id ? 'page' : undefined}>
                  <p.icono size={15} strokeWidth={2} /> {p.menu ?? p.titulo}
                  {p.id === 'novedades' && pendientes > 0 && <span className="contador">{pendientes}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </div>
      <header className="topbar">
        <div>
          <h1>{actual.titulo}</h1>
          <p>{actual.ayuda}</p>
        </div>
      </header>
      {contenido[actual.id]}
    </div>
  );
}
