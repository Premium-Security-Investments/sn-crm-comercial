// Calendario por puesto: el mes de un puesto con quién lo cubre cada día, lo programado frente a lo
// realizado, novedades y turnos sin cubrir. Es la vista más parecida a la hoja del Excel.
import { useEffect, useMemo, useState } from 'react';
import { db } from './supabase.ts';
import { diasDelPeriodo } from '../motor/periodo.ts';

interface Periodo { id: number; inicio: string; fin: string; estado: string }
interface Puesto { id: number; nombre: string; cliente_id: number | null }
interface Turno { id: number; empleado_id: number; inicio: string; fin: string; turno_programado_id?: number | null; origen?: string }
interface Novedad { empleado_id: number; tipo: string; desde: string; hasta: string }

const LETRA: Record<string, string> = { incapacidad: 'I', permiso_remunerado: 'PR', permiso_no_remunerado: 'PN', ausencia: 'A', vacaciones: 'V', sancion: 'S', retiro: 'R', no_vinculado: 'N', fuera_de_corte: 'T' };
const NOMBRE_NOV: Record<string, string> = { incapacidad: 'Incapacidad', permiso_remunerado: 'Permiso remunerado', permiso_no_remunerado: 'Permiso no remunerado', ausencia: 'Ausencia', vacaciones: 'Vacaciones', sancion: 'Sanción', retiro: 'Retirado', no_vinculado: 'No vinculado', fuera_de_corte: 'Fuera de corte' };
const hm = (ts: string) => ts.slice(11, 16);
/** "06:30" → "6:30"; "19:00" → "19". */
const h = (ts: string) => { const [H, M] = ts.slice(11, 16).split(':'); return M === '00' ? String(Number(H)) : `${Number(H)}:${M}`; };
const rangoCorto = (a: string, b: string) => `${h(a)}–${h(b)}`;
const horario = (t: { inicio: string; fin: string }) => `${hm(t.inicio)}–${hm(t.fin)}`;
/** D = 6 a 18, N = 18 a 6; otro horario igual al programado se muestra con sus horas. */
const corto = (t: { inicio: string; fin: string }) => (hm(t.inicio) === '06:00' && hm(t.fin) === '18:00' ? 'D' : hm(t.inicio) === '18:00' && hm(t.fin) === '06:00' ? 'N' : rangoCorto(t.inicio, t.fin));
const horas = (ts: { inicio: string; fin: string }[]) => ts.reduce((s, t) => s + (Date.parse(t.fin) - Date.parse(t.inicio)) / 36e5, 0);
const diferencia = (prog: { inicio: string; fin: string }[], real: { inicio: string; fin: string }[]) => {
  const d = Math.round((horas(real) - horas(prog)) * 10) / 10;
  return d === 0 ? 'mismas horas, otro horario' : `${Math.abs(d).toLocaleString('es-CO')} h ${d > 0 ? 'más' : 'menos'}`;
};
const iniciales = (nombre: string) => nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

async function todo<T>(q: (a: number, b: number) => PromiseLike<{ data: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += 1000) {
    const { data } = await q(i, i + 999);
    const f = (data as T[]) ?? [];
    out.push(...f);
    if (f.length < 1000) return out;
  }
}

