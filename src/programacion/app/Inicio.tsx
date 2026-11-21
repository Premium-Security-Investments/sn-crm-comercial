// Sección Programación dentro del SIIO: ciudad, encabezado de cada pantalla y contenido. El menú de pantallas está
// en el menú lateral del SIIO (ProgramacionNav).
import { useEffect, useState, type ReactNode } from 'react';
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
import { Accesos } from './Accesos.tsx';
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

  // Las secciones de Programación van en el menú lateral del SIIO, desplegable (Juan, 2026-11-21, como SecurityOps).
  // Aquí queda la ciudad, arriba, que es lo primero que se escoge (Juan, 2026-10-17).
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
        {pendientes > 0 && <button type="button" className="prog-aviso" onClick={() => setPagina('novedades')}>{pendientes} novedad{pendientes === 1 ? '' : 'es'} por revisar</button>}
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
