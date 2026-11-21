// Alertas del día: la bandeja del programador. Llegan los reportes del supervisor (turno por cubrir, no
// marcó, no respondió en la noche) y lo que quedó mal después de un cambio. En horario de Programación el
// programador escoge el reemplazo; fuera de horario (o si nadie toma el reporte en los minutos de
// respaldo) lo atiende el supervisor. Debajo, todo lo programado frente a lo realizado, solo para consulta.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, type Acceso } from './supabase.ts';
import { BellRing, CheckCircle2, Clock, Hand, Plus, UserCheck, XCircle } from 'lucide-react';
import { Modal } from './ui.tsx';

interface Fila {
  puesto_id: number | null; puesto: string | null; turno_programado_id: number | null; turno_id: number | null;
  programado_empleado_id: number | null; programado_nombre: string | null; programado_inicio: string | null; programado_fin: string | null;
  realizado_empleado_id: number | null; realizado_nombre: string | null; realizado_inicio: string | null; realizado_fin: string | null;
  origen: string | null; novedad: string | null; estado: 'programado' | 'sin_cubrir' | 'cubierto' | 'cambio_horario' | 'adicional';
}
interface Sugerido { empleado_id: number; nombre: string; conoce_el_puesto: boolean; horas_7_dias: number; avisos: string[] }
interface Reporte {
  id: number; tipo: keyof typeof REPORTE; estado: 'abierta' | 'tomada' | 'resuelta' | 'cerrada'; origen: string; id_externo: string | null;
  reportado_por: string | null; creado_en: string; tomada_en: string | null; tomada_por: string | null; resuelta_en: string | null;
  reemplazo: string | null; nota: string | null; responsable: 'programacion' | 'respaldo' | 'supervisor' | 'cerrada';
}
interface Alerta {
  clave: string; tipo: 'reportada' | 'sin_cubrir' | 'descubierto' | 'regla' | 'devuelta'; puesto_id: number | null; puesto: string | null;
  desde: string | null; hasta: string | null; empleado_id: number | null; empleado: string | null; detalle: string | null;
  turno_programado_id: number | null; turno_id: number | null; solicitud_id: number | null; avisos: string[] | null;
  avisado_en: string | null; nota: string | null; reporte: Reporte | null;
}
const REPORTE = {
  turno_por_cubrir: 'Turno por cubrir', no_marco: 'No marcó llegada', no_respondio: 'No respondió en la noche', otro: 'Reporte del supervisor',
} as const;
const RESPONSABLE: Record<Reporte['responsable'], { texto: string; badge: string }> = {
  programacion: { texto: 'Le toca a Programación', badge: 'verde' },
  respaldo: { texto: 'Nadie lo tomó a tiempo: avise también al supervisor', badge: 'rojo' },
  supervisor: { texto: 'Fuera de horario: lo resuelve el supervisor', badge: 'morado' },
  cerrada: { texto: '', badge: 'gris' },
};
interface Horario { ciudad_id: string; dias: number[]; desde: string; hasta: string; atiende_festivos: boolean; minutos_respaldo: number }
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const textoDias = (d: number[]) => {
  const s = [...d].sort();
  const seguidos = s.every((x, i) => i === 0 || x === s[i - 1] + 1);
  return seguidos && s.length > 2 ? `${DIAS[s[0] - 1]} a ${DIAS[s[s.length - 1] - 1]}` : s.map((x) => DIAS[x - 1]).join(', ');
};
const ALERTA: Record<Alerta['tipo'], { texto: string; badge: string }> = {
  reportada: { texto: 'Reporte del supervisor', badge: 'rojo' },
  sin_cubrir: { texto: 'Turno sin cubrir', badge: 'rojo' },
  descubierto: { texto: 'Puesto descubierto frente a lo contratado', badge: 'rojo' },
  regla: { texto: 'Rompe una regla', badge: 'ambar' },
  devuelta: { texto: 'Novedad devuelta a Operaciones', badge: 'morado' },
};
interface Periodo { id: number; inicio: string; fin: string; estado: string }

