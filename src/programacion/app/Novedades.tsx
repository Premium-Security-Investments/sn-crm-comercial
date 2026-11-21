// Novedades: lo que ya pasó y debe quedar en la nómina (incapacidades, permisos, ausencias y lo que el
// supervisor resolvió solo cuando Programación no estaba). Llegan de SecurityOps; una persona de
// Programación revisa cada una y la aplica, la aplica con ajuste (cambia cómo cuenta para la nómina) o la
// devuelve a Ops. Mientras SecurityOps no las envíe solas, se registran a mano.
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Plus } from 'lucide-react';
import { db, type Acceso } from './supabase.ts';
import { Modal } from './ui.tsx';

interface Novedad {
  id: number; empleado_id: number | null; tipo: string; subtipo: string | null; desde: string | null; hasta: string | null;
  turno_id: number | null; empleado_destino_id: number | null; detalle: string | null; canal: string; origen: string;
  id_externo: string | null; documento: string | null; documento_destino: string | null; cubre_inicio: string | null; cubre_fin: string | null;
  reportado_por: string | null; resuelto_por_supervisor: boolean; tipo_por_confirmar: boolean; alerta_reportada_id: number | null; estado: string; motivo: string | null; ajuste: { de: string; a: string } | null;
  resultado: { turnos_cubiertos?: number; turnos_sin_cubrir?: number } | null; creado_en: string; resuelta_en: string | null;
}
interface Empleado { id: number; nombre: string; documento: string }

export const TIPO: Record<string, string> = { novedad: 'Novedad', llegada_tarde: 'Llegada tarde', ceder_turno: 'Cambio de turno', otro: 'Otro' };
export const SUBTIPO: Record<string, string> = { incapacidad: 'Incapacidad', permiso_remunerado: 'Permiso remunerado', permiso_no_remunerado: 'Permiso no remunerado', ausencia: 'Ausencia', vacaciones: 'Vacaciones', sancion: 'Sanción' };
const ORIGEN: Record<string, string> = { securityops: 'SecurityOps', manual: 'Registrada a mano' };
const CANAL: Record<string, string> = { app: 'En persona', llamada: 'Llamada', whatsapp: 'WhatsApp', vigia: 'Vig-IA', securityops: 'SecurityOps' };
const ESTADOS: [string, string][] = [['por_revisar', 'Por revisar'], ['aplicada', 'Aplicadas'], ['aplicada_con_ajuste', 'Con ajuste'], ['devuelta', 'Devueltas']];
const hoy = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
const hm = (ts: string) => ts.slice(11, 16);

