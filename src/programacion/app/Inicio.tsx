// Sección Programación dentro del SIIO: ciudad, encabezado de cada pantalla y contenido. El menú de pantallas está
// en el menú lateral del SIIO (ProgramacionNav).
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MapPin } from 'lucide-react';
import { db, type Acceso } from './supabase.ts';
import { PAGINAS, anunciarRol, enlace, leerRuta, type Pagina } from './paginas.ts';
import { TableroDia } from './Tablero.tsx';
import { Novedades } from './Novedades.tsx';
import { CambiosDelDia } from './CambiosDelDia.tsx';
import { PorProgramar } from './PorProgramar.tsx';
import { CalendarioPuesto } from './CalendarioPuesto.tsx';
import { Clientes } from './Clientes.tsx';
import { Maestros } from './Maestros.tsx';
import { Cierre } from './Cierre.tsx';
import { Simulador } from './Simulador.tsx';

export function Inicio({ acceso, ciudad, ciudades, setCiudad }: {
  acceso: Acceso; ciudad: string; ciudades: { id: string; nombre: string }[]; setCiudad: (c: string) => void;
}) {
  const [[pagina, parametro], setRuta] = useState<[Pagina, string | null]>(leerRuta);
  useEffect(() => {
    const cambio = () => setRuta(leerRuta());
    window.addEventListener('hashchange', cambio);
    return () => window.removeEventListener('hashchange', cambio);
  }, []);
  useEffect(() => { anunciarRol(acceso.rol); return () => anunciarRol(null); }, [acceso.rol]);
  const setPagina = (p: Pagina, param?: string | number) => { window.location.hash = enlace(p, param); };
  const [pendientes, setPendientes] = useState(0);
  const visibles = PAGINAS;
  // La ciudad va en el renglón del título del SIIO, a la derecha (Juan, 2026-11-21), por portal al encabezado.
  const [destino, setDestino] = useState<HTMLElement | null>(null);
  useEffect(() => { setDestino(document.getElementById('topbar-seccion')); }, []);
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
    simulador: <Simulador key={ciudad} ciudad={ciudad} />,
  };

  const selectorCiudad = (
    <label className="prog-ciudad">
      <span><MapPin size={14} aria-hidden="true" /> Ciudad</span>
      {acceso.ciudad_id || ciudades.length < 2
        ? <strong>{ciudades.find((c) => c.id === ciudad)?.nombre ?? ciudad}</strong>
        : <select value={ciudad} onChange={(e) => setCiudad(e.target.value)} aria-label="Ciudad">
            {ciudades.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>}
    </label>
  );
  // Las pantallas de Programación van en el menú lateral del SIIO, desplegable (Juan, 2026-11-21, como SecurityOps).
  return (
    <div className="prog-embebida">
      {destino ? createPortal(selectorCiudad, destino) : selectorCiudad}
      {pendientes > 0 && <button type="button" className="prog-aviso" onClick={() => setPagina('novedades')}>{pendientes} novedad{pendientes === 1 ? '' : 'es'} por revisar</button>}
      <header className="prog-encabezado">
        <h2>{actual.titulo}</h2>
        <p>{actual.ayuda}</p>
      </header>
      {contenido[actual.id]}
    </div>
  );
}
