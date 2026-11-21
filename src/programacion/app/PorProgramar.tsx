// Por programar: guardas sin turnos en el periodo abierto (sin turno tipo o con plan mensual), agrupados
// por puesto; registros con datos incompletos aparte; y guardas activos sin puesto en el periodo.
// Se programan copiando el mes anterior (mismo día de la semana) o asignando un turno tipo.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, type Acceso } from './supabase.ts';
import { Copy } from 'lucide-react';
import { Modal } from './ui.tsx';

interface Pendiente {
  asignacion_id: number; empleado_id: number; empleado: string; puesto_id: number | null; puesto: string | null;
  patron: string | null; motivo: 'sin_turno_tipo' | 'plan_mensual'; turnos_mes_anterior: number;
  documento: string | null; datos_incompletos: boolean;
}
interface SinPuesto { empleado_id: number; nombre: string; documento: string; cargo: string; fecha_ingreso: string | null; ultimo_puesto: string | null; ultimo_hasta: string | null }
interface PuestoOpcion { id: number; nombre: string }
interface Periodo { id: number; inicio: string; fin: string; estado: string }
interface Patron { id: number; codigo: string; tipo: string; ciclo_dias: number; grupos: number; desfase_grupos: number }

const MOTIVO: Record<Pendiente['motivo'], string> = { sin_turno_tipo: 'Sin turno tipo', plan_mensual: 'Plan mensual a mano' };
const MOTIVO_BADGE: Record<Pendiente['motivo'], string> = { sin_turno_tipo: 'ambar', plan_mensual: 'morado' };
const TANDA = 40;