export function CalendarioPuesto({ ciudad, puestoInicial = null }: { ciudad: string; puestoInicial?: number | null }) {
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [periodoId, setPeriodoId] = useState<number | null>(null);
  const [puestos, setPuestos] = useState<Puesto[]>([]);
  const [clientes, setClientes] = useState<Map<number, string>>(new Map());
  const [q, setQ] = useState('');
  const [puesto, setPuesto] = useState<Puesto | null>(null);
  const [festivos, setFestivos] = useState<string[]>([]);
  const [datos, setDatos] = useState<{ prog: Turno[]; real: Turno[]; nov: Novedad[]; nombres: Map<number, string> } | null>(null);

  useEffect(() => {
    db().from('periodos').select('id, inicio, fin, estado').eq('ciudad_id', ciudad).order('inicio', { ascending: false }).then(({ data }) => {
      const ps = (data as Periodo[]) ?? [];
      setPeriodos(ps);
      setPeriodoId(ps.find((p) => p.estado === 'abierto')?.id ?? ps[0]?.id ?? null);
    });
    todo<Puesto>((a, b) => db().from('puestos').select('id, nombre, cliente_id').eq('ciudad_id', ciudad).eq('activo', true).order('nombre').range(a, b)).then((ps) => {
      setPuestos(ps);
      if (puestoInicial) setPuesto(ps.find((p) => p.id === puestoInicial) ?? null);
    });
    todo<{ id: number; razon_social: string }>((a, b) => db().from('clientes').select('id, razon_social').order('id').range(a, b)).then((cs) => setClientes(new Map(cs.map((c) => [c.id, c.razon_social]))));
    todo<{ fecha: string }>((a, b) => db().from('festivos').select('fecha').order('fecha').range(a, b)).then((fs) => setFestivos(fs.map((f) => f.fecha)));
  }, [ciudad, puestoInicial]);

  const periodo = periodos.find((p) => p.id === periodoId) ?? null;
  const dias = useMemo(() => (periodo ? diasDelPeriodo(periodo.inicio, periodo.fin, festivos) : []), [periodo, festivos]);

  useEffect(() => {
    if (!puesto || !periodo) return;
    setDatos(null);
    (async () => {
      const finMas1 = new Date(Date.parse(periodo.fin + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
      const [prog, real] = await Promise.all([
        todo<Turno>((a, b) => db().from('turnos_programados').select('id, empleado_id, inicio, fin').eq('puesto_id', puesto.id).gte('inicio', periodo.inicio).lt('inicio', finMas1).order('inicio').range(a, b)),
        todo<Turno>((a, b) => db().from('turnos').select('id, empleado_id, inicio, fin, turno_programado_id, origen').eq('puesto_id', puesto.id).gte('inicio', periodo.inicio).lt('inicio', finMas1).order('inicio').range(a, b)),
      ]);
      const ids = [...new Set([...prog, ...real].map((t) => t.empleado_id))];
      const [emps, nov] = ids.length ? await Promise.all([
        todo<{ id: number; nombre: string }>((a, b) => db().from('empleados').select('id, nombre').in('id', ids).range(a, b)),
        todo<Novedad>((a, b) => db().from('novedades').select('empleado_id, tipo, desde, hasta').in('empleado_id', ids).lte('desde', periodo.fin).gte('hasta', periodo.inicio).neq('estado', 'anulada').range(a, b)),
      ]) : [[], []];
      setDatos({ prog, real, nov, nombres: new Map(emps.map((e) => [e.id, e.nombre])) });
    })();
  }, [puesto, periodo]);

  const filas = useMemo(() => {
    if (!datos) return [];
    const ids = [...new Set([...datos.prog, ...datos.real].map((t) => t.empleado_id))];
    const primero = (id: number) => [...datos.prog, ...datos.real].filter((t) => t.empleado_id === id).map((t) => t.inicio).sort()[0] ?? '';
    return ids.sort((a, b) => primero(a).localeCompare(primero(b))).map((id) => ({ id, nombre: datos.nombres.get(id) ?? `Guarda ${id}` }));
  }, [datos]);

  const progPorId = useMemo(() => new Map((datos?.prog ?? []).map((t) => [t.id, t])), [datos]);

  // Una casilla = una respuesta: ¿qué pasó ese día con ese guarda en este puesto?
  const celda = (emp: number, fecha: string) => {
    if (!datos) return null;
    const real = datos.real.filter((t) => t.empleado_id === emp && t.inicio.slice(0, 10) === fecha);
    const prog = datos.prog.filter((t) => t.empleado_id === emp && t.inicio.slice(0, 10) === fecha);
    const nov = datos.nov.find((n) => n.empleado_id === emp && fecha >= n.desde && fecha <= n.hasta);
    const progTxt = prog.map((p) => horario(p)).join(' y ');
    if (real.length) {
      const enlazados = real.map((t) => (t.turno_programado_id ? progPorId.get(t.turno_programado_id) : undefined));
      const cubreA = enlazados.find((p) => p && p.empleado_id !== emp);
      const igual = real.length === 1 && enlazados[0] && enlazados[0].inicio === real[0].inicio && enlazados[0].fin === real[0].fin;
      const desde = real.map((t) => t.inicio).sort()[0], hasta = real.map((t) => t.fin).sort().slice(-1)[0];
      const trabajoTxt = real.map((t) => horario(t)).join(' y ');
      const detalle = [
        cubreA ? `Cubrió a ${datos.nombres.get(cubreA.empleado_id) ?? 'otro guarda'}` : '',
        progTxt ? `Programado ${progTxt}` : (cubreA ? '' : 'No estaba programado'),
        `Trabajó ${trabajoTxt}`,
        !igual && progTxt ? diferencia(prog, real) : '',
        nov ? `Novedad: ${NOMBRE_NOV[nov.tipo] ?? nov.tipo}` : '',
      ].filter(Boolean).join(' · ');
      return igual
        ? <span className="marca ok" title={detalle}>{corto({ inicio: desde, fin: hasta })}</span>
        : <span className="marca otro-horario" title={detalle}>{rangoCorto(desde, hasta)}</span>;
    }
    if (nov) return <span className="marca novedad" title={`${NOMBRE_NOV[nov.tipo] ?? nov.tipo}${progTxt ? ` · tenía programado ${progTxt}` : ''}`}>{LETRA[nov.tipo] ?? '?'}</span>;
    if (prog.length) {
      const otro = prog.map((p) => datos.real.find((t) => t.turno_programado_id === p.id && t.empleado_id !== emp)).find(Boolean);
      if (otro) {
        const nombre = datos.nombres.get(otro.empleado_id) ?? 'otro guarda';
        return <span className="marca cubierto" title={`Programado ${progTxt} · lo cubrió ${nombre} (${horario(otro)})`}>{iniciales(nombre)}</span>;
      }
      return <span className="marca falta" title={`Programado ${progTxt} · nadie trabajó`}>Falta</span>;
    }
    return null;
  };
  // Por día: cuántos turnos programados del puesto quedaron sin nadie.
  const faltanDia = (fecha: string) => {
    if (!datos) return { faltan: 0, hay: false };
    const prog = datos.prog.filter((p) => p.inicio.slice(0, 10) === fecha);
    const faltan = prog.filter((p) => !datos.real.some((t) => t.turno_programado_id === p.id)).length;
    return { faltan, hay: prog.length > 0 || datos.real.some((t) => t.inicio.slice(0, 10) === fecha) };
  };
  const coincidencias = q.trim().length >= 2
    ? puestos.filter((p) => p.nombre.toLowerCase().includes(q.toLowerCase()) || (clientes.get(p.cliente_id ?? -1) ?? '').toLowerCase().includes(q.toLowerCase())).slice(0, 12)
    : [];
  const cambios = datos ? datos.real.filter((t) => { const p = t.turno_programado_id ? progPorId.get(t.turno_programado_id) : undefined; return !p || p.inicio !== t.inicio || p.fin !== t.fin || p.empleado_id !== t.empleado_id; }).length : 0;
  const sinTotal = datos ? datos.prog.filter((p) => !datos.real.some((t) => t.turno_programado_id === p.id)).length : 0;

  return (
    <section style={{ display: 'grid', gap: 14 }}>
      <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <label style={{ display: 'grid', gap: 6 }}>Periodo
          <select value={periodoId ?? ''} onChange={(e) => setPeriodoId(Number(e.target.value))}>
            {periodos.map((p) => <option key={p.id} value={p.id}>{p.inicio} a {p.fin} ({p.estado})</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 6, position: 'relative' }}>Puesto
          {puesto ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span><strong>{puesto.nombre}</strong><br /><span style={{ fontSize: 12, color: '#66758c', fontWeight: 400 }}>{clientes.get(puesto.cliente_id ?? -1) ?? 'Sin cliente'}</span></span>
              <button className="secundario chico" onClick={() => { setPuesto(null); setDatos(null); }}>Cambiar</button>
            </div>
          ) : (
            <>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escriba el puesto o el cliente" />
              {coincidencias.length > 0 && (
                <div className="card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, padding: 4, display: 'grid', gap: 2 }}>
                  {coincidencias.map((p) => (
                    <button key={p.id} className="secundario" style={{ textAlign: 'left', fontWeight: 500 }} onClick={() => { setPuesto(p); setQ(''); }}>
                      {p.nombre} <span style={{ color: '#66758c', fontSize: 12 }}>· {clientes.get(p.cliente_id ?? -1) ?? 'sin cliente'}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </label>
      </div>

      {!puesto ? <div className="vacio">Escoja un puesto para ver su mes.</div> : !datos ? <p>Cargando el mes…</p> : filas.length === 0 ? (
        <div className="vacio">Este puesto no tiene turnos en el periodo.</div>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi"><small>Guardas en el mes</small><strong>{filas.length}</strong></div>
            <div className="kpi"><small>Turnos realizados</small><strong>{datos.real.length}</strong></div>
            <div className={`kpi ${cambios ? 'aviso' : 'ok'}`}><small>Turnos en otro horario o no programados</small><strong>{cambios}</strong></div>
            <div className={`kpi ${sinTotal ? 'alerta' : 'ok'}`}><small>Turnos en los que no fue nadie</small><strong>{sinTotal}</strong></div>
          </div>
          <div className="leyenda">
            <span className="marca ok">D</span> Trabajó como estaba programado (D día, N noche)
            <span className="marca otro-horario">6:30–20:30</span> Trabajó en otro horario
            <span className="marca falta">Falta</span> Estaba programado y no fue nadie
            <span className="marca cubierto">PG</span> Lo cubrió otra persona (iniciales)
            <span className="marca novedad">I</span> Novedad (I incapacidad, V vacaciones, A ausencia…)
            <span style={{ background: '#fff8e1', padding: '2px 6px', borderRadius: 6 }}>Festivo</span>
            <span style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 6 }}>Domingo</span>
          </div>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="cal">
              <thead>
                <tr>
                  <th className="nombre">Guarda</th>
                  {dias.map((d) => (
                    <th key={d.fecha} className={`dia ${d.letra === 'D' ? 'domingo' : d.letra === 'F' ? 'festivo' : ''}`} title={d.fecha}>
                      <div style={{ fontSize: 10, color: '#64748b' }}>{d.letra === 'F' ? 'Fest' : d.letra}</div>{d.diaMes}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id}>
                    <td className="nombre" title={f.nombre}><span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.nombre}</span></td>
                    {dias.map((d) => <td key={d.fecha} className={d.letra === 'D' ? 'domingo' : d.letra === 'F' ? 'festivo' : ''}>{celda(f.id, d.fecha)}</td>)}
                  </tr>
                ))}
                <tr>
                  <td className="nombre" style={{ fontWeight: 700 }}>¿Quedó cubierto?</td>
                  {dias.map((d) => { const r = faltanDia(d.fecha); return (
                    <td key={d.fecha} title={r.faltan ? `${r.faltan} turno(s) programado(s) sin nadie` : r.hay ? 'Todo lo programado quedó cubierto' : 'Sin turnos'}>
                      {r.faltan ? <span style={{ color: '#b91c1c', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap' }}>Falta {r.faltan}</span> : r.hay ? <span style={{ color: '#15803d', fontWeight: 700 }}>✓</span> : null}
                    </td>
                  ); })}
                </tr>
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 12, color: '#66758c', margin: 0 }}>Pase el cursor sobre una casilla para ver lo programado, lo trabajado y la diferencia en horas. Los turnos de noche se muestran el día en que empiezan.</p>
        </>
      )}
    </section>
  );
}
