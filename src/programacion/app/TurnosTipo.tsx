// Turnos tipo: ver, crear, editar y unir rotaciones G1, G2, G3… en un solo turno tipo con grupos.
// Lo edita el administrador; lo ya generado en el periodo no cambia (aplica a lo que se programe después).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Merge, Trash2 } from 'lucide-react';
import { db } from './supabase.ts';
import { Modal } from './ui.tsx';
import { horasDelDia, revisarDias, unirGrupos, type DiaPatron } from '../motor/patrones.ts';

export interface PatronFila {
  id: number; codigo: string; tipo: string; ciclo_dias: number; dias: DiaPatron[]; horario_festivo: DiaPatron | null;
  grupos: number; desfase_grupos: number; descripcion: string | null; activo: boolean;
}
interface Uso { patron_id: number; guardas: number; puestos: number }

const TIPO: Record<string, string> = { rotativo: 'Rotativo', semanal: 'Semanal', plan_mensual: 'Plan a mano', catalogo_cliente: 'Catálogo del cliente', manual: 'Manual' };
const SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DESCANSO: DiaPatron = { tramos: [] };
const DIA: DiaPatron = { tramos: [{ inicio: '06:00', fin: '18:00' }] };
const NOCHE: DiaPatron = { tramos: [{ inicio: '18:00', fin: '06:00' }] };

/** Día (D), noche (N) u otro horario (H), para pintar el ciclo. */
function claseDia(d: DiaPatron): { clase: string; letra: string } {
  if (!d || d.tramos.length === 0) return { clase: 'descanso', letra: '·' };
  const h = Number(d.tramos[0].inicio.slice(0, 2));
  if (d.tramos.length === 1 && h >= 4 && h < 12) return { clase: 'dia', letra: 'D' };
  if (d.tramos.length === 1 && (h >= 16 || h < 4)) return { clase: 'noche', letra: 'N' };
  return { clase: 'otro', letra: 'H' };
}
const textoDia = (d: DiaPatron) => (d.tramos.length ? d.tramos.map((t) => `${t.inicio}–${t.fin}`).join(' y ') : 'Descanso');

/** El ciclo en fichas de colores (máximo `max` días). */
export function TiraCiclo({ dias, etiquetas, max = 14, enLinea = false }: { dias: DiaPatron[]; etiquetas?: string[]; max?: number; enLinea?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', gap: 3, flexWrap: enLinea ? 'nowrap' : 'wrap', alignItems: 'center' }}>
      {dias.slice(0, max).map((d, i) => {
        const c = claseDia(d);
        return <span key={i} className={`celda ${c.clase}`} title={`${etiquetas?.[i] ?? `Día ${i + 1}`}: ${textoDia(d)}`}>{c.letra}</span>;
      })}
      {dias.length > max && <span style={{ fontSize: 12, color: 'var(--muted)' }}>+{dias.length - max}</span>}
    </span>
  );
}

const horasCiclo = (dias: DiaPatron[]) => dias.reduce((s, d) => s + horasDelDia(d), 0);
const fmt = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 1 });

/** Familias "…-G1", "…-G2"… activas, rotativas y sin grupos: candidatas a unirse. */
function familias(lista: PatronFila[]) {
  const por = new Map<string, PatronFila[]>();
  for (const p of lista) {
    const m = /^(.*)-G(\d+)$/.exec(p.codigo);
    if (!m || !p.activo || p.tipo !== 'rotativo' || p.grupos !== 1) continue;
    por.set(m[1], [...(por.get(m[1]) ?? []), p]);
  }
  return [...por.entries()]
    .map(([base, ps]) => {
      const orden = ps.sort((a, b) => Number(/-G(\d+)$/.exec(a.codigo)![1]) - Number(/-G(\d+)$/.exec(b.codigo)![1]));
      return { base, patrones: orden, union: unirGrupos(orden.map((p) => p.dias)) };
    })
    .filter((f) => f.patrones.length > 1);
}

