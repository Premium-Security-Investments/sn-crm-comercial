// Usuarios de Programación: la entrada la da el SIIO (casilla "Programación de turnos" en Usuarios y permisos); aquí el
// administrador de Programación decide qué hace cada persona y en qué ciudad (Juan Botero, 2026-10-15).
import { useCallback, useEffect, useState } from 'react';
import { db, NOMBRE_ROL, type Rol } from './supabase.ts';

interface Fila { profile_id: string; correo: string; nombre: string | null; rol: Rol | null; ciudad_id: string | null; activo: boolean; actualizado_en: string | null; estado: 'activo' | 'pendiente' | 'pausado' }

const ROLES: Rol[] = ['coordinador', 'nomina', 'consulta', 'admin'];
const DESCRIPCION: Record<Rol, string> = {
  coordinador: 'El programador: ve y edita la programación de su ciudad, escoge reemplazos en Alertas del día y revisa novedades.',
  nomina: 'Ve todo lo de su ciudad, calcula y cierra el periodo; no edita turnos.',
  consulta: 'Solo mira (por ejemplo, Gerencia).',
  admin: 'Todo, en todas las ciudades; administra los usuarios de Programación y los datos maestros.',
};

export function Accesos({ ciudades }: { ciudades: { id: string; nombre: string }[] }) {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [mensaje, setMensaje] = useState<{ t: string; tipo: 'ok' | 'error' } | null>(null);

  const cargar = useCallback(() => {
    db().rpc('listar_accesos').then(({ data, error }) => {
      if (error) setMensaje({ t: error.message, tipo: 'error' });
      setFilas((data as Fila[]) ?? []);
    });
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async (correo: string, rol: Rol, ciudad: string | null, activo: boolean) => {
    const { data, error } = await db().rpc('dar_acceso', { p_correo: correo, p_rol: rol, p_ciudad: rol === 'admin' ? null : ciudad, p_activo: activo });
    setMensaje(error ? { t: error.message, tipo: 'error' } : { t: String(data), tipo: 'ok' });
    if (!error) cargar();
    return !error;
  };
  const pendientes = (filas ?? []).filter((f) => f.estado === 'pendiente').length;

  return (
    <section style={{ display: 'grid', gap: 14 }}>
      <p style={{ color: '#5d6b82', fontSize: 14, margin: 0 }}>
        Aquí aparecen las personas a las que el SIIO les dio la entrada a Programación (Usuarios y permisos → "Programación de turnos").
        Asigne a cada una qué hace y en qué ciudad. Quien está pendiente todavía no ve datos.
      </p>
      {pendientes > 0 && <div className="aviso-caja">{pendientes === 1 ? 'Hay 1 persona pendiente' : `Hay ${pendientes} personas pendientes`} de asignar.</div>}
      {mensaje && <div className={`aviso-caja ${mensaje.tipo}`}>{mensaje.t}</div>}
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        {filas === null ? <p style={{ padding: 16 }}>Cargando…</p> : filas.length === 0 ? <div className="vacio">Nadie tiene la entrada todavía. Se da en el SIIO, en Usuarios y permisos.</div> : (
          <table>
            <thead><tr><th>Persona</th><th>Qué hace</th><th>Ciudad</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {filas.map((f) => f.estado === 'pendiente'
                ? <FilaPendiente key={f.profile_id} fila={f} ciudades={ciudades} onGuardar={guardar} />
                : (
                  <tr key={f.profile_id} style={{ opacity: f.activo ? 1 : 0.55 }}>
                    <td><strong>{f.nombre ?? f.correo}</strong><div style={{ color: '#66758c', fontSize: 12 }}>{f.correo}</div></td>
                    <td>
                      <select value={f.rol ?? 'consulta'} onChange={(e) => guardar(f.correo, e.target.value as Rol, f.ciudad_id, f.activo)} style={{ maxWidth: 250 }}>
                        {ROLES.map((r) => <option key={r} value={r}>{NOMBRE_ROL[r]}</option>)}
                      </select>
                    </td>
                    <td>
                      {f.rol === 'admin' ? <span className="badge gris">Todas</span> : (
                        <select value={f.ciudad_id ?? ''} onChange={(e) => guardar(f.correo, f.rol ?? 'consulta', e.target.value || null, f.activo)} style={{ maxWidth: 170 }}>
                          <option value="">Todas</option>
                          {ciudades.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                        </select>
                      )}
                    </td>
                    <td>{f.activo ? <span className="badge verde">Activo</span> : <span className="badge gris">En pausa</span>}</td>
                    <td style={{ textAlign: 'right' }}>
                      {f.activo
                        ? <button className="peligro chico" onClick={() => confirm(`¿Poner en pausa a ${f.nombre ?? f.correo}? No podrá ver Programación.`) && guardar(f.correo, f.rol ?? 'consulta', f.ciudad_id, false)}>Pausar</button>
                        : <button className="secundario chico" onClick={() => guardar(f.correo, f.rol ?? 'consulta', f.ciudad_id, true)}>Reactivar</button>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card" style={{ fontSize: 14 }}>
        <strong>Qué puede hacer cada uno</strong>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: '#40516b' }}>
          {ROLES.map((r) => <li key={r}><b>{NOMBRE_ROL[r]}:</b> {DESCRIPCION[r]}</li>)}
        </ul>
        <p style={{ margin: '8px 0 0', color: '#5d6b82' }}>Para que alguien deje de entrar del todo, quítele la casilla en el SIIO.</p>
      </div>
    </section>
  );
}

function FilaPendiente({ fila, ciudades, onGuardar }: {
  fila: Fila; ciudades: { id: string; nombre: string }[];
  onGuardar: (correo: string, rol: Rol, ciudad: string | null, activo: boolean) => Promise<boolean>;
}) {
  const [rol, setRol] = useState<Rol>('coordinador');
  const [ciudad, setCiudad] = useState<string | null>(ciudades.find((c) => c.id === 'pereira')?.id ?? ciudades[0]?.id ?? null);
  return (
    <tr>
      <td><strong>{fila.nombre ?? fila.correo}</strong><div style={{ color: '#66758c', fontSize: 12 }}>{fila.correo}</div></td>
      <td>
        <select value={rol} onChange={(e) => setRol(e.target.value as Rol)} style={{ maxWidth: 250 }} aria-label={`Qué hace ${fila.nombre ?? fila.correo}`}>
          {ROLES.map((r) => <option key={r} value={r}>{NOMBRE_ROL[r]}</option>)}
        </select>
      </td>
      <td>
        {rol === 'admin' ? <span className="badge gris">Todas</span> : (
          <select value={ciudad ?? ''} onChange={(e) => setCiudad(e.target.value || null)} style={{ maxWidth: 170 }} aria-label={`Ciudad de ${fila.nombre ?? fila.correo}`}>
            {ciudades.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            <option value="">Todas</option>
          </select>
        )}
      </td>
      <td><span className="badge ambar">Pendiente</span></td>
      <td style={{ textAlign: 'right' }}><button className="chico" onClick={() => onGuardar(fila.correo, rol, rol === 'admin' ? null : ciudad, true)}>Asignar</button></td>
    </tr>
  );
}
