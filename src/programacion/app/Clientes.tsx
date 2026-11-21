// Clientes de la ciudad: lo contratado (servicios por puesto) y quién lo cubre en el periodo abierto.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, type Acceso } from './supabase.ts';
import { Plus } from 'lucide-react';
import { Formulario, Modal, textoServicio, type Campo } from './ui.tsx';
import { clasificarPropuestas, inferirServicios, type ServicioPropuesto } from '../motor/inferir-servicios.ts';

interface ResumenCliente { cliente_id: number; nit: string; razon_social: string; activo: boolean; puestos: number; servicios_vigentes: number; horas_contratadas_semana: number; guardas_asignados: number }
interface Puesto { id: number; nombre: string; direccion: string | null; municipio: string | null; requiere_arma: boolean; activo: boolean }
export interface Servicio { id: number; confirmado: boolean; puesto_id: number; descripcion: string | null; dias: number[]; incluye_festivos: boolean; hora_inicio: string; hora_fin: string; guardas: number; armado: boolean; desde: string; hasta: string | null; notas: string | null }

const hoy = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
const num = (x: number) => Number(x).toLocaleString('es-CO');

export const CAMPOS_SERVICIO: Campo[] = [
  { clave: 'descripcion', etiqueta: 'Descripción (opcional)', tipo: 'texto' },
  { clave: 'dias', etiqueta: 'Días', tipo: 'dias' },
  { clave: 'incluye_festivos', etiqueta: 'Incluye festivos', tipo: 'si_no' },
  { clave: 'hora_inicio', etiqueta: 'Desde la hora', tipo: 'hora', requerido: true },
  { clave: 'hora_fin', etiqueta: 'Hasta la hora (igual a la de inicio = 24 h)', tipo: 'hora', requerido: true },
  { clave: 'guardas', etiqueta: 'Guardas al mismo tiempo', tipo: 'numero', requerido: true },
  { clave: 'armado', etiqueta: 'Armado', tipo: 'si_no' },
  { clave: 'desde', etiqueta: 'Vigente desde', tipo: 'fecha', requerido: true },
  { clave: 'hasta', etiqueta: 'Vigente hasta (vacío = sin fecha de fin)', tipo: 'fecha' },
  { clave: 'notas', etiqueta: 'Notas', tipo: 'texto' },
];

export async function guardarServicio(v: Record<string, unknown>, puestoId: number, id?: number): Promise<string | null> {
  const dias = (v.dias as number[]) ?? [];
  if (dias.length === 0) return 'Escoja al menos un día.';
  const fila = {
    puesto_id: puestoId, descripcion: v.descripcion || null, dias, incluye_festivos: Boolean(v.incluye_festivos),
    hora_inicio: v.hora_inicio, hora_fin: v.hora_fin, guardas: Number(v.guardas), armado: Boolean(v.armado),
    desde: v.desde, hasta: v.hasta || null, notas: v.notas || null, actualizado_en: new Date().toISOString(), confirmado: true,
  };
  const { error } = id ? await db().from('servicios_contratados').update(fila).eq('id', id) : await db().from('servicios_contratados').insert(fila);
  return error ? error.message : null;
}