export function Novedades({ acceso, ciudad }: { acceso: Acceso; ciudad: string }) {
  const puedeRevisar = acceso.rol === 'admin' || acceso.rol === 'coordinador';
  const [estado, setEstado] = useState('por_revisar');
  const [lista, setLista] = useState<Novedad[] | null>(null);
  const [empleados, setEmpleados] = useState<Map<number, Empleado>>(new Map());
  const [nueva, setNueva] = useState(false);
  const [mensaje, setMensaje] = useState('');

  const cargar = useCallback(async () => {
    setLista(null);
    const { data } = await db().from('solicitudes').select('*').eq('ciudad_id', ciudad).eq('estado', estado)
      .order('creado_en', { ascending: estado === 'por_revisar' }).limit(200);
    const ns = (data as Novedad[]) ?? [];
    const ids = [...new Set(ns.flatMap((n) => [n.empleado_id, n.empleado_destino_id]).filter((x): x is number => !!x))];
    if (ids.length) {
      const { data: es } = await db().from('empleados').select('id, nombre, documento').in('id', ids);
      setEmpleados((m) => new Map([...m, ...((es as Empleado[]) ?? []).map((e) => [e.id, e] as [number, Empleado])]));
    }
    setLista(ns);
  }, [ciudad, estado]);
  useEffect(() => { cargar(); }, [cargar]);

  return (
    <section>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <div className="pestanas" role="tablist" aria-label="Estado" style={{ margin: 0 }}>
          {ESTADOS.map(([k, t]) => <button key={k} role="tab" aria-selected={estado === k} className={estado === k ? 'activa' : ''} onClick={() => setEstado(k)}>{t}</button>)}
        </div>
        {puedeRevisar && <button style={{ marginLeft: 'auto' }} onClick={() => setNueva(true)}><Plus size={15} style={{ verticalAlign: '-3px', marginRight: 6 }} />Registrar novedad recibida</button>}
      </div>
      <p className="texto-suave" style={{ marginTop: 0 }}>
        Lo que ya pasó y debe quedar en la nómina, incluido lo que el supervisor resolvió cuando Programación no estaba. Revise cada una:
        {' '}<b>aplicar</b>, <b>aplicar con ajuste</b> (cambia cómo cuenta para la nómina) o <b>devolver a Operaciones</b>.
        Los turnos por cubrir del día se atienden en "Alertas del día". Mientras SecurityOps no las envíe solas, regístrelas con el botón.
      </p>
      {mensaje && <div className="aviso-caja ok">{mensaje}</div>}
      {lista === null ? <p className="texto-suave">Cargando…</p> : lista.length === 0 ? (
        <div className="vacio">{estado === 'por_revisar' ? <><CheckCircle2 size={16} color="var(--green)" aria-hidden style={{ verticalAlign: '-3px', marginRight: 6 }} />No hay novedades por revisar.</> : 'Nada por aquí.'}</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {lista.map((n) => (
            <TarjetaNovedad key={n.id} n={n} empleados={empleados} puedeRevisar={puedeRevisar && n.estado === 'por_revisar'}
              onRevisada={(m) => { setMensaje(m); cargar(); }} />
          ))}
        </div>
      )}
      {nueva && (
        <Modal onCerrar={() => setNueva(false)}>
          <NuevaNovedad ciudad={ciudad} onListo={(m) => { setNueva(false); setMensaje(m); setEstado('por_revisar'); cargar(); }} onCancelar={() => setNueva(false)} />
        </Modal>
      )}
    </section>
  );
}