export function PorProgramar({ acceso, ciudad }: { acceso: Acceso; ciudad: string }) {
  const puedeEditar = acceso.rol === 'admin' || acceso.rol === 'coordinador';
  const [periodo, setPeriodo] = useState<Periodo | null | undefined>(undefined);
  const [pendientes, setPendientes] = useState<Pendiente[] | null>(null);
  const [patrones, setPatrones] = useState<Patron[]>([]);
  const [progreso, setProgreso] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [eligiendo, setEligiendo] = useState<Pendiente | null>(null);
  const [sinPuesto, setSinPuesto] = useState<SinPuesto[] | null>(null);
  const [asignando, setAsignando] = useState<SinPuesto | null>(null);

  useEffect(() => {
    db().from('periodos').select('id, inicio, fin, estado').eq('ciudad_id', ciudad).eq('estado', 'abierto').order('inicio').limit(1)
      .then(({ data }) => setPeriodo(((data as Periodo[]) ?? [])[0] ?? null));
    db().from('patrones_turno').select('id, codigo, tipo, ciclo_dias, grupos, desfase_grupos').in('tipo', ['rotativo', 'semanal']).eq('activo', true).order('codigo')
      .then(({ data }) => setPatrones((data as Patron[]) ?? []));
  }, [ciudad]);

  const cargar = useCallback(async () => {
    if (!periodo) return;
    setPendientes(null);
    const { data, error } = await db().rpc('pendientes_de_programar', { p_periodo: periodo.id });
    if (error) setError(error.message);
    setPendientes((data as Pendiente[]) ?? []);
    const sp = await db().rpc('activos_sin_puesto', { p_periodo: periodo.id });
    setSinPuesto((sp.data as SinPuesto[]) ?? []);
  }, [periodo]);
  useEffect(() => { cargar(); }, [cargar]);

  const copiar = async (lista: Pendiente[]) => {
    setError(''); setMensaje('');
    let guardas = 0, turnos = 0, sinFuente = 0;
    for (let i = 0; i < lista.length; i += TANDA) {
      setProgreso(`Copiando ${Math.min(i + TANDA, lista.length)} de ${lista.length}…`);
      const { data, error } = await db().rpc('copiar_plan_anterior', { p_asignaciones: lista.slice(i, i + TANDA).map((p) => p.asignacion_id) });
      if (error) { setError(error.message); break; }
      const r = data as { guardas_programados: number; turnos_creados: number; sin_mes_anterior: number };
      guardas += r.guardas_programados; turnos += r.turnos_creados; sinFuente += r.sin_mes_anterior;
    }
    setProgreso('');
    setMensaje(`Listo: ${guardas} guarda${guardas === 1 ? '' : 's'} programado${guardas === 1 ? '' : 's'} con ${turnos.toLocaleString('es-CO')} turnos.` +
      (sinFuente ? ` ${sinFuente} no tenían turnos el mes anterior: asígneles un turno tipo.` : '') +
      ' Revise el mes de cada puesto en "Calendario por puesto".');
    cargar();
  };

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (pendientes ?? []).filter((p) => !q || [p.empleado, p.puesto].some((x) => x?.toLowerCase().includes(q)));
  }, [pendientes, busqueda]);
  const completos = visibles.filter((p) => !p.datos_incompletos);
  const incompletos = visibles.filter((p) => p.datos_incompletos);
  const copiables = completos.filter((p) => p.turnos_mes_anterior > 0);
  const porPuesto = useMemo(() => {
    const m = new Map<string, Pendiente[]>();
    completos.forEach((p) => { const k = p.puesto ?? '(sin puesto)'; (m.get(k) ?? m.set(k, []).get(k)!).push(p); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }, [completos]);
  const sinPuestoVisibles = (sinPuesto ?? []).filter((e) => { const q = busqueda.trim().toLowerCase(); return !q || e.nombre.toLowerCase().includes(q) || e.documento.includes(q); });
  const marcarReserva = async (e: SinPuesto) => {
    setError('');
    const { error } = await db().rpc('marcar_reserva', { p_empleado: e.empleado_id });
    if (error) { setError(error.message); return; }
    setMensaje(`${e.nombre} quedó como reserva (disponible).`); cargar();
  };
  const filaPendiente = (p: Pendiente) => (
    <div key={p.asignacion_id} className="fila">
      <div style={{ minWidth: 0 }}>
        <strong>{p.empleado}</strong> <span className={`badge ${MOTIVO_BADGE[p.motivo]}`}>{MOTIVO[p.motivo]}</span>
        <div className="sub">{p.documento ?? 'sin cédula'} · <span className="num">{p.turnos_mes_anterior}</span> turnos el mes anterior</div>
      </div>
      {puedeEditar && !progreso && (
        <div className="acciones">
          {p.turnos_mes_anterior > 0 && <button className="secundario chico" onClick={() => copiar([p])}>Copiar mes anterior</button>}
          <button className="secundario chico" onClick={() => setEligiendo(p)}>Turno tipo</button>
        </div>
      )}
    </div>
  );

  if (periodo === undefined) return <p>Cargando…</p>;
  if (!periodo) return <div className="vacio">No hay un periodo abierto. Cuando se abra, aquí aparecerán los guardas que hay que programar a mano.</div>;

  return (
    <section style={{ display: 'grid', gap: 14 }}>
      <p className="texto-suave" style={{ margin: 0, fontSize: 14, maxWidth: 820 }}>
        Periodo <span className="num">{periodo.inicio} a {periodo.fin}</span>. Guardas sin turnos en el periodo, por puesto: no tienen turno tipo o su
        plan se arma a mano cada mes. Copie el mes anterior (respeta el día de la semana) o asígneles un turno tipo. Abajo, los guardas activos que no
        tienen puesto en el periodo.
      </p>
      {mensaje && <div className="aviso-caja ok" style={{ margin: 0 }}>{mensaje}</div>}
      {error && <div className="aviso-caja error" style={{ margin: 0 }}>{error}</div>}
      {progreso && <div className="aviso-caja" style={{ margin: 0 }}>{progreso}</div>}
      {pendientes !== null && (
        <div className="kpis">
          <div className={`kpi${completos.length ? ' aviso' : ' ok'}`}><small>Por programar</small><strong>{(pendientes ?? []).filter((p) => !p.datos_incompletos).length}</strong></div>
          <div className={`kpi${(sinPuesto ?? []).length ? ' alerta' : ''}`}><small>Activos sin puesto</small><strong>{sinPuesto?.length ?? '…'}</strong></div>
          <div className={`kpi${(pendientes ?? []).some((p) => p.datos_incompletos) ? ' aviso' : ''}`}><small>Con datos incompletos</small><strong>{(pendientes ?? []).filter((p) => p.datos_incompletos).length}</strong></div>
        </div>
      )}
      <div className="barra-filtros" style={{ margin: 0 }}>
        <label className="campo">Buscar guarda, cédula o puesto
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </label>
        {puedeEditar && copiables.length > 0 && !progreso && (
          <button onClick={() => copiar(copiables)}>
            <Copy size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
            Copiar mes anterior a {busqueda.trim() ? 'los filtrados' : 'todos'} ({copiables.length})
          </button>
        )}
      </div>

      <h3 className="titulo-seccion" style={{ margin: '4px 0 0' }}>Por programar, por puesto</h3>
      {pendientes === null ? <p>Cargando…</p> : completos.length === 0 ? <div className="aviso-caja ok" style={{ margin: 0 }}>Todos los guardas con puesto tienen turnos en el periodo.</div> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {porPuesto.map(([puesto, ps]) => (
            <div key={puesto} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ background: 'var(--soft)', padding: '9px 14px', fontWeight: 700, fontSize: 14, borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>{puesto}</span><span className="texto-suave" style={{ fontWeight: 400 }}>{ps.length} guarda{ps.length === 1 ? '' : 's'}</span>
              </div>
              <div className="lista" style={{ padding: 8 }}>{ps.map(filaPendiente)}</div>
            </div>
          ))}
        </div>
      )}

      <h3 className="titulo-seccion" style={{ margin: '4px 0 0' }}>Activos sin puesto en el periodo</h3>
      {sinPuesto === null ? <p>Cargando…</p> : sinPuestoVisibles.length === 0 ? <div className="aviso-caja ok" style={{ margin: 0 }}>Todos los guardas activos tienen puesto en el periodo.</div> : (
        <>
          <p className="texto-suave" style={{ margin: 0, fontSize: 14 }}>No aparecen en ningún puesto este periodo. Asígneles un puesto (luego turno tipo o copia del mes anterior) o márquelos como reserva.</p>
          <div className="lista">
            {sinPuestoVisibles.map((e) => (
              <div key={e.empleado_id} className="fila">
                <div style={{ minWidth: 0 }}>
                  <strong>{e.nombre}</strong> <span className="texto-suave" style={{ fontSize: 12 }}>{e.documento}</span>
                  <div className="sub">{e.ultimo_puesto ? `Último puesto: ${e.ultimo_puesto}${e.ultimo_hasta ? ` (hasta ${e.ultimo_hasta})` : ''}` : 'Nunca ha tenido puesto'}{e.fecha_ingreso ? ` · ingresó ${e.fecha_ingreso}` : ''}</div>
                </div>
                {puedeEditar && (
                  <div className="acciones">
                    <button className="chico" onClick={() => setAsignando(e)}>Asignar puesto</button>
                    <button className="secundario chico" onClick={() => marcarReserva(e)}>Marcar como reserva</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {incompletos.length > 0 && (
        <>
          <h3 className="titulo-seccion" style={{ margin: '4px 0 0' }}>Corregir antes de programar</h3>
          <div className="aviso-caja alerta" style={{ margin: 0 }}>
            Estos registros vienen con datos incompletos del Excel (nombre con error, sin cédula o sin puesto real). Corríjalos en Datos maestros o espere
            la información oficial de Avancys; no se programan desde aquí.
          </div>
          <div className="lista">
            {incompletos.map((p) => (
              <div key={p.asignacion_id} className="fila">
                <div style={{ minWidth: 0 }}>
                  <strong>{p.empleado}</strong>
                  <div className="sub">{p.documento ?? 'sin cédula'} · {p.puesto ?? '(sin puesto)'}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {eligiendo && periodo && (
        <Modal onCerrar={() => setEligiendo(null)}>
          <FormTurnoTipo pendiente={eligiendo} patrones={patrones} inicio={periodo.inicio}
            onListo={(m) => { setEligiendo(null); setMensaje(m); cargar(); }} onCancelar={() => setEligiendo(null)} />
        </Modal>
      )}
      {asignando && periodo && (
        <Modal onCerrar={() => setAsignando(null)}>
          <FormAsignarPuesto guarda={asignando} periodo={periodo} ciudad={ciudad}
            onListo={(m) => { setAsignando(null); setMensaje(m); cargar(); }} onCancelar={() => setAsignando(null)} />
        </Modal>
      )}
    </section>
  );
}

function FormTurnoTipo({ pendiente, patrones, inicio, onListo, onCancelar }: {
  pendiente: Pendiente; patrones: Patron[]; inicio: string; onListo: (m: string) => void; onCancelar: () => void;
}) {
  const [filtro, setFiltro] = useState('');
  const [patron, setPatron] = useState<number | ''>('');
  const [ancla, setAncla] = useState(inicio);
  const [grupo, setGrupo] = useState(1);
  const [error, setError] = useState('');
  const elegido = patrones.find((p) => p.id === patron);
  const lista = patrones.filter((p) => !filtro || p.codigo.toLowerCase().includes(filtro.toLowerCase())).slice(0, 200);
  const guardar = async () => {
    if (!patron) { setError('Escoja un turno tipo.'); return; }
    const { data, error } = await db().rpc('asignar_turno_tipo', { p_asignacion: pendiente.asignacion_id, p_patron: patron, p_ancla: ancla, p_grupo: elegido && elegido.grupos > 1 ? grupo : 1 });
    if (error) { setError(error.message); return; }
    onListo(`${pendiente.empleado}: ${(data as { turnos_creados: number }).turnos_creados} turnos creados con el turno tipo.`);
  };
  return (
    <>
      <h3 style={{ margin: 0 }}>Asignar turno tipo</h3>
      <p className="texto-suave" style={{ margin: 0, fontSize: 14 }}>{pendiente.empleado} · {pendiente.puesto}</p>
      <label className="campo">Buscar turno tipo
        <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Ej.: 24H, L:V, 06-18" />
      </label>
      <label className="campo">Turno tipo
        <select value={patron} onChange={(e) => { setPatron(e.target.value ? Number(e.target.value) : ''); setGrupo(1); }}>
          <option value="">— Escoja —</option>
          {lista.map((p) => <option key={p.id} value={p.id}>{p.codigo} ({p.tipo === 'semanal' ? 'semanal' : `ciclo ${p.ciclo_dias} días`}{p.grupos > 1 ? `, ${p.grupos} grupos` : ''})</option>)}
        </select>
      </label>
      {elegido && elegido.grupos > 1 && (
        <label className="campo">Grupo
          <select value={grupo} onChange={(e) => setGrupo(Number(e.target.value))}>
            {Array.from({ length: elegido.grupos }, (_, i) => i + 1).map((g) => <option key={g} value={g}>Grupo {g}{g > 1 ? ` (va ${(g - 1) * elegido.desfase_grupos} días adelante del grupo 1)` : ''}</option>)}
          </select>
        </label>
      )}
      <label className="campo">El ciclo arranca (día 1) el
        <input type="date" value={ancla} onChange={(e) => setAncla(e.target.value)} />
      </label>
      {error && <div className="aviso-caja error" style={{ margin: 0 }}>{error}</div>}
      <button onClick={guardar}>Crear turnos</button>
      <button className="secundario" onClick={onCancelar}>Cancelar</button>
    </>
  );
}

function FormAsignarPuesto({ guarda, periodo, ciudad, onListo, onCancelar }: {
  guarda: SinPuesto; periodo: Periodo; ciudad: string; onListo: (m: string) => void; onCancelar: () => void;
}) {
  const [q, setQ] = useState('');
  const [puestos, setPuestos] = useState<PuestoOpcion[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      const f = q.trim().replace(/[%,()]/g, '');
      let consulta = db().from('puestos').select('id, nombre').eq('ciudad_id', ciudad).eq('activo', true).order('nombre').limit(20);
      if (f) consulta = consulta.ilike('nombre', `%${f}%`);
      consulta.then(({ data }) => setPuestos((data as PuestoOpcion[]) ?? []));
    }, 250);
    return () => clearTimeout(t);
  }, [q, ciudad]);
  const elegir = async (p: PuestoOpcion) => {
    const { error } = await db().rpc('asignar_puesto', { p_periodo: periodo.id, p_empleado: guarda.empleado_id, p_puesto: p.id });
    if (error) { setError(error.message); return; }
    onListo(`${guarda.nombre} quedó en ${p.nombre}. Ahora aparece arriba, en su puesto, para darle turno tipo o copiar el mes anterior.`);
  };
  return (
    <>
      <h3 style={{ margin: 0 }}>Asignar puesto</h3>
      <p className="texto-suave" style={{ margin: 0, fontSize: 14 }}>{guarda.nombre} · periodo {periodo.inicio} a {periodo.fin}</p>
      <label className="campo">Buscar puesto<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre del puesto" /></label>
      <div style={{ maxHeight: 320, overflow: 'auto', display: 'grid', gap: 4 }}>
        {puestos.map((p) => <button key={p.id} className="secundario" style={{ textAlign: 'left' }} onClick={() => elegir(p)}>{p.nombre}</button>)}
      </div>
      {error && <div className="aviso-caja error" style={{ margin: 0 }}>{error}</div>}
      <button className="secundario" onClick={onCancelar}>Cancelar</button>
    </>
  );
}
