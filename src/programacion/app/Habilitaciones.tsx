// Habilitaciones del guarda (curso, credencial, arma, moto, canino…) con vencimiento, y el resumen
// de vencimientos para el tablero. Las edita quien puede programar a ese guarda.
import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { db } from './supabase.ts';

export const TIPO_HABILITACION: [string, string][] = [
  ['curso_vigilancia', 'Curso de vigilancia (reentrenamiento)'], ['credencial', 'Credencial de vigilante'], ['arma', 'Arma (curso y porte)'],
  ['moto', 'Moto (licencia A2)'], ['canino', 'Guía canino'], ['licencia_conduccion', 'Licencia de conducción (carro)'], ['otro', 'Otra'],
];
export const NOMBRE_HABILITACION: Record<string, string> = Object.fromEntries(TIPO_HABILITACION);
const CORTO: Record<string, string> = { curso_vigilancia: 'Curso', credencial: 'Credencial', arma: 'Arma', moto: 'Moto', canino: 'Canino', licencia_conduccion: 'Licencia', otro: 'Otra' };

interface Habilitacion { id: number; tipo: string; detalle: string | null; numero: string | null; expedida: string | null; vence: string | null }

const hoy = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
const diasHasta = (f: string) => Math.round((Date.parse(`${f}T00:00:00Z`) - Date.parse(`${hoy()}T00:00:00Z`)) / 864e5);

export function EstadoVence({ vence }: { vence: string | null }) {
  if (!vence) return <span className="badge gris">No vence</span>;
  const d = diasHasta(vence);
  if (d < 0) return <span className="badge rojo">Vencida hace {-d} día{d === -1 ? '' : 's'}</span>;
  if (d <= 30) return <span className="badge ambar">Vence en {d} día{d === 1 ? '' : 's'}</span>;
  return <span className="badge verde">Vigente hasta {vence}</span>;
}

/** Contenido de la ventana de habilitaciones de un guarda. */
export function HabilitacionesGuarda({ empleado, puedeEditar, onCerrar }: { empleado: { id: number; nombre: string }; puedeEditar: boolean; onCerrar: () => void }) {
  const [lista, setLista] = useState<Habilitacion[] | null>(null);
  const [nueva, setNueva] = useState<Partial<Habilitacion> | null>(null);
  const [error, setError] = useState('');
  const cargar = useCallback(() => {
    db().from('habilitaciones').select('id, tipo, detalle, numero, expedida, vence').eq('empleado_id', empleado.id).order('tipo').order('vence', { ascending: false })
      .then(({ data, error }) => { if (error) setError(error.message); setLista((data as Habilitacion[]) ?? []); });
  }, [empleado.id]);
  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async () => {
    if (!nueva?.tipo) { setError('Escoja el tipo.'); return; }
    if (nueva.vence && nueva.expedida && nueva.vence < nueva.expedida) { setError('El vencimiento es anterior a la expedición.'); return; }
    const f = { empleado_id: empleado.id, tipo: nueva.tipo, detalle: nueva.detalle?.trim() || null, numero: nueva.numero?.trim() || null,
      expedida: nueva.expedida || null, vence: nueva.vence || null, actualizado_en: new Date().toISOString() };
    const { error } = nueva.id ? await db().from('habilitaciones').update(f).eq('id', nueva.id) : await db().from('habilitaciones').insert(f);
    if (error) { setError(error.message); return; }
    setNueva(null); setError(''); cargar();
  };
  const borrar = async (h: Habilitacion) => {
    if (!confirm(`¿Borrar la habilitación «${NOMBRE_HABILITACION[h.tipo]}»?`)) return;
    const { error } = await db().from('habilitaciones').delete().eq('id', h.id);
    if (error) setError(error.message); else cargar();
  };

  return (
    <>
      <h3 style={{ margin: 0 }}>Habilitaciones</h3>
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>{empleado.nombre}</p>
      {lista === null ? <p>Cargando…</p> : lista.length === 0 && !nueva ? (
        <div className="vacio">Sin habilitaciones registradas. Los puestos que exigen arma, moto o canino avisarán al programarlo.</div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {lista.map((h) => (
            <div key={h.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--line)', paddingBottom: 6 }}>
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <b>{NOMBRE_HABILITACION[h.tipo] ?? h.tipo}</b>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{[h.detalle, h.numero && `N.º ${h.numero}`, h.expedida && `expedida ${h.expedida}`].filter(Boolean).join(' · ') || '—'}</div>
              </div>
              <EstadoVence vence={h.vence} />
              {puedeEditar && <button className="secundario chico" onClick={() => setNueva(h)}>Editar</button>}
              {puedeEditar && <button className="secundario chico" aria-label="Borrar" title="Borrar" onClick={() => borrar(h)}><Trash2 size={13} /></button>}
            </div>
          ))}
        </div>
      )}
      {nueva ? (
        <div className="card" style={{ display: 'grid', gap: 8, padding: 14 }}>
          <label style={{ display: 'grid', gap: 6 }}>Tipo
            <select value={nueva.tipo ?? ''} onChange={(e) => setNueva({ ...nueva, tipo: e.target.value })}>
              <option value="">— Escoja —</option>
              {TIPO_HABILITACION.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 6 }}>Detalle (opcional)
            <input value={nueva.detalle ?? ''} onChange={(e) => setNueva({ ...nueva, detalle: e.target.value })} placeholder="Ej.: énfasis en armas, academia, placa de la moto" />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 6 }}>Número<input value={nueva.numero ?? ''} onChange={(e) => setNueva({ ...nueva, numero: e.target.value })} /></label>
            <label style={{ display: 'grid', gap: 6 }}>Expedida<input type="date" value={nueva.expedida ?? ''} onChange={(e) => setNueva({ ...nueva, expedida: e.target.value })} /></label>
            <label style={{ display: 'grid', gap: 6 }}>Vence<input type="date" value={nueva.vence ?? ''} onChange={(e) => setNueva({ ...nueva, vence: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={guardar}>{nueva.id ? 'Guardar cambios' : 'Agregar'}</button>
            <button className="secundario" onClick={() => { setNueva(null); setError(''); }}>Cancelar</button>
          </div>
        </div>
      ) : puedeEditar && (
        <button className="secundario" onClick={() => setNueva({})}><Plus size={15} style={{ verticalAlign: '-3px', marginRight: 6 }} />Agregar habilitación</button>
      )}
      {error && <div className="aviso-caja error">{error}</div>}
      <button className="secundario" onClick={onCerrar}>Cerrar</button>
    </>
  );
}

