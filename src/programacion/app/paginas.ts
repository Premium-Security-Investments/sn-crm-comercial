// Las pantallas de Programación: las usa la sección (Inicio) y el menú lateral del SIIO (ProgramacionNav).
import {
  LayoutDashboard, Inbox, CalendarClock, CalendarPlus, CalendarDays, Building2, Database, Calculator,
  FlaskConical, type LucideIcon,
} from 'lucide-react';

export type Pagina = 'tablero' | 'novedades' | 'dia' | 'programar' | 'calendario' | 'clientes' | 'maestros' | 'cierre' | 'simulador';

export interface DefPagina { id: Pagina; titulo: string; menu?: string; ayuda: string; icono: LucideIcon; seccion: string; soloAdmin?: boolean }
export const PAGINAS: DefPagina[] = [
  { id: 'tablero', titulo: 'Tablero del día', menu: 'Tablero', ayuda: 'Cobertura de lo contratado, turnos sin cubrir y novedades del día.', icono: LayoutDashboard, seccion: 'Operación' },
  { id: 'novedades', titulo: 'Novedades', menu: 'Novedades', ayuda: 'Lo que ya pasó y debe quedar en la nómina (incluido lo que resolvió el supervisor): revise cada una y aplíquela, aplíquela con ajuste o devuélvala.', icono: Inbox, seccion: 'Operación' },
  { id: 'dia', titulo: 'Alertas del día', menu: 'Alertas del día', ayuda: 'Reportes del supervisor y lo que quedó sin cubrir: en horario, el programador escoge el reemplazo. Debajo, todo el día para consultar.', icono: CalendarClock, seccion: 'Operación' },
  { id: 'calendario', titulo: 'Calendario por puesto', ayuda: 'El mes completo de un puesto: quién cubre cada día y qué cambió frente a lo programado.', icono: CalendarDays, seccion: 'Operación' },
  { id: 'programar', titulo: 'Por programar', ayuda: 'Guardas sin turnos en el periodo abierto: copie el mes anterior o asígneles un turno tipo.', icono: CalendarPlus, seccion: 'Operación' },
  { id: 'clientes', titulo: 'Clientes', ayuda: 'Lo contratado por puesto y quién lo cubre en el periodo abierto.', icono: Building2, seccion: 'Gestión' },
  { id: 'maestros', titulo: 'Datos maestros', ayuda: 'Clientes, puestos, empleados y turnos tipo; cargue desde Avancys.', icono: Database, seccion: 'Gestión' },
  { id: 'cierre', titulo: 'Cierre y nómina', ayuda: 'Revisión, cálculo por guarda, listado para nómina y cierre del periodo.', icono: Calculator, seccion: 'Gestión' },
  { id: 'simulador', titulo: 'Simulador de cálculo', menu: 'Simulador', ayuda: '¿Cuánto cuesta este cambio? Escoja un guarda real, cambie días y vea cuánto suben o bajan las extras y el costo.', icono: FlaskConical, seccion: 'Herramientas' },
];

// Dentro del SIIO, la pantalla vive bajo #/programacion (#/programacion/calendario/12): se puede enlazar y "atrás" funciona.
export const PREFIJO = '#/programacion';

export function leerRuta(): [Pagina, string | null] {
  const resto = window.location.hash.startsWith(PREFIJO) ? window.location.hash.slice(PREFIJO.length) : '';
  const [p, param] = resto.replace(/^\/?/, '').split('/');
  return [(PAGINAS.some((x) => x.id === p) ? p : 'tablero') as Pagina, param ? decodeURIComponent(param) : null];
}

export const enlace = (p: Pagina, param?: string | number) => `${PREFIJO}/${param !== undefined ? `${p}/${param}` : p}`;

// El rol en Programación lo resuelve la sección (programacion.mi_acceso) y lo anuncia; hoy ninguna pantalla depende de
// él en el menú (Usuarios se fue a Usuarios y permisos del SIIO), pero queda para las que lo necesiten.
let rolActual: string | null = null;
export const rolProgramacion = () => rolActual;
export function anunciarRol(rol: string | null) {
  rolActual = rol;
  window.dispatchEvent(new CustomEvent('programacion-rol'));
}
