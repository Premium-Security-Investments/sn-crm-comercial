// Tablero del día por ciudad: cobertura de lo contratado, turnos sin cubrir y novedades.
import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { db } from './supabase.ts';
import type { Pagina } from './Inicio.tsx';
import { ResumenHabilitaciones } from './Habilitaciones.tsx';

interface Tablero {
  puestos_con_servicio: number; puestos_descubiertos: number; horas_descubiertas: number; puestos_sin_servicio: number;
  turnos_del_dia: number; turnos_sin_cubrir: number; cambios_del_dia: number; guardas_trabajando: number;
  novedades_activas: number; novedades_por_tipo: Record<string, number>;
}
interface Cobertura { puesto_id: number; puesto: string; cliente: string | null; horas_requeridas: number; horas_cubiertas: number; descubierto: { desde: string; hasta: string; faltan: number }[]; servicios_sin_confirmar: number }

const NOVEDAD: Record<string, string> = { incapacidad: 'Incapacidades', permiso_remunerado: 'Permisos remunerados', permiso_no_remunerado: 'Permisos no remunerados', ausencia: 'Ausencias', vacaciones: 'Vacaciones', sancion: 'Sanciones' };
const hoyISO = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
const franja = (a: string, b: string) => {
  const d1 = a.slice(0, 10), d2 = b.slice(0, 10);
  return `${a.slice(11, 16)}–${b.slice(11, 16)}${d2 !== d1 ? ' (día siguiente)' : ''}`;
};

export function TableroDia({ ciudad, irA }: { ciudad: string; irA: (pagina: Pagina, parametro?: string | number) => void }) {
  const [pendientes, setPendientes] = useState<number | undefined>(undefined);
  const [fecha, setFecha] = useState('');
  const [t, setT] = useState<Tablero | null>(null);
  const [cob, setCob] = useState<Cobertura[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    db().from('periodos').select('inicio, fin, estado').eq('ciudad_id', ciudad).eq('estado', 'abierto').order('inicio').limit(1).then(({ data }) => {
      const p = (data as { inicio: string; fin: string }[] | null)?.[0];
      const h = hoyISO();
      setFecha(p && (h < p.inicio || h > p.fin) ? p.inicio : h);
    });
  }, [ciudad]);
  useEffect(() => {
    if (!fecha) return;
    setT(null); setCob(null); setError('');
    db().rpc('tablero_dia', { p_ciudad: ciudad, p_fecha: fecha }).then(({ data, error }) => { if (error) setError(error.message); setT(data as Tablero); });
    db().rpc('cobertura_dia', { p_ciudad: ciudad, p_fecha: fecha }).then(({ data }) => setCob((data as Cobertura[]) ?? []));
    db().rpc('solicitudes_pendientes', { p_ciudad: ciudad }).then(({ data }) => setPendientes(Number(data ?? 0)));
  }, [ciudad, fecha]);

  const descubiertos = (cob ?? []).filter((c) => c.descubierto.length > 0);
  const tarjeta = (titulo: string, valor: number | string | undefined, alerta = false, accion?: () => void) => (
    <button onClick={accion} disabled={!accion} className={`kpi${alerta ? ' alerta' : ''}`} style={{ cursor: accion ? 'pointer' : 'default', opacity: 1 }}>
      <small>{titulo}</small>
      <strong>{valor === undefined ? '…' : typeof valor === 'number' ? valor.toLocaleString('es-CO') : valor}</strong>
    </button>
  );

  return (
    <section>
      <label className="campo" style={{ maxWidth: 220, marginBottom: 6 }}>Fecha<input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
      {error && <div className="aviso-caja error">{error}</div>}
      <h3 className="titulo-seccion">Cobertura de lo contratado</h3>
      <div className="kpis">
        {tarjeta('Puestos descubiertos', t?.puestos_descubiertos, (t?.puestos_descubiertos ?? 0) > 0)}
        {tarjeta('Horas descubiertas', t ? Number(t.horas_descubiertas) : undefined, (t?.horas_descubiertas ?? 0) > 0)}
        {tarjeta('Puestos con contrato registrado', t?.puestos_con_servicio)}
        {tarjeta('Puestos sin contrato registrado', t?.puestos_sin_servicio, false, () => irA('clientes'))}
      </div>
      {t && t.puestos_sin_servicio > 0 && (
        <div className="aviso-caja alerta">
          {t.puestos_sin_servicio} puestos no tienen registrado lo contratado, así que la cobertura no los puede revisar. En "Clientes" puede
          proponerlo a partir de la programación actual y luego confirmarlo con cada contrato.
        </div>
      )}
      <h3 className="titulo-seccion">Operación del día</h3>
      <div className="kpis">
        {tarjeta('Novedades por revisar', pendientes, (pendientes ?? 0) > 0, () => irA('novedades'))}
        {tarjeta('Turnos sin cubrir', t?.turnos_sin_cubrir, (t?.turnos_sin_cubrir ?? 0) > 0, () => irA('dia'))}
        {tarjeta('Cambios hechos en el día', t?.cambios_del_dia, false, () => irA('dia'))}
        {tarjeta('Guardas trabajando', t?.guardas_trabajando)}
        {tarjeta('Novedades activas', t?.novedades_activas)}
      </div>
      {t && Object.keys(t.novedades_por_tipo).length > 0 && (
        <p className="texto-suave" style={{ fontSize: 14 }}>{Object.entries(t.novedades_por_tipo).map(([k, n]) => `${NOVEDAD[k] ?? k}: ${n}`).join(' · ')}</p>
      )}
      <h3 className="titulo-seccion">Habilitaciones</h3>
      <ResumenHabilitaciones ciudad={ciudad} verCalendario={(p) => irA('calendario', p)} />
      <h3 className="titulo-seccion">Puestos descubiertos</h3>
      {cob === null ? <p className="texto-suave">Cargando…</p> : descubiertos.length === 0 ? (
        (cob ?? []).length
          ? <div className="aviso-caja ok" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><CheckCircle2 size={16} aria-hidden style={{ flex: '0 0 auto' }} />Todos los puestos con contrato registrado están cubiertos.</div>
          : <div className="vacio">No hay puestos con contrato registrado para revisar.</div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {descubiertos.map((c) => (
            <div key={c.puesto_id} className="card" style={{ borderColor: '#fecaca', background: '#fff5f5', padding: '10px 12px', fontSize: 14, display: 'grid', gap: 4 }}>
              <b>{c.puesto}</b> <span className="texto-suave" style={{ fontSize: 12 }}>{c.cliente ?? ''}{c.servicios_sin_confirmar ? ' · contrato en borrador' : ''}</span>
              <div>{c.descubierto.map((d, i) => <span key={i} className="badge rojo" style={{ marginRight: 6, marginBottom: 4 }}>Falta{d.faltan > 1 ? 'n' : ''} {d.faltan} guarda{d.faltan > 1 ? 's' : ''} {franja(d.desde, d.hasta)}</span>)}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span className="texto-suave num" style={{ fontSize: 12 }}>{Number(c.horas_cubiertas)} de {Number(c.horas_requeridas)} horas cubiertas</span>
                <button className="secundario chico" onClick={() => irA('calendario', c.puesto_id)}>Ver calendario</button>
              </div>
            </div>
          ))}
          <button style={{ justifySelf: 'start' }} onClick={() => irA('dia')}>Ir a Alertas del día para resolverlos</button>
        </div>
      )}
    </section>
  );
}