const ESTADO: Record<Fila['estado'], { texto: string; badge: string }> = {
  programado: { texto: 'Como se programó', badge: 'verde' },
  sin_cubrir: { texto: 'Sin cubrir', badge: 'rojo' },
  cubierto: { texto: 'Cubierto por otro', badge: 'ambar' },
  cambio_horario: { texto: 'Cambio de horario', badge: '' },
  adicional: { texto: 'Adicional', badge: 'morado' },
};
// Color de la cifra en el resumen: lo que pide atención resalta.
const KPI: Partial<Record<Fila['estado'], (n: number) => string>> = {
  programado: () => ' ok', sin_cubrir: (n) => (n > 0 ? ' alerta' : ' ok'), cubierto: (n) => (n > 0 ? ' aviso' : ''),
};
const TIPOS_NOVEDAD: [string, string][] = [
  ['incapacidad', 'Incapacidad'], ['permiso_remunerado', 'Permiso remunerado'], ['permiso_no_remunerado', 'Permiso no remunerado'],
  ['ausencia', 'Ausencia'], ['vacaciones', 'Vacaciones'], ['sancion', 'Sanción'], ['retiro', 'Retiro'],
];
const NOVEDAD_TEXTO: Record<string, string> = Object.fromEntries(TIPOS_NOVEDAD);
const AVISO_TEXTO: Record<string, string> = {
  descanso_menor_8h: 'quedaría con menos de 8 h de descanso',
  descanso_menor_al_minimo: 'quedaría con menos del descanso mínimo entre turnos',
  horas_semana_sobre_el_maximo: 'pasaría el máximo de horas en 7 días',
  turno_mayor_16h: 'turno de más de 16 h',
  tiene_novedad: 'tiene novedad ese día',
  sin_habilitacion_arma: 'no tiene arma (curso y porte) vigente y el puesto la exige',
  sin_habilitacion_moto: 'no tiene licencia de moto vigente y el puesto la exige',
  sin_habilitacion_canino: 'no es guía canino vigente y el puesto lo exige',
};
const hora = (ts: string | null) => (ts ? ts.slice(11, 16) : '');
const rango = (a: string | null, b: string | null) => (a ? `${hora(a)}–${hora(b)}` : '—');
const hoyISO = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10); // hora de Colombia

/** Si la base pide motivo (hay avisos), lo pregunta y reintenta. Devuelve el resultado o el error. */
async function conMotivo<T>(llamar: (motivo: string | null) => PromiseLike<{ data: T | null; error: { message: string } | null }>) {
  let r = await llamar(null);
  const m = r.error?.message.match(/MOTIVO_REQUERIDO:(.*)/);
  if (m) {
    const avisos = m[1].split(',').map((a) => AVISO_TEXTO[a.trim()] ?? a).join('; ');
    const motivo = prompt(`Atención: ${avisos}.\n\nSi de todas formas quiere hacerlo, escriba el motivo (queda registrado):`);
    if (!motivo?.trim()) return { data: null, error: { message: 'Cambio cancelado: se requiere el motivo.' } };
    r = await llamar(motivo.trim());
  }
  return r;
}

type Accion = { tipo: 'resolver' | 'avisar' | 'cerrar'; alerta: Alerta } | { tipo: 'reporte' | 'horario' } | null;