interface PorVencer { empleado_id: number; nombre: string; tipo: string; detalle: string | null; vence: string; dias_restantes: number; exigida_en_su_puesto: boolean }
interface SinHabilitacion { empleado_id: number; nombre: string; puesto_id: number; puesto: string; faltan: string[] }

/** Bloque del tablero: vencidas, por vencer en 30 días y guardas en puestos que exigen algo que no tienen. */
export function ResumenHabilitaciones({ ciudad, verCalendario }: { ciudad: string; verCalendario: (puesto: number) => void }) {
  const [venc, setVenc] = useState<PorVencer[] | null>(null);
  const [sin, setSin] = useState<SinHabilitacion[] | null>(null);
  useEffect(() => {
    db().rpc('habilitaciones_por_vencer', { p_ciudad: ciudad, p_dias: 30 }).then(({ data }) => setVenc((data as PorVencer[]) ?? []));
    db().rpc('guardas_sin_habilitacion', { p_ciudad: ciudad }).then(({ data }) => setSin((data as SinHabilitacion[]) ?? []));
  }, [ciudad]);
  const vencidas = (venc ?? []).filter((v) => v.dias_restantes < 0);
  const proximas = (venc ?? []).filter((v) => v.dias_restantes >= 0);
  return (
    <>
      <div className="kpis">
        <div className={`kpi${(sin?.length ?? 0) > 0 ? ' alerta' : ''}`}><small>En puestos sin la habilitación exigida</small><strong>{sin?.length ?? '…'}</strong></div>
        <div className={`kpi${vencidas.length > 0 ? ' alerta' : ''}`}><small>Habilitaciones vencidas</small><strong>{venc ? vencidas.length : '…'}</strong></div>
        <div className={`kpi${proximas.length > 0 ? ' aviso' : ''}`}><small>Vencen en 30 días</small><strong>{venc ? proximas.length : '…'}</strong></div>
      </div>
      {((sin?.length ?? 0) > 0 || (venc?.length ?? 0) > 0) && (
        <div className="card" style={{ padding: 0, overflowX: 'auto', marginTop: 10 }}>
          <table>
            <thead><tr><th>Guarda</th><th>Qué pasa</th><th /></tr></thead>
            <tbody>
              {(sin ?? []).slice(0, 10).map((s) => (
                <tr key={`s${s.empleado_id}-${s.puesto_id}`}>
                  <td><strong>{s.nombre}</strong><div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.puesto}</div></td>
                  <td>{s.faltan.map((f) => <span key={f} className="badge rojo" style={{ marginRight: 4 }}>Sin {CORTO[f]?.toLowerCase() ?? f} vigente</span>)}</td>
                  <td style={{ textAlign: 'right' }}><button className="secundario chico" onClick={() => verCalendario(s.puesto_id)}>Ver puesto</button></td>
                </tr>
              ))}
              {(venc ?? []).slice(0, 10).map((v) => (
                <tr key={`v${v.empleado_id}-${v.tipo}`}>
                  <td><strong>{v.nombre}</strong><div style={{ fontSize: 12, color: 'var(--muted)' }}>{NOMBRE_HABILITACION[v.tipo] ?? v.tipo}{v.exigida_en_su_puesto ? ' · su puesto la exige' : ''}</div></td>
                  <td><EstadoVence vence={v.vence} /></td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