function TarjetaNovedad({ n, empleados, puedeRevisar, onRevisada }: { n: Novedad; empleados: Map<number, Empleado>; puedeRevisar: boolean; onRevisada: (m: string) => void }) {
  const [turnos, setTurnos] = useState<{ turno_id: number; puesto: string; inicio: string; fin: string }[] | null>(null);
  const [accion, setAccion] = useState<'' | 'ajuste' | 'devolver'>('');
  const [subtipo, setSubtipo] = useState('');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { db().rpc('turnos_de_solicitud', { p_solicitud: n.id }).then(({ data }) => setTurnos((data as typeof turnos) ?? [])); }, [n.id]);
  const quien = n.empleado_id ? empleados.get(n.empleado_id) : null;
  const cubre = n.empleado_destino_id ? empleados.get(n.empleado_destino_id) : null;
  const fechas = n.desde ? (n.hasta && n.hasta !== n.desde ? `del ${n.desde} al ${n.hasta}` : `el ${n.desde}`) : '';
  const sinGuarda = !n.empleado_id;
  const sinCubre = !!n.documento_destino && !n.empleado_destino_id;

  const revisar = async (p_accion: 'aplicar' | 'aplicar_con_ajuste' | 'devolver') => {
    setError(''); setGuardando(true);
    const { data, error: e } = await db().rpc('revisar_novedad', {
      p_id: n.id, p_accion, p_subtipo: p_accion === 'aplicar_con_ajuste' || n.tipo_por_confirmar ? subtipo || null : null, p_motivo: motivo.trim() || null,
    });
    setGuardando(false);
    if (e) { setError(e.message); return; }
    const r = (data as { resultado?: { turnos_cubiertos?: number; turnos_sin_cubrir?: number } }).resultado;
    onRevisada(p_accion === 'devolver' ? 'Novedad devuelta a Operaciones.'
      : `Novedad aplicada${p_accion === 'aplicar_con_ajuste' ? ' con ajuste' : ''}.${r?.turnos_cubiertos ? ` ${r.turnos_cubiertos} turno(s) pasaron a quien cubrió.` : ''}${r?.turnos_sin_cubrir ? ` ${r.turnos_sin_cubrir} turno(s) quedaron sin cubrir: revíselos en "Alertas del día".` : ''}`);
  };

  return (
    <div className="card" style={{ padding: 14, fontSize: 14, display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <span className={`badge ${n.tipo === 'novedad' ? 'rojo' : n.tipo === 'ceder_turno' ? 'morado' : 'ambar'}`}>{TIPO[n.tipo] ?? n.tipo}{n.tipo_por_confirmar ? ' · por confirmar' : n.subtipo ? ` · ${SUBTIPO[n.subtipo] ?? n.subtipo}` : ''}</span>
          {n.alerta_reportada_id && <span className="badge gris" style={{ marginLeft: 6 }}>Desde Alertas del día</span>}
          {n.resuelto_por_supervisor && <span className="badge morado" style={{ marginLeft: 6 }}>Resuelto por el supervisor</span>}
          {n.ajuste && <span className="badge gris" style={{ marginLeft: 6 }}>Ajustada a {SUBTIPO[n.ajuste.a] ?? n.ajuste.a}</span>}
          <span style={{ marginLeft: 8, color: 'var(--text)' }}>{fechas}</span>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 6 }}>
            {quien?.nombre ?? <span style={{ color: '#b91c1c' }}>Cédula {n.documento} no está en Programación</span>}
            {quien && <span className="texto-suave" style={{ fontSize: 12, fontWeight: 400 }}> {quien.documento}</span>}
          </div>
          {(cubre || n.documento_destino) && (
            <div>Cubrió: {cubre?.nombre ?? <span style={{ color: '#b91c1c' }}>cédula {n.documento_destino} no está en Programación</span>}
              {n.cubre_inicio && n.cubre_fin ? ` · ${hm(n.cubre_inicio)}–${hm(n.cubre_fin)}` : ''}</div>
          )}
        </div>
        <div className="texto-suave" style={{ fontSize: 12, textAlign: 'right' }}>
          <span className="badge gris">{ORIGEN[n.origen] ?? n.origen}{n.id_externo ? ` · ${n.id_externo}` : ''}</span>
          <div style={{ marginTop: 4 }}>{n.origen === 'manual' ? `Llegó por ${CANAL[n.canal]?.toLowerCase() ?? n.canal}` : ''}</div>
          {n.reportado_por && <div>Reportó: {n.reportado_por}</div>}
          <div>{new Date(n.creado_en).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}</div>
        </div>
      </div>
      {n.detalle && <div style={{ marginTop: 4, color: 'var(--text)', fontStyle: 'italic' }}>"{n.detalle}"</div>}
      {turnos && turnos.length > 0 && (
        <div className="texto-suave" style={{ marginTop: 4 }}>
          Turnos programados: {turnos.map((t) => `${t.inicio.slice(5, 10)} ${hm(t.inicio)}–${hm(t.fin)} (${t.puesto ?? 'sin puesto'})`).join(' · ')}
        </div>
      )}
      {turnos && turnos.length === 0 && n.empleado_id && n.tipo !== 'otro' && <div className="aviso-caja alerta" style={{ margin: '4px 0' }}>El guarda no tiene turnos en esas fechas.</div>}
      {n.motivo && <div style={{ marginTop: 4, fontSize: 13 }}>{n.estado === 'devuelta' ? 'Devuelta: ' : 'Motivo: '}{n.motivo}</div>}
      {error && <div className="aviso-caja error" style={{ margin: '4px 0' }}>{error}</div>}
      {puedeRevisar && (
        <>
          {(sinGuarda || sinCubre) && <div className="aviso-caja alerta" style={{ margin: '4px 0' }}>Hay una cédula que no existe en Programación: devuélvala a Operaciones o cargue primero al guarda.</div>}
          {accion === 'ajuste' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
              <label className="campo" style={{ flex: '1 1 200px' }}>Debe contar como
                <select value={subtipo} onChange={(e) => setSubtipo(e.target.value)}>
                  <option value="">— Escoja —</option>
                  {Object.entries(SUBTIPO).filter(([k]) => k !== n.subtipo).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                </select>
              </label>
              <label className="campo" style={{ flex: '2 1 260px' }}>Motivo del ajuste<input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="p. ej. incapacidad sin soporte" /></label>
            </div>
          )}
          {accion === 'devolver' && (
            <label className="campo">Qué debe corregir Operaciones<input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="p. ej. falta el horario de quien cubrió" /></label>
          )}
          {n.tipo_por_confirmar && accion === '' && (
            <label className="campo" style={{ maxWidth: 320 }}>Qué fue (confirme antes de aplicar)
              <select value={subtipo} onChange={(e) => setSubtipo(e.target.value)}>
                <option value="">— Escoja —</option>
                {Object.entries(SUBTIPO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
            </label>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {accion === '' && <>
              <button disabled={guardando || sinGuarda || sinCubre || (n.tipo_por_confirmar && !subtipo)} onClick={() => revisar('aplicar')}>Aplicar</button>
              {n.tipo === 'novedad' && !n.tipo_por_confirmar && <button className="secundario" disabled={sinGuarda || sinCubre} onClick={() => { setAccion('ajuste'); setMotivo(''); }}>Aplicar con ajuste</button>}
              <button className="secundario" onClick={() => { setAccion('devolver'); setMotivo(''); }}>Devolver a Operaciones</button>
            </>}
            {accion === 'ajuste' && <><button disabled={guardando || !subtipo || !motivo.trim()} onClick={() => revisar('aplicar_con_ajuste')}>Aplicar con ajuste</button><button className="secundario" onClick={() => setAccion('')}>Cancelar</button></>}
            {accion === 'devolver' && <><button disabled={guardando || !motivo.trim()} onClick={() => revisar('devolver')}>Devolver</button><button className="secundario" onClick={() => setAccion('')}>Cancelar</button></>}
          </div>
        </>
      )}
    </div>
  );
}

function NuevaNovedad({ ciudad, onListo, onCancelar }: { ciudad: string; onListo: (m: string) => void; onCancelar: () => void }) {
  const [tipo, setTipo] = useState('novedad');
  const [subtipo, setSubtipo] = useState('incapacidad');
  const [documento, setDocumento] = useState('');
  const [desde, setDesde] = useState(hoy());
  const [hasta, setHasta] = useState(hoy());
  const [cubreDoc, setCubreDoc] = useState('');
  const [cubreIni, setCubreIni] = useState('');
  const [cubreFin, setCubreFin] = useState('');
  const [reportado, setReportado] = useState('');
  const [idExterno, setIdExterno] = useState('');
  const [canal, setCanal] = useState('llamada');
  const [detalle, setDetalle] = useState('');
  const [porSupervisor, setPorSupervisor] = useState(false);
  const [quien, setQuien] = useState<Empleado | null | undefined>(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    const d = documento.replace(/\D/g, '');
    if (d.length < 5) { setQuien(undefined); return; }
    const t = setTimeout(() => {
      db().from('empleados').select('id, nombre, documento').ilike('documento', `%${d}%`).limit(1)
        .then(({ data }) => setQuien(((data as Empleado[]) ?? [])[0] ?? null));
    }, 300);
    return () => clearTimeout(t);
  }, [documento]);

  const conHora = (fecha: string, h: string) => (h ? `${fecha}T${h}` : null);
  const guardar = async () => {
    setError('');
    if (!documento.trim()) { setError('Escriba la cédula del guarda.'); return; }
    if (tipo === 'ceder_turno' && !cubreDoc.trim()) { setError('Escriba la cédula de quien tomó el turno.'); return; }
    let fin = conHora(desde, cubreFin);
    if (cubreIni && cubreFin && cubreFin <= cubreIni) fin = conHora(new Date(new Date(`${desde}T12:00:00`).getTime() + 864e5).toISOString().slice(0, 10), cubreFin);
    const { error: e } = await db().rpc('registrar_novedad_reportada', {
      p_ciudad: ciudad, p_tipo: tipo, p_documento: documento, p_subtipo: tipo === 'novedad' ? subtipo : null,
      p_desde: desde, p_hasta: tipo === 'novedad' ? hasta : desde,
      p_documento_destino: cubreDoc.trim() || null, p_cubre_inicio: cubreDoc.trim() ? conHora(desde, cubreIni) : null, p_cubre_fin: cubreDoc.trim() ? fin : null,
      p_turno: null, p_detalle: detalle || null, p_canal: canal, p_origen: 'manual', p_id_externo: idExterno.trim() || null,
      p_reportado_por: reportado || null, p_resuelto_por_supervisor: porSupervisor,
    });
    if (e) { setError(e.message); return; }
    onListo('Novedad registrada. Quedó por revisar.');
  };

  return (
    <>
      <h3 style={{ margin: 0 }}>Registrar novedad recibida</h3>
      <p className="texto-suave" style={{ margin: 0 }}>Lo que ya pasó (o lo que el supervisor resolvió solo). Queda por revisar antes de aplicarse.</p>
      <label className="campo">Qué pasó
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {Object.entries(TIPO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select>
      </label>
      {tipo === 'novedad' && (
        <label className="campo">Tipo de novedad
          <select value={subtipo} onChange={(e) => setSubtipo(e.target.value)}>
            {Object.entries(SUBTIPO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </label>
      )}
      <label className="campo">Cédula del guarda
        <input value={documento} onChange={(e) => setDocumento(e.target.value)} inputMode="numeric" />
        {quien === null && <small style={{ color: '#b91c1c' }}>No está en Programación; se puede registrar igual y devolver o aplicar después.</small>}
        {quien && <small>{quien.nombre}</small>}
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label className="campo" style={{ flex: '1 1 140px' }}>{tipo === 'novedad' ? 'Desde' : 'Fecha'}<input type="date" value={desde} onChange={(e) => { setDesde(e.target.value); if (hasta < e.target.value) setHasta(e.target.value); }} /></label>
        {tipo === 'novedad' && <label className="campo" style={{ flex: '1 1 140px' }}>Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>}
      </div>
      {(tipo === 'novedad' || tipo === 'ceder_turno') && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label className="campo" style={{ flex: '2 1 180px' }}>{tipo === 'ceder_turno' ? 'Cédula de quien tomó el turno' : 'Cédula de quien cubrió (si alguien cubrió)'}<input value={cubreDoc} onChange={(e) => setCubreDoc(e.target.value)} inputMode="numeric" /></label>
          <label className="campo" style={{ flex: '1 1 100px' }}>Desde la hora<input type="time" value={cubreIni} onChange={(e) => setCubreIni(e.target.value)} /></label>
          <label className="campo" style={{ flex: '1 1 100px' }}>Hasta la hora<input type="time" value={cubreFin} onChange={(e) => setCubreFin(e.target.value)} /></label>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label className="campo" style={{ flex: '1 1 180px' }}>Quién lo reportó en Operaciones<input value={reportado} onChange={(e) => setReportado(e.target.value)} placeholder="Supervisor, radio operador…" /></label>
        <label className="campo" style={{ flex: '1 1 140px' }}>N.º de reporte en SecurityOps<input value={idExterno} onChange={(e) => setIdExterno(e.target.value)} placeholder="Opcional" /></label>
        <label className="campo" style={{ flex: '1 1 120px' }}>Cómo llegó
          <select value={canal} onChange={(e) => setCanal(e.target.value)}>
            <option value="llamada">Llamada</option><option value="whatsapp">WhatsApp</option><option value="securityops">SecurityOps</option><option value="app">En persona</option>
          </select>
        </label>
      </div>
      <label className="campo">Detalle (opcional)<input value={detalle} onChange={(e) => setDetalle(e.target.value)} /></label>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={porSupervisor} onChange={(e) => setPorSupervisor(e.target.checked)} /> Lo resolvió el supervisor (Programación no estaba)</label>
      {error && <div className="aviso-caja error" style={{ margin: 0 }}>{error}</div>}
      <button onClick={guardar}>Registrar</button>
      <button className="secundario" onClick={onCancelar}>Cancelar</button>
    </>
  );
}