export function Clientes({ acceso, ciudad }: { acceso: Acceso; ciudad: string }) {
  const [lista, setLista] = useState<ResumenCliente[] | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [soloActivos, setSoloActivos] = useState(true);
  const [abierto, setAbierto] = useState<ResumenCliente | null>(null);
  const [proponiendo, setProponiendo] = useState(false);

  const cargar = useCallback(() => {
    setLista(null);
    db().rpc('resumen_clientes', { p_ciudad: ciudad }).then(({ data }) => setLista((data as ResumenCliente[]) ?? []));
  }, [ciudad]);
  useEffect(() => { cargar(); setAbierto(null); }, [cargar]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (lista ?? []).filter((c) => (!soloActivos || c.activo) && (!q || c.razon_social.toLowerCase().includes(q) || c.nit.includes(q)));
  }, [lista, busqueda, soloActivos]);
  const tot = useMemo(() => visibles.reduce((t, c) => ({ puestos: t.puestos + c.puestos, horas: t.horas + Number(c.horas_contratadas_semana), guardas: t.guardas + c.guardas_asignados, sinServicio: t.sinServicio + (c.servicios_vigentes === 0 ? 1 : 0) }), { puestos: 0, horas: 0, guardas: 0, sinServicio: 0 }), [visibles]);

  if (proponiendo) return <ProponerServicios ciudad={ciudad} onTerminar={() => { setProponiendo(false); cargar(); }} />;
  if (abierto) return <ClienteDetalle acceso={acceso} ciudad={ciudad} cliente={abierto} onVolver={() => { setAbierto(null); cargar(); }} />;

  return (
    <section style={{ display: 'grid', gap: 14 }}>
      <div className="kpis">
        {[['Clientes', visibles.length], ['Puestos', tot.puestos], ['Horas contratadas por semana', tot.horas], ['Guardas asignados (periodo abierto)', tot.guardas]].map(([t, v]) => (
          <div key={String(t)} className="kpi"><small>{t}</small><strong>{lista ? num(Number(v)) : '…'}</strong></div>
        ))}
      </div>
      {lista && tot.sinServicio > 0 && (
        <div className="aviso-caja alerta" style={{ margin: 0 }}>
          {tot.sinServicio} cliente{tot.sinServicio === 1 ? '' : 's'} no tiene{tot.sinServicio === 1 ? '' : 'n'} registrado lo contratado. Ábralos y agregue los servicios de cada puesto
          {acceso.rol === 'admin' && <>, o <button className="secundario chico" onClick={() => setProponiendo(true)}>proponga lo contratado desde la programación actual</button></>}.
        </div>
      )}
      <div>
        <div className="barra-filtros">
          <label className="campo">Buscar cliente o NIT<input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', minHeight: 40 }}><input type="checkbox" checked={soloActivos} onChange={(e) => setSoloActivos(e.target.checked)} /> Solo activos</label>
        </div>
        {lista === null ? <p className="texto-suave">Cargando…</p> : visibles.length === 0 ? <div className="vacio">No hay clientes con esa búsqueda.</div> : (
          <div className="lista">
            {visibles.map((c) => (
              <button key={c.cliente_id} className="fila" onClick={() => setAbierto(c)} style={{ opacity: c.activo ? 1 : 0.65 }}>
                <span style={{ minWidth: 0 }}>
                  <b style={{ overflowWrap: 'anywhere' }}>{c.razon_social}</b>{!c.activo && <span className="badge gris" style={{ marginLeft: 6 }}>Retirado</span>}
                  <span className="sub" style={{ display: 'block' }}>NIT {c.nit}</span>
                </span>
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 13, color: 'var(--muted)' }} className="num">
                  {c.puestos} puesto{c.puestos === 1 ? '' : 's'} ·{' '}
                  {c.servicios_vigentes ? `${num(c.horas_contratadas_semana)} h/semana` : <span className="badge ambar">Sin contrato registrado</span>} · {c.guardas_asignados} guardas
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ClienteDetalle({ acceso, ciudad, cliente, onVolver }: { acceso: Acceso; ciudad: string; cliente: ResumenCliente; onVolver: () => void }) {
  const esAdmin = acceso.rol === 'admin';
  const [puestos, setPuestos] = useState<Puesto[]>([]);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [guardas, setGuardas] = useState<Map<number, { nombre: string; turno: string }[]>>(new Map());
  const [editando, setEditando] = useState<{ puesto: Puesto; servicio?: Servicio } | null>(null);

  const cargar = useCallback(async () => {
    const { data: ps } = await db().from('puestos').select('id, nombre, direccion, municipio, requiere_arma, activo').eq('cliente_id', cliente.cliente_id).eq('ciudad_id', ciudad).order('nombre');
    const lista = (ps as Puesto[]) ?? [];
    setPuestos(lista);
    const ids = lista.map((p) => p.id);
    if (ids.length === 0) return;
    const { data: ss } = await db().from('servicios_contratados').select('*').in('puesto_id', ids).order('desde');
    setServicios((ss as Servicio[]) ?? []);
    const { data: per } = await db().from('periodos').select('inicio, fin').eq('ciudad_id', ciudad).eq('estado', 'abierto').order('inicio').limit(1);
    const p = (per as { inicio: string; fin: string }[] | null)?.[0];
    if (!p) return;
    const { data: as } = await db().from('asignaciones').select('puesto_id, empleado_id, patron_id').in('puesto_id', ids).lte('desde', p.fin).gte('hasta', p.inicio);
    const asig = (as as { puesto_id: number; empleado_id: number; patron_id: number | null }[]) ?? [];
    const [{ data: es }, { data: pts }] = await Promise.all([
      db().from('empleados').select('id, nombre').in('id', [...new Set(asig.map((a) => a.empleado_id))]),
      db().from('patrones_turno').select('id, codigo').in('id', [...new Set(asig.map((a) => a.patron_id).filter((x): x is number => x !== null))]),
    ]);
    const nom = new Map(((es as { id: number; nombre: string }[]) ?? []).map((e) => [e.id, e.nombre]));
    const cod = new Map(((pts as { id: number; codigo: string }[]) ?? []).map((x) => [x.id, x.codigo]));
    const m = new Map<number, { nombre: string; turno: string }[]>();
    asig.forEach((a) => (m.get(a.puesto_id) ?? m.set(a.puesto_id, []).get(a.puesto_id)!).push({ nombre: nom.get(a.empleado_id) ?? '', turno: a.patron_id ? cod.get(a.patron_id) ?? '' : 'programación a mano' }));
    setGuardas(m);
  }, [cliente, ciudad]);
  useEffect(() => { cargar(); }, [cargar]);

  const terminar = async (s: Servicio) => {
    const fecha = prompt('¿Hasta qué fecha estuvo vigente este servicio? (AAAA-MM-DD)', hoy());
    if (!fecha) return;
    const { error } = await db().from('servicios_contratados').update({ hasta: fecha, actualizado_en: new Date().toISOString() }).eq('id', s.id);
    if (error) alert(error.message); else cargar();
  };

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div>
        <button className="secundario chico" onClick={onVolver}>← Clientes</button>
        <h2 style={{ fontSize: 20, margin: '12px 0 0', overflowWrap: 'anywhere' }}>{cliente.razon_social}</h2>
        <p className="texto-suave" style={{ margin: '4px 0 0' }}>NIT {cliente.nit} · {puestos.length} puesto{puestos.length === 1 ? '' : 's'} en esta ciudad</p>
      </div>
      {puestos.map((p) => {
        const vig = servicios.filter((s) => s.puesto_id === p.id && (!s.hasta || s.hasta >= hoy()));
        const viejos = servicios.filter((s) => s.puesto_id === p.id && s.hasta && s.hasta < hoy());
        const gs = guardas.get(p.id) ?? [];
        return (
          <div key={p.id} className="card" style={{ display: 'grid', gap: 12, opacity: p.activo ? 1 : 0.65 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'start' }}>
              <div style={{ minWidth: 0 }}>
                <b style={{ overflowWrap: 'anywhere' }}>{p.nombre}</b>
                {p.requiere_arma && <span className="badge rojo" style={{ marginLeft: 6 }}>Arma</span>}
                {!p.activo && <span className="badge gris" style={{ marginLeft: 6 }}>Inactivo</span>}
                <div className="texto-suave">{[p.direccion, p.municipio].filter(Boolean).join(' · ') || 'Sin dirección registrada'}</div>
              </div>
              {esAdmin && <button className="secundario chico" onClick={() => setEditando({ puesto: p })}><Plus size={14} style={{ verticalAlign: '-3px', marginRight: 6 }} />Servicio contratado</button>}
            </div>
            <div style={{ fontSize: 14 }}>
              <div className="texto-suave" style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Contratado</div>
              {vig.length === 0 ? <span className="badge ambar">Sin servicio registrado</span> : vig.map((s) => (
                <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderTop: '1px solid var(--line)' }}>
                  <span style={{ flex: '1 1 240px', minWidth: 0 }}>{s.descripcion ? <b>{s.descripcion}: </b> : null}{textoServicio(s)} <span className="texto-suave" style={{ fontSize: 12 }}>desde {s.desde}{s.hasta ? ` hasta ${s.hasta}` : ''}</span>
                    {!s.confirmado && <span className="badge ambar" style={{ marginLeft: 6, whiteSpace: 'normal' }}>Borrador: confirmar con el contrato</span>}</span>
                  {esAdmin && <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {!s.confirmado && <button className="chico" onClick={async () => { await db().from('servicios_contratados').update({ confirmado: true, actualizado_en: new Date().toISOString() }).eq('id', s.id); cargar(); }}>Confirmar</button>}
                    <button className="secundario chico" onClick={() => setEditando({ puesto: p, servicio: s })}>Editar</button>
                    <button className="secundario chico" onClick={() => terminar(s)}>Terminar</button>
                  </span>}
                </div>
              ))}
              {viejos.length > 0 && <div className="texto-suave" style={{ fontSize: 12, marginTop: 4 }}>{viejos.length} servicio{viejos.length === 1 ? '' : 's'} anterior{viejos.length === 1 ? '' : 'es'} terminado{viejos.length === 1 ? '' : 's'}</div>}
            </div>
            <div style={{ fontSize: 14 }}>
              <div className="texto-suave" style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Guardas asignados en el periodo abierto ({gs.length})</div>
              {gs.length === 0 ? <div className="texto-suave">Ninguno</div> : (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {gs.map((g, i) => <span key={i} className="badge gris" style={{ whiteSpace: 'normal' }}>{g.nombre} · {g.turno}</span>)}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {editando && (
        <Modal onCerrar={() => setEditando(null)}>
          <Formulario titulo={`${editando.servicio ? 'Editar' : 'Nuevo'} servicio · ${editando.puesto.nombre}`} campos={CAMPOS_SERVICIO}
            inicial={(editando.servicio as unknown as Record<string, unknown>) ?? { dias: [1, 2, 3, 4, 5, 6, 7], incluye_festivos: true, hora_inicio: '06:00', hora_fin: '06:00', guardas: 1, armado: editando.puesto.requiere_arma, desde: hoy() }}
            onGuardar={async (v) => { const e = await guardarServicio(v, editando.puesto.id, editando.servicio?.id); if (!e) { setEditando(null); cargar(); } return e; }}
            onCancelar={() => setEditando(null)} />
        </Modal>
      )}
    </section>
  );
}

// Propone lo contratado de los puestos sin servicio, a partir de lo programado en el periodo abierto.
function ProponerServicios({ ciudad, onTerminar }: { ciudad: string; onTerminar: () => void }) {
  const [estado, setEstado] = useState('Leyendo la programación del periodo abierto…');
  const [propuestas, setPropuestas] = useState<ServicioPropuesto[] | null>(null);
  const [agrupados, setAgrupados] = useState<{ puesto_id: number; maxGuardas: number; servicios: number }[]>([]);
  const [periodo, setPeriodo] = useState<{ id: number; inicio: string; fin: string } | null>(null);
  const [armado, setArmado] = useState<Map<number, boolean>>(new Map());
  const [nombres, setNombres] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const { data: per } = await db().from('periodos').select('id, inicio, fin').eq('ciudad_id', ciudad).eq('estado', 'abierto').order('inicio').limit(1);
      const p = (per as { id: number; inicio: string; fin: string }[] | null)?.[0];
      if (!p) { setEstado(''); setError('No hay un periodo abierto para tomar la programación.'); return; }
      setPeriodo(p);
      const pag = async <T,>(q: (a: number, b: number) => PromiseLike<{ data: unknown }>) => { const o: T[] = []; for (let i = 0; ; i += 1000) { const { data } = await q(i, i + 999); const f = (data as T[]) ?? []; o.push(...f); if (f.length < 1000) return o; } };
      const [turnos, puestos, servicios, fest] = await Promise.all([
        pag<{ puesto_id: number; inicio: string; fin: string }>((a, b) => db().from('turnos_programados').select('puesto_id, inicio, fin').eq('periodo_id', p.id).not('puesto_id', 'is', null).order('id').range(a, b)),
        pag<{ id: number; nombre: string; requiere_arma: boolean }>((a, b) => db().from('puestos').select('id, nombre, requiere_arma').eq('ciudad_id', ciudad).order('id').range(a, b)),
        pag<{ puesto_id: number }>((a, b) => db().from('servicios_contratados').select('puesto_id').order('id').range(a, b)),
        pag<{ fecha: string }>((a, b) => db().from('festivos').select('fecha').order('fecha').range(a, b)),
      ]);
      const conServicio = new Set(servicios.map((x) => x.puesto_id));
      const deCiudad = new Set(puestos.map((x) => x.id));
      setArmado(new Map(puestos.map((x) => [x.id, x.requiere_arma])));
      setNombres(new Map(puestos.map((x) => [x.id, x.nombre])));
      const clas = clasificarPropuestas(inferirServicios(turnos.filter((t) => deCiudad.has(t.puesto_id) && !conServicio.has(t.puesto_id)), p.inicio, p.fin, fest.map((f) => f.fecha)));
      setPropuestas(clas.confiables);
      setAgrupados(clas.agrupados.sort((a, b) => b.maxGuardas - a.maxGuardas));
      setEstado('');
    })().catch((e) => { setEstado(''); setError((e as Error).message); });
  }, [ciudad]);

  const guardar = async () => {
    if (!propuestas || !periodo) return;
    for (let i = 0; i < propuestas.length; i += 500) {
      setEstado(`Guardando ${Math.min(i + 500, propuestas.length)} de ${propuestas.length}…`);
      const { error } = await db().from('servicios_contratados').insert(propuestas.slice(i, i + 500).map((x) => ({
        puesto_id: x.puesto_id, dias: x.dias, incluye_festivos: true, hora_inicio: x.hora_inicio, hora_fin: x.hora_fin, guardas: x.guardas,
        armado: armado.get(x.puesto_id) ?? false, desde: periodo.inicio, confirmado: false,
        notas: `Propuesto desde la programación del periodo ${periodo.inicio} a ${periodo.fin}. Confirmar con el contrato.`,
      })));
      if (error) { setEstado(''); setError(error.message); return; }
    }
    onTerminar();
  };

  const puestosProp = new Set((propuestas ?? []).map((x) => x.puesto_id));
  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div>
        <button className="secundario chico" onClick={onTerminar}>← Clientes</button>
        <h2 style={{ fontSize: 20, margin: '12px 0 0' }}>Proponer lo contratado desde la programación</h2>
      </div>
      <p className="texto-suave" style={{ margin: 0, fontSize: 14 }}>
        Para cada puesto sin contrato registrado, la app mira cómo se programó en el periodo abierto{periodo ? ` (${periodo.inicio} a ${periodo.fin})` : ''} y
        propone el servicio típico por día de la semana. Quedan como <b>borrador</b>: confírmelos o corríjalos con cada contrato.
      </p>
      {estado && <div className="aviso-caja" style={{ margin: 0 }}>{estado}</div>}
      {error && <div className="aviso-caja error" style={{ margin: 0 }}>{error}</div>}
      {propuestas && (
        <>
          <div className="kpis">
            <div className="kpi"><small>Servicios propuestos</small><strong>{propuestas.length.toLocaleString('es-CO')}</strong></div>
            <div className="kpi"><small>Puestos</small><strong>{puestosProp.size.toLocaleString('es-CO')}</strong></div>
          </div>
          {propuestas.length === 0 ? <div className="vacio">No hay servicios para proponer.</div> : (
            <div className="card" style={{ display: 'grid', gap: 0, maxHeight: 420, overflow: 'auto', padding: '6px 14px' }}>
              {propuestas.slice(0, 400).map((x, i) => (
                <div key={i} style={{ fontSize: 13, borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
                  <b>{nombres.get(x.puesto_id)}</b>: {textoServicio({ ...x, incluye_festivos: true, armado: armado.get(x.puesto_id) ?? false })}
                </div>
              ))}
            </div>
          )}
          {propuestas.length > 0 && !estado && <div><button onClick={guardar}>Guardar como borrador</button></div>}
          {agrupados.length > 0 && (
            <div className="aviso-caja alerta" style={{ margin: '4px 0 0' }}>
              <b>{agrupados.length} puestos no reciben propuesta</b> porque parecen agrupar varias sedes (muchos guardas al mismo tiempo) o
              tienen horarios muy variables. Conviene dividirlos en sus sedes reales en "Datos maestros → Puestos" y registrar el contrato de cada una.
              <div style={{ maxHeight: 200, overflow: 'auto', marginTop: 6 }}>
                {agrupados.map((a) => <div key={a.puesto_id}>{nombres.get(a.puesto_id)} · hasta {a.maxGuardas} guardas al tiempo · {a.servicios} franjas distintas</div>)}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