export function CambiosDelDia({ acceso, ciudad, irA }: { acceso: Acceso; ciudad: string; irA?: (pagina: 'novedades') => void }) {
  const puedeEditar = acceso.rol === 'admin' || acceso.rol === 'coordinador';
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [fecha, setFecha] = useState<string>('');
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [accion, setAccion] = useState<Accion>(null);
  const [alertas, setAlertas] = useState<Alerta[] | null>(null);
  const [horario, setHorario] = useState<Horario | null>(null);
  const [verResueltas, setVerResueltas] = useState(false);

  useEffect(() => {
    db().from('periodos').select('id, inicio, fin, estado').eq('ciudad_id', ciudad).order('inicio').then(({ data }) => {
      const ps = (data as Periodo[]) ?? [];
      setPeriodos(ps);
      const hoy = hoyISO();
      const abierto = ps.find((p) => p.estado === 'abierto' && p.inicio <= hoy && hoy <= p.fin) ?? ps.find((p) => p.estado === 'abierto');
      setFecha(abierto ? (abierto.inicio <= hoy && hoy <= abierto.fin ? hoy : abierto.inicio) : hoy);
    });
  }, [ciudad]);

  const cargar = useCallback(async () => {
    if (!fecha) return;
    setFilas(null);
    setError('');
    const { data, error } = await db().rpc('turnos_del_dia', { p_fecha: fecha, p_ciudad: ciudad });
    if (error) setError(error.message);
    setFilas((data as Fila[]) ?? []);
    setAlertas(null);
    const a = await db().rpc('alertas_del_dia', { p_ciudad: ciudad, p_fecha: fecha });
    if (a.error) setError(a.error.message);
    setAlertas((a.data as Alerta[]) ?? []);
    const h = await db().from('horario_atencion').select('*').eq('ciudad_id', ciudad).maybeSingle();
    setHorario((h.data as Horario) ?? null);
  }, [fecha, ciudad]);
  useEffect(() => { cargar(); }, [cargar]);

  const periodo = periodos.find((p) => p.inicio <= fecha && fecha <= p.fin);
  const cerrado = periodo?.estado === 'cerrado';
  const editable = puedeEditar && !!periodo && !cerrado;

  const conteo = useMemo(() => {
    const c: Record<string, number> = {};
    (filas ?? []).forEach((f) => (c[f.estado] = (c[f.estado] ?? 0) + 1));
    return c;
  }, [filas]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (filas ?? []).filter((f) =>
      (!soloPendientes || f.estado === 'sin_cubrir') &&
      (!q || [f.puesto, f.programado_nombre, f.realizado_nombre].some((x) => x?.toLowerCase().includes(q))));
  }, [filas, busqueda, soloPendientes]);

  const porPuesto = useMemo(() => {
    const m = new Map<string, Fila[]>();
    visibles.forEach((f) => { const k = f.puesto ?? '(sin puesto)'; (m.get(k) ?? m.set(k, []).get(k)!).push(f); });
    return [...m.entries()];
  }, [visibles]);

  const terminar = (mensaje: string) => { setAccion(null); setAviso(mensaje); cargar(); };
  const cerradas = (alertas ?? []).filter((a) => a.reporte && (a.reporte.estado === 'resuelta' || a.reporte.estado === 'cerrada'));
  const activas = (alertas ?? []).filter((a) => !cerradas.includes(a));
  const tomar = async (a: Alerta) => {
    const { error } = await db().rpc('tomar_alerta_reportada', { p_id: a.reporte!.id });
    if (error) { setError(error.message); return; }
    setAviso(`Usted tomó el reporte de ${a.puesto ?? a.empleado ?? 'este puesto'}.`); cargar();
  };

  return (
    <section style={{ display: 'grid', gap: 14 }}>
      <div>
        <div className="barra-filtros">
          <label className="campo" style={{ flex: '0 1 180px' }}>Fecha
            <input type="date" value={fecha} onChange={(e) => { setFecha(e.target.value); setAviso(''); }} />
          </label>
          <label className="campo">Buscar guarda o puesto
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Nombre o puesto" />
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', minHeight: 42 }}>
            <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} /> Solo sin cubrir
          </label>
        </div>
        <p className="texto-suave" style={{ margin: 0, fontSize: 14 }}>
          {periodo ? <>Periodo {periodo.inicio} a {periodo.fin} — {cerrado ? <span className="badge gris">cerrado (solo consulta)</span> : <span className="badge verde">abierto</span>}</> : 'Esta fecha no pertenece a ningún periodo.'}
          {!puedeEditar && ' · Tu rol es de consulta.'}
        </p>
      </div>
      {aviso && <div className="aviso-caja ok" style={{ margin: 0 }}>{aviso}</div>}
      {error && <div className="aviso-caja error" style={{ margin: 0 }}>{error}</div>}
      <div className="card" style={{ padding: '10px 14px', fontSize: 14, display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center', margin: 0 }}>
        <Clock size={16} aria-hidden />
        <span style={{ flex: '1 1 260px' }}>
          {horario ? <>Programación atiende <b>{textoDias(horario.dias)} de {horario.desde.slice(0, 5)} a {horario.hasta.slice(0, 5)}</b>{horario.atiende_festivos ? ' (también festivos)' : ''}.
            {' '}Fuera de ese horario los reportes los resuelve el supervisor. Si nadie toma un reporte en {horario.minutos_respaldo} minutos, se avisa también al supervisor.</> : 'Cargando horario…'}
        </span>
        {acceso.rol === 'admin' && horario && <button className="secundario chico" onClick={() => setAccion({ tipo: 'horario' })}>Cambiar horario</button>}
        {editable && <button className="chico" onClick={() => setAccion({ tipo: 'reporte' })}><Plus size={14} style={{ verticalAlign: '-3px', marginRight: 6 }} />Registrar reporte del supervisor</button>}
      </div>
      <h3 className="titulo-seccion" style={{ margin: 0 }}>Alertas</h3>
      {alertas === null ? <p className="texto-suave">Cargando…</p> : activas.length === 0 ? (
        <div className="aviso-caja ok" style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center' }}><CheckCircle2 size={16} aria-hidden />Sin alertas para este día.</div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {activas.map((a) => (
            <div key={a.clave} className="card" style={{ padding: '10px 14px', fontSize: 14, display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center', borderColor: a.avisado_en || a.reporte?.estado === 'tomada' ? undefined : '#fecaca' }}>
              <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                <span className={`badge ${ALERTA[a.tipo].badge}`}>{a.reporte ? REPORTE[a.reporte.tipo] ?? ALERTA.reportada.texto : ALERTA[a.tipo].texto}</span>
                <span style={{ marginLeft: 8 }}><b>{a.puesto ?? ''}</b>{a.desde && a.tipo !== 'devuelta' ? <> · <span className="num">{rango(a.desde, a.hasta)}</span></> : null}</span>
                <div style={{ marginTop: 3 }}>
                  {a.reporte && <>{a.empleado ? <>Guarda: {a.empleado}. </> : ''}{a.detalle ? <>"{a.detalle}" </> : ''}
                    <span className="texto-suave">Reportó {a.reporte.reportado_por ?? 'el supervisor'}{a.reporte.origen === 'securityops' ? ` en SecurityOps${a.reporte.id_externo ? ` (${a.reporte.id_externo})` : ''}` : ''} · {new Date(a.reporte.creado_en).toLocaleTimeString('es-CO', { timeStyle: 'short' })}</span>
                    <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {a.reporte.estado === 'tomada'
                        ? <span className="badge verde">Tomado{a.reporte.tomada_por ? ` por ${a.reporte.tomada_por}` : ''} · {new Date(a.reporte.tomada_en!).toLocaleTimeString('es-CO', { timeStyle: 'short' })}</span>
                        : <span className={`badge ${RESPONSABLE[a.reporte.responsable].badge}`}>{RESPONSABLE[a.reporte.responsable].texto}</span>}
                    </div></>}
                  {a.tipo === 'sin_cubrir' && <>Era de {a.empleado}{a.detalle ? <> · <span className="badge rojo">{NOVEDAD_TEXTO[a.detalle] ?? a.detalle}</span></> : ''}. Nadie lo está haciendo.</>}
                  {a.tipo === 'descubierto' && a.detalle}
                  {a.tipo === 'regla' && <>{a.empleado}: {(a.avisos ?? []).map((x) => AVISO_TEXTO[x] ?? x).join('; ')}.</>}
                  {a.tipo === 'devuelta' && <>{a.empleado}. Operaciones debe corregir: {a.detalle ?? '—'}</>}
                </div>
                {a.avisado_en && <div className="texto-suave" style={{ fontSize: 12, marginTop: 3 }}><BellRing size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />Avisada a Operaciones {new Date(a.avisado_en).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}{a.nota ? ` · ${a.nota}` : ''}</div>}
              </div>
              {editable && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
                  {a.reporte?.estado === 'abierta' && <button className="secundario chico" onClick={() => tomar(a)}><Hand size={14} style={{ verticalAlign: '-3px', marginRight: 6 }} />Tomar</button>}
                  {a.tipo === 'devuelta'
                    ? irA && <button className="chico" onClick={() => irA('novedades')}>Ver en Novedades</button>
                    : (a.tipo !== 'regla' || a.turno_id) && <button className="chico" onClick={() => setAccion({ tipo: 'resolver', alerta: a })}><UserCheck size={14} style={{ verticalAlign: '-3px', marginRight: 6 }} />{a.reporte ? 'Escoger reemplazo' : 'Resolver aquí'}</button>}
                  {a.reporte && <button className="secundario chico" onClick={() => setAccion({ tipo: 'cerrar', alerta: a })}><XCircle size={14} style={{ verticalAlign: '-3px', marginRight: 6 }} />Cerrar sin reemplazo</button>}
                  <button className="secundario chico" onClick={() => setAccion({ tipo: 'avisar', alerta: a })}><BellRing size={14} style={{ verticalAlign: '-3px', marginRight: 6 }} />{a.avisado_en ? 'Avisar de nuevo' : a.reporte ? 'Avisar al supervisor' : 'Avisar a Operaciones'}</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {cerradas.length > 0 && (
        <div>
          <button className="secundario chico" onClick={() => setVerResueltas(!verResueltas)}>{verResueltas ? 'Ocultar' : 'Ver'} reportes resueltos ({cerradas.length})</button>
          {verResueltas && (
            <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
              {cerradas.map((a) => (
                <div key={a.clave} className="card" style={{ padding: '8px 14px', fontSize: 13 }}>
                  <span className="badge gris">{a.reporte!.estado === 'resuelta' ? 'Resuelto' : 'Cerrado sin reemplazo'}</span>{' '}
                  <b>{a.puesto}</b> · <span className="num">{rango(a.desde, a.hasta)}</span> · {a.empleado ?? ''}
                  {a.reporte!.reemplazo && <> → cubre <b>{a.reporte!.reemplazo}</b></>}
                  {a.reporte!.nota && <span className="texto-suave"> · {a.reporte!.nota}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <h3 className="titulo-seccion" style={{ margin: '8px 0 0' }}>Todo el día (consulta)</h3>
      <div className="kpis">
        {(Object.keys(ESTADO) as Fila['estado'][]).map((k) => (
          <div key={k} className={`kpi${KPI[k]?.(conteo[k] ?? 0) ?? ''}`}><small>{ESTADO[k].texto}</small><strong>{conteo[k] ?? 0}</strong></div>
        ))}
      </div>
      {filas === null ? <p>Cargando…</p> : porPuesto.length === 0 ? <div className="vacio">No hay turnos para mostrar.</div> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {porPuesto.map(([puesto, fs]) => (
            <div key={puesto} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ background: 'var(--soft)', padding: '9px 14px', fontWeight: 700, fontSize: 14, borderBottom: '1px solid var(--line)' }}>{puesto}</div>
              {fs.map((f, i) => (
                <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', padding: '10px 14px', borderTop: i ? '1px solid var(--line)' : undefined, alignItems: 'center', fontSize: 14 }}>
                  <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                    <div className="texto-suave" style={{ fontSize: 12 }}>Programado</div>
                    {f.programado_nombre ? <>{f.programado_nombre} · <span className="num">{rango(f.programado_inicio, f.programado_fin)}</span></> : '—'}
                    {f.novedad && <div style={{ marginTop: 3 }}><span className="badge rojo">{NOVEDAD_TEXTO[f.novedad] ?? f.novedad}</span></div>}
                  </div>
                  <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                    <div className="texto-suave" style={{ fontSize: 12 }}>Realizado</div>
                    {f.realizado_nombre ? <>{f.realizado_nombre} · <span className="num">{rango(f.realizado_inicio, f.realizado_fin)}</span></> : <span style={{ color: 'var(--red)', fontWeight: 600 }}>Nadie</span>}
                    <div style={{ marginTop: 3 }}><span className={`badge ${ESTADO[f.estado].badge}`}>{ESTADO[f.estado].texto}</span></div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {accion && (
        <Modal onCerrar={() => setAccion(null)}>
          {accion.tipo === 'resolver' && <FormResolver alerta={accion.alerta} ciudad={ciudad} onListo={terminar} onCancelar={() => setAccion(null)} />}
          {accion.tipo === 'avisar' && <FormAvisar alerta={accion.alerta} ciudad={ciudad} fecha={fecha} onListo={terminar} onCancelar={() => setAccion(null)} />}
          {accion.tipo === 'cerrar' && <FormCerrar alerta={accion.alerta} onListo={terminar} onCancelar={() => setAccion(null)} />}
          {accion.tipo === 'reporte' && <FormReporte ciudad={ciudad} fecha={fecha} onListo={(m) => { terminar(m); }} onCancelar={() => setAccion(null)} />}
          {accion.tipo === 'horario' && horario && <FormHorario horario={horario} onListo={terminar} onCancelar={() => setAccion(null)} />}
        </Modal>
      )}
    </section>
  );
}

/** Resolver aquí: guardas sugeridos para el puesto y el horario de la alerta. */
function FormResolver({ alerta, ciudad, onListo, onCancelar }: { alerta: Alerta; ciudad: string; onListo: (m: string) => void; onCancelar: () => void }) {
  const [sugeridos, setSugeridos] = useState<Sugerido[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    db().rpc('sugerir_para_franja', { p_ciudad: ciudad, p_puesto: alerta.puesto_id, p_inicio: alerta.desde, p_fin: alerta.hasta,
      p_excluir: alerta.tipo === 'sin_cubrir' ? null : alerta.empleado_id, p_limite: 12 })
      .then(({ data, error }) => { if (error) setError(error.message); setSugeridos((data as Sugerido[]) ?? []); });
  }, [alerta, ciudad]);
  const elegir = async (s: Sugerido) => {
    const { data, error } = await conMotivo((motivo) =>
      alerta.tipo === 'reportada' ? db().rpc('resolver_alerta_reportada', { p_id: alerta.reporte!.id, p_empleado: s.empleado_id, p_comentario: motivo })
      : alerta.tipo === 'sin_cubrir' ? db().rpc('cubrir_turno', { p_turno_programado: alerta.turno_programado_id, p_empleado: s.empleado_id, p_origen: 'cambio', p_comentario: motivo })
      : alerta.tipo === 'descubierto' ? db().rpc('agregar_turno', { p_puesto: alerta.puesto_id, p_empleado: s.empleado_id, p_inicio: alerta.desde, p_fin: alerta.hasta, p_comentario: motivo })
      : db().rpc('reemplazar_guarda', { p_turno: alerta.turno_id, p_empleado: s.empleado_id, p_comentario: motivo }));
    if (error) { setError(error.message); return; }
    const av = ((data as { avisos: string[] }).avisos ?? []).map((a) => AVISO_TEXTO[a] ?? a);
    onListo(`Listo: ${s.nombre} queda en ${alerta.puesto ?? 'el puesto'} ${rango(alerta.desde, alerta.hasta)}.${av.length ? ' Quedó registrado el motivo de: ' + av.join(', ') + '.' : ''}`
      + (alerta.tipo === 'reportada' && (data as { novedad_id?: number }).novedad_id ? ' Quedó la novedad por revisar en Novedades: confirme qué fue y aplíquela.' : '')
      + (alerta.tipo === 'reportada' ? ` Avísele a ${s.nombre} por llamada o WhatsApp. El supervisor lo verá en SecurityOps cuando esté conectado; mientras tanto, avísele también.` : ''));
  };
  return (
    <>
      <h3 style={{ margin: 0 }}>{alerta.tipo === 'regla' ? 'Cambiar el guarda del turno' : alerta.tipo === 'reportada' ? 'Escoger reemplazo' : 'Cubrir'}</h3>
      <p className="texto-suave" style={{ margin: 0, fontSize: 14 }}>{alerta.puesto} · {rango(alerta.desde, alerta.hasta)}{alerta.empleado ? ` · ${alerta.tipo === 'regla' ? 'hoy lo hace' : 'era de'} ${alerta.empleado}` : ''}</p>
      {error && <div className="aviso-caja error" style={{ margin: 0 }}>{error}</div>}
      {sugeridos === null ? <p className="texto-suave">Buscando guardas disponibles…</p> : sugeridos.length === 0 ? <div className="vacio">No hay guardas disponibles sin cruce de horario. Avise a Operaciones.</div> : (
        <div style={{ maxHeight: 360, overflow: 'auto', display: 'grid', gap: 6 }}>
          {sugeridos.map((s) => (
            <button key={s.empleado_id} className="secundario" onClick={() => elegir(s)} style={{ textAlign: 'left' }}>
              <b>{s.nombre}</b>
              <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400, marginTop: 2 }}>
                {s.conoce_el_puesto && <><span className="badge verde">Conoce el puesto</span>{' '}</>}{Number(s.horas_7_dias).toLocaleString('es-CO')} h en los últimos 7 días
                {s.avisos.length > 0 && <span style={{ color: 'var(--amber)', fontWeight: 600 }}> · {s.avisos.map((a) => AVISO_TEXTO[a] ?? a).join(', ')}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
      <button className="secundario" onClick={onCancelar}>Cancelar</button>
    </>
  );
}

/** Avisar a Operaciones: queda registrado quién y cuándo; el texto se puede copiar para enviarlo. */
function FormAvisar({ alerta, ciudad, fecha, onListo, onCancelar }: { alerta: Alerta; ciudad: string; fecha: string; onListo: (m: string) => void; onCancelar: () => void }) {
  const texto = `Programación · ${alerta.reporte ? 'Reporte' : ALERTA[alerta.tipo].texto}: ${alerta.puesto ?? alerta.empleado ?? ''} ${alerta.tipo !== 'devuelta' ? rango(alerta.desde, alerta.hasta) : ''} (${fecha}).`
    + (alerta.tipo === 'sin_cubrir' ? ` Era de ${alerta.empleado}; nadie lo está haciendo.` : '')
    + (alerta.reporte ? ` ${REPORTE[alerta.reporte.tipo]}${alerta.empleado ? ` · ${alerta.empleado}` : ''}${alerta.detalle ? ` · ${alerta.detalle}` : ''}. Aún sin reemplazo.` : '')
    + (alerta.tipo === 'regla' ? ` ${alerta.empleado}: ${(alerta.avisos ?? []).map((x) => AVISO_TEXTO[x] ?? x).join('; ')}.` : '')
    + (alerta.tipo === 'descubierto' || alerta.tipo === 'devuelta' ? ` ${alerta.detalle ?? ''}` : '');
  const [nota, setNota] = useState(alerta.nota ?? '');
  const [error, setError] = useState('');
  const [copiado, setCopiado] = useState(false);
  const guardar = async () => {
    const { error } = await db().rpc('avisar_operaciones', { p_ciudad: ciudad, p_fecha: fecha, p_clave: alerta.clave, p_nota: nota || null });
    if (error) { setError(error.message); return; }
    onListo('Quedó registrado el aviso a Operaciones. La alerta sigue a la vista hasta que se resuelva.');
  };
  return (
    <>
      <h3 style={{ margin: 0 }}>Avisar a Operaciones</h3>
      <p className="texto-suave" style={{ margin: 0, fontSize: 14 }}>Copie el mensaje y envíelo por el canal de Operaciones. Aquí queda registrado el aviso para hacerle seguimiento.</p>
      <div className="card" style={{ padding: 10, fontSize: 14 }}>{texto}</div>
      <button className="secundario" onClick={() => { navigator.clipboard?.writeText(texto).then(() => setCopiado(true)); }}>{copiado ? 'Copiado' : 'Copiar mensaje'}</button>
      <label className="campo">Nota (a quién se avisó, qué respondió)<input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="p. ej. Le avisé al supervisor de zona" /></label>
      {error && <div className="aviso-caja error" style={{ margin: 0 }}>{error}</div>}
      <button onClick={guardar}>Registrar aviso</button>
      <button className="secundario" onClick={onCancelar}>Cancelar</button>
    </>
  );
}

/** Cerrar un reporte sin reemplazo (p. ej. el guarda llegó tarde y ya está en el puesto). */
function FormCerrar({ alerta, onListo, onCancelar }: { alerta: Alerta; onListo: (m: string) => void; onCancelar: () => void }) {
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');
  const guardar = async () => {
    const { error } = await db().rpc('cerrar_alerta_reportada', { p_id: alerta.reporte!.id, p_nota: nota });
    if (error) { setError(error.message); return; }
    onListo('Reporte cerrado sin reemplazo. Quedó registrada la nota.');
  };
  return (
    <>
      <h3 style={{ margin: 0 }}>Cerrar sin reemplazo</h3>
      <p className="texto-suave" style={{ margin: 0, fontSize: 14 }}>{alerta.puesto} · {rango(alerta.desde, alerta.hasta)}{alerta.empleado ? ` · ${alerta.empleado}` : ''}</p>
      <label className="campo">Por qué no hace falta reemplazo<input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="p. ej. llegó tarde y ya está en el puesto" /></label>
      {error && <div className="aviso-caja error" style={{ margin: 0 }}>{error}</div>}
      <button disabled={!nota.trim()} onClick={guardar}>Cerrar reporte</button>
      <button className="secundario" onClick={onCancelar}>Cancelar</button>
    </>
  );
}

/** Registrar a mano lo que reporta el supervisor (mientras SecurityOps no lo envíe solo). */
function FormReporte({ ciudad, fecha, onListo, onCancelar }: { ciudad: string; fecha: string; onListo: (m: string) => void; onCancelar: () => void }) {
  const [tipo, setTipo] = useState<keyof typeof REPORTE>('turno_por_cubrir');
  const [documento, setDocumento] = useState('');
  const [dia, setDia] = useState(fecha);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [puesto, setPuesto] = useState('');
  const [puestos, setPuestos] = useState<{ id: number; nombre: string }[]>([]);
  const [reportado, setReportado] = useState('');
  const [detalle, setDetalle] = useState('');
  const [quien, setQuien] = useState<{ nombre: string } | null | undefined>(undefined);
  const [error, setError] = useState('');
  useEffect(() => {
    db().from('puestos').select('id, nombre').eq('ciudad_id', ciudad).eq('activo', true).order('nombre').then(({ data }) => setPuestos((data as { id: number; nombre: string }[]) ?? []));
  }, [ciudad]);
  useEffect(() => {
    const d = documento.replace(/\D/g, '');
    if (d.length < 5) { setQuien(undefined); return; }
    const t = setTimeout(() => {
      db().from('empleados').select('nombre').ilike('documento', `%${d}%`).limit(1).then(({ data }) => setQuien(((data as { nombre: string }[]) ?? [])[0] ?? null));
    }, 300);
    return () => clearTimeout(t);
  }, [documento]);
  const guardar = async () => {
    setError('');
    if (!desde) { setError('Escriba desde qué hora hay que cubrir.'); return; }
    let fin: string | null = null;
    if (hasta) {
      const otroDia = hasta <= desde ? new Date(new Date(`${dia}T12:00:00`).getTime() + 864e5).toISOString().slice(0, 10) : dia;
      fin = `${otroDia}T${hasta}`;
    }
    const { error } = await db().rpc('registrar_alerta_reportada', {
      p_ciudad: ciudad, p_tipo: tipo, p_documento: documento.trim() || null, p_desde: `${dia}T${desde}`, p_hasta: fin,
      p_puesto: puesto ? Number(puesto) : null, p_detalle: detalle || null, p_origen: 'manual', p_id_externo: null, p_reportado_por: reportado || null,
    });
    if (error) { setError(error.message); return; }
    onListo('Reporte registrado. Aparece en Alertas para escoger el reemplazo.');
  };
  return (
    <>
      <h3 style={{ margin: 0 }}>Registrar reporte del supervisor</h3>
      <p className="texto-suave" style={{ margin: 0, fontSize: 14 }}>Lo que llega por WhatsApp o llamada mientras SecurityOps no lo envíe solo.</p>
      <label className="campo">Qué pasó
        <select value={tipo} onChange={(e) => setTipo(e.target.value as keyof typeof REPORTE)}>
          {Object.entries(REPORTE).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select>
      </label>
      <label className="campo">Cédula del guarda (si aplica)
        <input value={documento} onChange={(e) => setDocumento(e.target.value)} inputMode="numeric" />
        {quien === null && <small style={{ color: '#b91c1c' }}>No está en Programación; indique el puesto y el horario.</small>}
        {quien && <small>{quien.nombre}</small>}
      </label>
      <label className="campo">Puesto (si no lo indica, se toma del turno del guarda)
        <select value={puesto} onChange={(e) => setPuesto(e.target.value)}>
          <option value="">— Del turno del guarda —</option>
          {puestos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label className="campo" style={{ flex: '1 1 140px' }}>Fecha<input type="date" value={dia} onChange={(e) => setDia(e.target.value)} /></label>
        <label className="campo" style={{ flex: '1 1 100px' }}>Desde la hora<input type="time" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="campo" style={{ flex: '1 1 100px' }}>Hasta la hora<input type="time" value={hasta} onChange={(e) => setHasta(e.target.value)} placeholder="Del turno" /></label>
      </div>
      <label className="campo">Quién lo reportó<input value={reportado} onChange={(e) => setReportado(e.target.value)} placeholder="Supervisor de zona, radio operador…" /></label>
      <label className="campo">Detalle (opcional)<input value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="p. ej. no llegó, no contesta" /></label>
      {error && <div className="aviso-caja error" style={{ margin: 0 }}>{error}</div>}
      <button onClick={guardar}>Registrar</button>
      <button className="secundario" onClick={onCancelar}>Cancelar</button>
    </>
  );
}

/** Horario de atención de Programación en la ciudad (solo el administrador). */
function FormHorario({ horario, onListo, onCancelar }: { horario: Horario; onListo: (m: string) => void; onCancelar: () => void }) {
  const [dias, setDias] = useState<number[]>(horario.dias);
  const [desde, setDesde] = useState(horario.desde.slice(0, 5));
  const [hasta, setHasta] = useState(horario.hasta.slice(0, 5));
  const [festivos, setFestivos] = useState(horario.atiende_festivos);
  const [respaldo, setRespaldo] = useState(String(horario.minutos_respaldo));
  const [error, setError] = useState('');
  const guardar = async () => {
    const { error } = await db().rpc('guardar_horario_atencion', { p_ciudad: horario.ciudad_id, p_dias: dias, p_desde: desde, p_hasta: hasta,
      p_atiende_festivos: festivos, p_minutos_respaldo: Number(respaldo) });
    if (error) { setError(error.message); return; }
    onListo('Horario de Programación actualizado.');
  };
  return (
    <>
      <h3 style={{ margin: 0 }}>Horario de Programación</h3>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {DIAS.map((d, i) => (
          <label key={d} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={dias.includes(i + 1)} onChange={(e) => setDias(e.target.checked ? [...dias, i + 1] : dias.filter((x) => x !== i + 1))} />{d}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label className="campo" style={{ flex: '1 1 100px' }}>Desde<input type="time" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="campo" style={{ flex: '1 1 100px' }}>Hasta<input type="time" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <label className="campo" style={{ flex: '1 1 140px' }}>Minutos de respaldo<input type="number" min={5} max={240} value={respaldo} onChange={(e) => setRespaldo(e.target.value)} /></label>
      </div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={festivos} onChange={(e) => setFestivos(e.target.checked)} /> También atiende festivos</label>
      {error && <div className="aviso-caja error" style={{ margin: 0 }}>{error}</div>}
      <button onClick={guardar}>Guardar</button>
      <button className="secundario" onClick={onCancelar}>Cancelar</button>
    </>
  );
}