export function TurnosTipo({ ciudad, esAdmin }: { ciudad: string; esAdmin: boolean }) {
  const [lista, setLista] = useState<PatronFila[] | null>(null);
  const [uso, setUso] = useState<Map<number, Uso>>(new Map());
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState<'activos' | 'inactivos' | 'todos'>('activos');
  const [editando, setEditando] = useState<PatronFila | 'nuevo' | null>(null);
  const [uniendo, setUniendo] = useState<ReturnType<typeof familias>[number] | null>(null);
  const [mensaje, setMensaje] = useState<{ t: string; tipo: 'ok' | 'error' } | null>(null);

  const cargar = useCallback(() => {
    db().from('patrones_turno').select('id, codigo, tipo, ciclo_dias, dias, horario_festivo, grupos, desfase_grupos, descripcion, activo')
      .or(`ciudad_id.eq.${ciudad},ciudad_id.is.null`).order('codigo').limit(2000)
      .then(({ data, error }) => { if (error) setMensaje({ t: error.message, tipo: 'error' }); setLista((data as PatronFila[]) ?? []); });
    db().rpc('uso_turnos_tipo', { p_ciudad: ciudad }).then(({ data }) => setUso(new Map(((data as Uso[]) ?? []).map((u) => [u.patron_id, u]))));
  }, [ciudad]);
  useEffect(() => { cargar(); }, [cargar]);

  const vis = useMemo(() => (lista ?? []).filter((p) =>
    (estado === 'todos' || (estado === 'activos') === p.activo) && (!q || p.codigo.toLowerCase().includes(q.toLowerCase()))), [lista, q, estado]);
  const fams = useMemo(() => familias(lista ?? []), [lista]);
  const unibles = fams.filter((f) => 'desfase' in f.union);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
        <label style={{ display: 'grid', gap: 6, flex: '1 1 240px' }}>Buscar
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre del turno tipo (24H, L:V, 06-18…)" />
        </label>
        <label style={{ display: 'grid', gap: 6, width: 160 }}>Mostrar
          <select value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)}>
            <option value="activos">Activos</option><option value="inactivos">Inactivos</option><option value="todos">Todos</option>
          </select>
        </label>
        {esAdmin && <button onClick={() => setEditando('nuevo')}><Plus size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />Nuevo turno tipo</button>}
      </div>
      {mensaje && <div className={`aviso-caja ${mensaje.tipo}`}>{mensaje.t}</div>}

      {esAdmin && unibles.length > 0 && (
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <div>
            <strong>Rotaciones que se pueden unir</strong>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--muted)' }}>
              Son la misma rotación corrida unos días (G1, G2, G3). Unidas quedan como un solo turno tipo con grupos: cada guarda conserva su grupo y sus turnos no cambian.
            </p>
          </div>
          {unibles.map((f) => (
            <div key={f.base} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <b style={{ overflowWrap: 'anywhere' }}>{f.base}</b>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {f.patrones.length} grupos · cada grupo {'desfase' in f.union ? f.union.desfase : 0} días después del anterior ·{' '}
                  {f.patrones.reduce((s, p) => s + (uso.get(p.id)?.guardas ?? 0), 0)} guardas
                </div>
              </div>
              <TiraCiclo dias={f.patrones[0].dias} />
              <button className="secundario chico" onClick={() => setUniendo(f)}><Merge size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />Unir</button>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        {lista === null ? <p style={{ padding: 16 }}>Cargando…</p> : vis.length === 0 ? <div className="vacio">No hay turnos tipo con ese filtro.</div> : (
          <table>
            <thead><tr><th>Turno tipo</th><th>Ciclo</th><th>Horas</th><th>Guardas</th><th /></tr></thead>
            <tbody>
              {vis.slice(0, 150).map((p) => {
                const u = uso.get(p.id);
                const editable = p.tipo === 'rotativo' || p.tipo === 'semanal';
                return (
                  <tr key={p.id} style={{ opacity: p.activo ? 1 : 0.55 }}>
                    <td style={{ minWidth: 220 }}>
                      <strong style={{ overflowWrap: 'anywhere' }}>{p.codigo}</strong>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                        <span className={`badge ${p.tipo === 'rotativo' ? '' : p.tipo === 'semanal' ? 'morado' : 'gris'}`}>{TIPO[p.tipo] ?? p.tipo}</span>
                        {p.grupos > 1 && <span className="badge verde">{p.grupos} grupos · desfase {p.desfase_grupos} días</span>}
                        {!p.activo && <span className="badge gris">Inactivo</span>}
                      </div>
                    </td>
                    <td>{editable ? <TiraCiclo dias={p.dias} etiquetas={p.tipo === 'semanal' ? SEMANA : undefined} enLinea /> : <span style={{ color: 'var(--muted)', fontSize: 13 }}>Plan del mes</span>}</td>
                    <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {editable ? <>{fmt(horasCiclo(p.dias) / p.dias.length * 7)} h/sem<div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.tipo === 'rotativo' ? `ciclo de ${p.ciclo_dias} días` : 'lunes a domingo'}</div></> : '—'}
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{u ? <>{u.guardas}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{u.puestos} puesto{u.puestos === 1 ? '' : 's'}</div></> : <span style={{ color: 'var(--muted)' }}>0</span>}</td>
                    <td style={{ textAlign: 'right' }}>
                      {esAdmin && editable && <button className="secundario chico" onClick={() => setEditando(p)}><Pencil size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Editar</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {vis.length > 150 && <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>Se muestran 150 de {vis.length}; use el buscador para ver los demás.</p>}

      {editando && (
        <Modal ancho={760} onCerrar={() => setEditando(null)}>
          <EditorTurnoTipo ciudad={ciudad} inicial={editando === 'nuevo' ? null : editando} guardas={editando === 'nuevo' ? 0 : uso.get(editando.id)?.guardas ?? 0}
            onListo={(t) => { setEditando(null); setMensaje({ t, tipo: 'ok' }); cargar(); }} onCancelar={() => setEditando(null)} />
        </Modal>
      )}
      {uniendo && 'desfase' in uniendo.union && (
        <Modal onCerrar={() => setUniendo(null)}>
          <UnirGrupos familia={uniendo} desfase={uniendo.union.desfase} guardas={uniendo.patrones.reduce((s, p) => s + (uso.get(p.id)?.guardas ?? 0), 0)}
            onListo={(t) => { setUniendo(null); setMensaje({ t, tipo: 'ok' }); cargar(); }} onCancelar={() => setUniendo(null)} />
        </Modal>
      )}
    </div>
  );
}

function UnirGrupos({ familia, desfase, guardas, onListo, onCancelar }: {
  familia: ReturnType<typeof familias>[number]; desfase: number; guardas: number; onListo: (t: string) => void; onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState(familia.base);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const unir = async () => {
    setEnviando(true);
    const { data, error } = await db().rpc('unir_grupos_turno_tipo', { p_patrones: familia.patrones.map((p) => p.id), p_codigo: nombre });
    setEnviando(false);
    if (error) { setError(error.message); return; }
    const r = data as { grupos: number; asignaciones_movidas: number };
    onListo(`Listo: «${nombre}» queda con ${r.grupos} grupos; ${r.asignaciones_movidas} guardas pasaron a su grupo. Sus turnos no cambiaron.`);
  };
  return (
    <>
      <h3 style={{ margin: 0 }}>Unir en un solo turno tipo</h3>
      <div style={{ display: 'grid', gap: 6 }}>
        {familia.patrones.map((p, i) => (
          <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="badge" style={{ minWidth: 70 }}>Grupo {i + 1}</span><TiraCiclo dias={p.dias} />
          </div>
        ))}
      </div>
      <div className="aviso-caja">
        Cada grupo va {desfase} días después del anterior. Los {guardas} guardas vigentes quedan en su grupo, sus turnos programados no cambian y los turnos tipo G2 en adelante quedan inactivos.
      </div>
      <label style={{ display: 'grid', gap: 6 }}>Nombre del turno tipo unido
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </label>
      {error && <div className="aviso-caja error">{error}</div>}
      <button onClick={unir} disabled={enviando || !nombre.trim()}>{enviando ? 'Uniendo…' : `Unir ${familia.patrones.length} grupos`}</button>
      <button className="secundario" onClick={onCancelar}>Cancelar</button>
    </>
  );
}

const PLANTILLAS: { nombre: string; tipo: 'rotativo' | 'semanal'; dias: DiaPatron[]; grupos?: number; desfase?: number }[] = [
  { nombre: '24 h con 3 grupos (2 días, 2 noches, 2 descansos)', tipo: 'rotativo', dias: [DIA, DIA, NOCHE, NOCHE, DESCANSO, DESCANSO], grupos: 3, desfase: 2 },
  { nombre: '12 h de día (4 días, 2 descansos)', tipo: 'rotativo', dias: [DIA, DIA, DIA, DIA, DESCANSO, DESCANSO] },
  { nombre: 'Lunes a viernes 07:00–17:00', tipo: 'semanal', dias: [0, 1, 2, 3, 4].map(() => ({ tramos: [{ inicio: '07:00', fin: '17:00' }] })).concat([DESCANSO, DESCANSO]) },
  { nombre: 'Lunes a sábado 06:00–14:00', tipo: 'semanal', dias: [0, 1, 2, 3, 4, 5].map(() => ({ tramos: [{ inicio: '06:00', fin: '14:00' }] })).concat([DESCANSO]) },
];

function EditorTurnoTipo({ ciudad, inicial, guardas, onListo, onCancelar }: {
  ciudad: string; inicial: PatronFila | null; guardas: number; onListo: (t: string) => void; onCancelar: () => void;
}) {
  const [codigo, setCodigo] = useState(inicial?.codigo ?? '');
  const [tipo, setTipo] = useState<'rotativo' | 'semanal'>((inicial?.tipo as 'rotativo' | 'semanal') ?? 'rotativo');
  const [dias, setDias] = useState<DiaPatron[]>(inicial?.dias ?? [DIA, DIA, NOCHE, NOCHE, DESCANSO, DESCANSO]);
  const [festivo, setFestivo] = useState<DiaPatron | null>(inicial?.horario_festivo ?? null);
  const [grupos, setGrupos] = useState(inicial?.grupos ?? 1);
  const [desfase, setDesfase] = useState(inicial?.desfase_grupos ?? 0);
  const [descripcion, setDescripcion] = useState(inicial?.descripcion ?? '');
  const [activo, setActivo] = useState(inicial?.activo ?? true);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cambiarTipo = (t: 'rotativo' | 'semanal') => {
    setTipo(t);
    if (t === 'semanal') { setDias((d) => Array.from({ length: 7 }, (_, i) => d[i] ?? DESCANSO)); setGrupos(1); setDesfase(0); }
  };
  const largo = (n: number) => setDias((d) => Array.from({ length: Math.min(62, Math.max(1, n)) }, (_, i) => d[i] ?? DESCANSO));
  const poner = (i: number, d: DiaPatron) => setDias((x) => x.map((y, k) => (k === i ? d : y)));
  const plantilla = (p: (typeof PLANTILLAS)[number]) => { setTipo(p.tipo); setDias(p.dias); setGrupos(p.grupos ?? 1); setDesfase(p.desfase ?? 0); if (!codigo) setCodigo(p.nombre); };

  const problemas = [
    ...revisarDias(dias, tipo === 'semanal'),
    ...(tipo === 'rotativo' && grupos > 1 && (desfase < 1 || desfase >= dias.length) ? [`Con varios grupos, el desfase va de 1 a ${dias.length - 1} días`] : []),
  ];
  const etiquetas = tipo === 'semanal' ? SEMANA : dias.map((_, i) => `Día ${i + 1}`);
  const semana = horasCiclo(dias) / dias.length * 7;

  const guardar = async () => {
    if (!codigo.trim()) { setError('Ponga un nombre al turno tipo.'); return; }
    if (problemas.length) { setError(problemas[0]); return; }
    setEnviando(true);
    const { error } = await db().rpc('guardar_turno_tipo', {
      p_id: inicial?.id ?? null, p_ciudad: ciudad, p_codigo: codigo, p_tipo: tipo, p_dias: dias,
      p_festivo: tipo === 'semanal' ? festivo : null, p_grupos: tipo === 'rotativo' ? grupos : 1, p_desfase: tipo === 'rotativo' && grupos > 1 ? desfase : 0,
      p_descripcion: descripcion, p_activo: activo,
    });
    setEnviando(false);
    if (error) { setError(error.message); return; }
    onListo(inicial ? `Turno tipo «${codigo}» actualizado. Aplica a lo que se programe de aquí en adelante.` : `Turno tipo «${codigo}» creado.`);
  };

  return (
    <>
      <h3 style={{ margin: 0 }}>{inicial ? 'Editar turno tipo' : 'Nuevo turno tipo'}</h3>
      {inicial && guardas > 0 && (
        <div className="aviso-caja alerta">Lo usan {guardas} guardas. Los turnos ya programados no cambian; el cambio aplica a lo que se programe después (nuevas asignaciones y el próximo periodo).</div>
      )}
      {!inicial && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>Empezar desde:</span>
          {PLANTILLAS.map((p) => <button key={p.nombre} className="secundario chico" onClick={() => plantilla(p)}>{p.nombre}</button>)}
        </div>
      )}
      <label style={{ display: 'grid', gap: 6 }}>Nombre
        <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ej.: 24H 06-18 2D-2N-2DE 3 grupos" />
      </label>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ display: 'grid', gap: 6, flex: '1 1 180px' }}>Cómo se repite
          <select value={tipo} onChange={(e) => cambiarTipo(e.target.value as 'rotativo' | 'semanal')}>
            <option value="rotativo">Rotativo (ciclo de N días)</option>
            <option value="semanal">Semanal (lunes a domingo)</option>
          </select>
        </label>
        {tipo === 'rotativo' && (
          <label style={{ display: 'grid', gap: 6, width: 130 }}>Días del ciclo
            <input type="number" min={1} max={62} value={dias.length} onChange={(e) => largo(Number(e.target.value))} />
          </label>
        )}
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        {dias.map((d, i) => <EditorDia key={i} etiqueta={etiquetas[i]} dia={d} onCambio={(x) => poner(i, x)} />)}
        {tipo === 'semanal' && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
            <input type="checkbox" checked={festivo !== null} onChange={(e) => setFestivo(e.target.checked ? DESCANSO : null)} /> Los festivos tienen otro horario
          </label>
        )}
        {tipo === 'semanal' && festivo && <EditorDia etiqueta="Festivo" dia={festivo} onCambio={setFestivo} />}
      </div>

      {tipo === 'rotativo' && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 6, width: 130 }}>Grupos
            <input type="number" min={1} max={9} value={grupos} onChange={(e) => { const g = Math.min(9, Math.max(1, Number(e.target.value))); setGrupos(g); if (g > 1 && desfase === 0) setDesfase(Math.max(1, Math.floor(dias.length / g))); }} />
          </label>
          {grupos > 1 && (
            <label style={{ display: 'grid', gap: 6, width: 200 }}>Cada grupo va adelante
              <select value={desfase} onChange={(e) => setDesfase(Number(e.target.value))}>
                {Array.from({ length: dias.length - 1 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} día{n === 1 ? '' : 's'}</option>)}
              </select>
            </label>
          )}
        </div>
      )}

      <div className="card" style={{ padding: 12, display: 'grid', gap: 6 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          Vista previa · {fmt(horasCiclo(dias))} h por {tipo === 'semanal' ? 'semana' : `ciclo de ${dias.length} días`} · {fmt(semana)} h por semana en promedio
        </div>
        {(tipo === 'rotativo' ? Array.from({ length: grupos }, (_, g) => g) : [0]).map((g) => (
          <div key={g} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {grupos > 1 && <span className="badge" style={{ minWidth: 70 }}>Grupo {g + 1}</span>}
            <TiraCiclo dias={Array.from({ length: Math.max(dias.length, 14) }, (_, i) => dias[(i + g * desfase) % dias.length])}
              etiquetas={tipo === 'semanal' ? Array.from({ length: 14 }, (_, i) => SEMANA[i % 7]) : undefined} max={14} />
          </div>
        ))}
        {tipo === 'rotativo' && grupos > 1 && <CoberturaGrupos dias={dias} grupos={grupos} desfase={desfase} />}
      </div>

      <label style={{ display: 'grid', gap: 6 }}>Notas (opcional)
        <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Para qué puesto o cliente se usa" />
      </label>
      {inicial && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Activo (se puede asignar)
        </label>
      )}
      {(error || problemas.length > 0) && <div className="aviso-caja error">{error || problemas.join(' · ')}</div>}
      <button onClick={guardar} disabled={enviando}>{enviando ? 'Guardando…' : inicial ? 'Guardar cambios' : 'Crear turno tipo'}</button>
      <button className="secundario" onClick={onCancelar}>Cancelar</button>
    </>
  );
}

/** Con varios grupos: ¿cada día queda cubierto de día y de noche por exactamente un grupo? */
function CoberturaGrupos({ dias, grupos, desfase }: { dias: DiaPatron[]; grupos: number; desfase: number }) {
  const n = dias.length;
  let huecos = 0; let dobles = 0;
  for (let i = 0; i < n; i++) {
    const hoy = Array.from({ length: grupos }, (_, g) => claseDia(dias[(i + g * desfase) % n]).clase);
    for (const c of ['dia', 'noche']) {
      const k = hoy.filter((x) => x === c).length;
      if (k === 0) huecos++; else if (k > 1) dobles++;
    }
  }
  if (!dias.some((d) => claseDia(d).clase === 'noche') || !dias.some((d) => claseDia(d).clase === 'dia')) return null;
  return huecos === 0 && dobles === 0
    ? <span className="badge verde" style={{ width: 'max-content' }}>Entre los {grupos} grupos cubren día y noche todos los días</span>
    : <span className="badge ambar" style={{ width: 'max-content' }}>{huecos ? `${huecos} franjas sin nadie` : ''}{huecos && dobles ? ' · ' : ''}{dobles ? `${dobles} franjas con dos grupos` : ''} en el ciclo</span>;
}

function EditorDia({ etiqueta, dia, onCambio }: { etiqueta: string; dia: DiaPatron; onCambio: (d: DiaPatron) => void }) {
  const c = claseDia(dia);
  const tramo = (k: number, campo: 'inicio' | 'fin', v: string) => onCambio({ tramos: dia.tramos.map((t, j) => (j === k ? { ...t, [campo]: v } : t)) });
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--line)', paddingBottom: 6 }}>
      <span style={{ width: 62, fontSize: 13, fontWeight: 700, color: '#40516b' }}>{etiqueta}</span>
      <span className={`celda ${c.clase}`}>{c.letra}</span>
      <button className={`chico ${dia.tramos.length === 0 ? '' : 'secundario'}`} onClick={() => onCambio(DESCANSO)}>Descanso</button>
      <button className={`chico ${c.clase === 'dia' && dia.tramos[0]?.inicio === '06:00' && dia.tramos[0]?.fin === '18:00' ? '' : 'secundario'}`} onClick={() => onCambio(DIA)}>Día 6–18</button>
      <button className={`chico ${c.clase === 'noche' && dia.tramos[0]?.inicio === '18:00' && dia.tramos[0]?.fin === '06:00' ? '' : 'secundario'}`} onClick={() => onCambio(NOCHE)}>Noche 18–6</button>
      {dia.tramos.map((t, k) => (
        <span key={k} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <CampoHora valor={t.inicio} onCambio={(v) => tramo(k, 'inicio', v)} etiqueta={`${etiqueta}: entrada`} />
          <span style={{ color: 'var(--muted)' }}>a</span>
          <CampoHora valor={t.fin} onCambio={(v) => tramo(k, 'fin', v)} etiqueta={`${etiqueta}: salida`} />
          {dia.tramos.length > 1 && <button className="secundario chico" title="Quitar tramo" aria-label="Quitar tramo" onClick={() => onCambio({ tramos: dia.tramos.filter((_, j) => j !== k) })}><Trash2 size={13} /></button>}
        </span>
      ))}
      <button className="secundario chico" title="Agregar un tramo (turno partido)" onClick={() => onCambio({ tramos: [...dia.tramos, { inicio: dia.tramos.length ? '14:00' : '07:00', fin: dia.tramos.length ? '18:00' : '12:00' }] })}>+ tramo</button>
    </div>
  );
}

/** Hora en 24 h (06:00, 18:30): se escribe con o sin los dos puntos. */
function CampoHora({ valor, onCambio, etiqueta }: { valor: string; onCambio: (v: string) => void; etiqueta: string }) {
  const [texto, setTexto] = useState(valor);
  useEffect(() => setTexto(valor), [valor]);
  const normalizar = (v: string) => {
    const d = v.replace(/\D/g, '');
    if (d.length === 3 || d.length === 4) return `${d.slice(0, -2).padStart(2, '0')}:${d.slice(-2)}`;
    if (d.length === 1 || d.length === 2) return `${d.padStart(2, '0')}:00`;
    return v;
  };
  return (
    <input value={texto} inputMode="numeric" maxLength={5} placeholder="06:00" aria-label={etiqueta}
      onChange={(e) => setTexto(e.target.value)} onBlur={() => { const v = normalizar(texto); setTexto(v); onCambio(v); }}
      style={{ width: 70, padding: '5px 8px', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }} />
  );
}
