// Programación dentro del SIIO: la sesión es la del SIIO; aquí solo se resuelve el acceso a Programación
// (rol y ciudad, del esquema programacion) y se muestra la sección.
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, db, type Acceso } from './supabase.ts';
import { Inicio } from './Inicio.tsx';
import './programacion.css';

export function ProgramacionView() {
  const [sesion, setSesion] = useState<Session | null | undefined>(undefined);
  const [acceso, setAcceso] = useState<Acceso | null | undefined>(undefined);
  const [ciudades, setCiudades] = useState<{ id: string; nombre: string }[]>([]);
  const [ciudad, setCiudad] = useState<string>('');
  const [estado, setEstado] = useState<'pendiente' | 'sin_acceso' | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSesion(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSesion(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!sesion) { setAcceso(sesion === null ? null : undefined); return; }
    setAcceso(undefined);
    db().rpc('mi_acceso').then(({ data, error }) => {
      const fila = Array.isArray(data) ? data[0] : null;
      const a = error || !fila ? null : (fila as Acceso);
      setAcceso(a);
      if (!a) db().rpc('mi_estado').then(({ data: e }) => setEstado(e === 'pendiente' ? 'pendiente' : 'sin_acceso'));
      if (a) {
        db().from('ciudades').select('id, nombre').order('nombre').then(({ data }) => {
          const cs = (data as { id: string; nombre: string }[]) ?? [];
          setCiudades(cs);
          setCiudad(a.ciudad_id ?? (cs.find((c) => c.id === 'pereira')?.id ?? cs[0]?.id ?? ''));
        });
      }
    });
  }, [sesion]);

  if (sesion === undefined) return <div className="programacion-app"><div className="login-shell">Cargando…</div></div>;
  if (!sesion) return <div className="programacion-app"><div className="login-shell">Inicie sesión en el SIIO para entrar a Programación.</div></div>;
  if (acceso === undefined) return <div className="programacion-app"><div className="login-shell">Verificando acceso…</div></div>;
  if (!acceso) {
    return (
      <div className="programacion-app"><div className="login-shell">
        <div className="login-card">
          <span className="eyebrow">SIIO · Programación</span>
          {estado === 'pendiente' ? (
            <>
              <h1 style={{ fontSize: 22 }}>Tu acceso está pendiente</h1>
              <p style={{ color: '#607089', margin: 0 }}>
                Ya tienes la entrada a Programación ({sesion.user.email}). Falta que un administrador de Programación te
                asigne qué haces y en qué ciudad, en la pestaña Usuarios. Avísale para que lo haga.
              </p>
            </>
          ) : (
            <>
              <h1 style={{ fontSize: 22 }}>Aún no tienes acceso</h1>
              <p style={{ color: '#607089', margin: 0 }}>
                Tu usuario del SIIO ({sesion.user.email}) no tiene la entrada a Programación. Pídele a quien administra el
                SIIO que te marque "Programación de turnos" en Usuarios y permisos.
              </p>
            </>
          )}
        </div>
      </div></div>
    );
  }
  if (!ciudad) return <div className="programacion-app"><div className="login-shell">Cargando ciudades…</div></div>;
  return <div className="programacion-app"><Inicio acceso={acceso} ciudad={ciudad} ciudades={ciudades} setCiudad={setCiudad} /></div>;
}
