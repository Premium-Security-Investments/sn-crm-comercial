// Cargar datos desde Avancys: por archivo (Excel o CSV exportado) o por conexión directa.
// Las dos puertas terminan en la misma vista previa: altas, cambios, retiros y "no viene"; nada se
// guarda hasta que el administrador aplica.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, supabase } from './supabase.ts';
import { Upload, PlugZap } from 'lucide-react';
import { CAMPOS, detectarColumnas, filasDesdeMatriz, mapearFilas, type Entidad, type Fila } from '../integracion/normalizar.ts';

interface Cargue { id: number; entidad: Entidad; origen: string; archivo: string | null; estado: string; resumen: Record<string, number>; creado_en: string }
interface FilaCargue { id: number; accion: string; clave: string | null; datos: Record<string, unknown> | null; antes: Record<string, unknown> | null; cambios: string[] | null; mensaje: string | null; aplicar: boolean }

// c: variante de .badge en siio.css ('' = azul).
const ACCION: Record<string, { t: string; c: string }> = {
  alta: { t: 'Nuevos', c: 'verde' }, cambio: { t: 'Con cambios', c: '' }, retiro: { t: 'Retiros', c: 'morado' },
  no_viene: { t: 'Activos que no vienen', c: 'ambar' }, error: { t: 'Con error', c: 'rojo' }, sin_cambio: { t: 'Sin cambios', c: 'gris' },
};
const ESTADO_CARGUE: Record<string, string> = { previsualizado: 'ambar', aplicado: 'verde', descartado: 'gris' };
const subtitulo: React.CSSProperties = { fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted)' };

export function CargarDatos({ ciudad }: { ciudad: string }) {
  // 'patrones' solo entra por la conexión directa: es el catálogo de modalidades de Avancys.
  const [entidad, setEntidad] = useState<Entidad | 'patrones' | 'puestos'>('empleados');
  const porArchivo = entidad === 'empleados' || entidad === 'clientes';
  // Dentro del bloque del archivo la entidad siempre es una de las dos que tienen columnas.
  const campos = porArchivo ? CAMPOS[entidad as Entidad] : [];
  const [archivo, setArchivo] = useState<{ nombre: string; filas: Fila[]; encabezados: string[] } | null>(null);
  const [mapeo, setMapeo] = useState<Record<string, string | null>>({});
  const [cargue, setCargue] = useState<Cargue | null>(null);
  const [historial, setHistorial] = useState<Cargue[]>([]);
  const [estado, setEstado] = useState('');
  const [error, setError] = useState('');
  const [avancys, setAvancys] = useState<{ activa: boolean; ultima_sincronizacion: string | null } | null>(null);

  const cargarHistorial = useCallback(() => {
    db().from('cargues').select('id, entidad, origen, archivo, estado, resumen, creado_en').order('id', { ascending: false }).limit(10)
      .then(({ data }) => setHistorial((data as Cargue[]) ?? []));
    db().from('integraciones').select('activa, ultima_sincronizacion').eq('id', 'avancys').maybeSingle()
      .then(({ data }) => setAvancys(data as typeof avancys));
  }, []);
  useEffect(() => { cargarHistorial(); }, [cargarHistorial]);

  const leerArchivo = async (f: File) => {
    setError(''); setCargue(null); setEstado('Leyendo el archivo…');
    try {
      const XLSX = await import('xlsx');
      const libro = XLSX.read(await f.arrayBuffer(), { cellDates: true });
      const hoja = libro.Sheets[libro.SheetNames[0]];
      const matriz = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, raw: true, defval: null });
      const { encabezados, filas } = filasDesdeMatriz(matriz, entidad as Entidad);
      setArchivo({ nombre: f.name, filas, encabezados });
      setMapeo(detectarColumnas(encabezados, entidad as Entidad));
      setEstado('');
    } catch (e) { setEstado(''); setError((e as Error).message); }
  };

  const mapeadas = useMemo(() => (archivo && porArchivo ? mapearFilas(archivo.filas, mapeo, entidad as Entidad) : []), [archivo, mapeo, entidad, porArchivo]);
  const faltanRequeridos = campos.filter((c) => c.requerido && !mapeo[c.campo]).map((c) => c.etiqueta);

  const abrirCargue = async (id: number) => {
    const { data } = await db().from('cargues').select('id, entidad, origen, archivo, estado, resumen, creado_en').eq('id', id).single();
    setCargue(data as Cargue);
  };

  const comparar = async () => {
    if (!archivo) return;
    setError(''); setEstado(`Comparando ${mapeadas.length.toLocaleString('es-CO')} filas con la base…`);
    const { data, error } = entidad === 'empleados'
      ? await db().rpc('preparar_cargue_empleados', { p_ciudad: ciudad, p_origen: 'archivo', p_archivo: archivo.nombre, p_filas: mapeadas, p_marcar_ausentes: true })
      : await db().rpc('preparar_cargue_clientes', { p_origen: 'archivo', p_archivo: archivo.nombre, p_filas: mapeadas });
    setEstado('');
    if (error) { setError(error.message); return; }
    setArchivo(null);
    await abrirCargue((data as { cargue_id: number }).cargue_id);
    cargarHistorial();
  };

  const conAvancys = async (accion: 'probar' | 'traer') => {
    setError(''); setCargue(null); setEstado(accion === 'probar' ? 'Probando la conexión con Avancys…' : 'Trayendo datos de Avancys…');
    const { data, error } = await supabase.functions.invoke('avancys-sync', { body: { entidad, ciudad, accion } });
    setEstado('');
    if (error) { setError(`No se pudo usar la conexión con Avancys: ${error.message}`); return; }
    const r = data as { configurado: boolean; faltan?: string[]; conectado?: boolean; registros?: number; cargue_id?: number; descartadosPorCiudad?: number; sinLugar?: number; en_otra_ciudad?: number; con_ciudad?: number; sin_ciudad?: number; enganchados?: number; error?: string };
    if (r.error) { setError(r.error); return; }
    if (!r.configurado) { setError(`La conexión con Avancys todavía no está configurada (faltan: ${r.faltan?.join(', ')}). Mientras tanto use "Subir archivo".`); return; }
    if (accion === 'probar') { setEstado(`Conexión correcta: Avancys tiene ${r.registros?.toLocaleString('es-CO')} registros de ${entidad}.`); return; }
    if (r.descartadosPorCiudad) {
      // En Avancys la ciudad del empleado vive en su contrato: quien no tiene contrato vigente no
      // trae ciudad, así que no entra al cargue y aparece abajo como "está activo aquí pero no viene".
      const sin = r.sinLugar ? ` ${r.sinLugar} de ellos no tienen contrato vigente en Avancys.` : '';
      setEstado(`${r.descartadosPorCiudad} registros de otras ciudades no se tomaron.${sin}`);
    }
    // Una persona vive en una sola ciudad. Si ya estaba en otra, el cargue actualiza sus datos pero
    // no la mueve: sus turnos quedaron en la ciudad donde los trabajó.
    if (r.en_otra_ciudad) {
      setEstado((e) => `${e ? e + ' ' : ''}${r.en_otra_ciudad} ya están registrados en otra ciudad; se actualizan pero no se mueven.`);
    }
    if (r.sin_ciudad || r.enganchados) {
      const partes = [];
      if (r.enganchados) partes.push(`${r.enganchados} enganchan con puestos que venían del Excel`);
      if (r.sin_ciudad) partes.push(`${r.sin_ciudad} no se pudieron ubicar en una ciudad`);
      setEstado(partes.join('. ') + '.');
    }
    if (r.cargue_id) { await abrirCargue(r.cargue_id); cargarHistorial(); }
  };

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <p className="texto-suave" style={{ margin: 0, fontSize: 14 }}>
        Traiga los datos de Avancys por archivo o por conexión directa. Antes de guardar verá qué cambia y decide qué aplicar.
      </p>
      <div className="barra-filtros" style={{ margin: 0 }}>
        <label className="campo" style={{ flex: '0 1 300px' }}>Qué va a cargar
          <select value={entidad} onChange={(e) => { setEntidad(e.target.value as Entidad); setArchivo(null); setCargue(null); }}>
            <option value="empleados">Empleados (ciudad: {ciudad})</option>
            <option value="clientes">Clientes</option>
            <option value="patrones">Patrones de turno (de toda la empresa)</option>
            <option value="puestos">Puestos (con su ciudad y su cliente)</option>
          </select>
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: 12 }}>
        {porArchivo && (
          <div className="card" style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
            <b><Upload size={16} style={{ verticalAlign: '-3px', marginRight: 6, color: 'var(--blue)' }} />1. Subir archivo</b>
            <p className="texto-suave" style={{ margin: 0 }}>Excel (.xlsx, .xls) o CSV exportado de Avancys. Se toma la primera hoja.</p>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && leerArchivo(e.target.files[0])} />
          </div>
        )}
        <div className="card" style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
          <b><PlugZap size={16} style={{ verticalAlign: '-3px', marginRight: 6, color: 'var(--blue)' }} />{porArchivo ? '2. ' : ''}Conexión directa con Avancys</b>
          <p className="texto-suave" style={{ margin: 0 }}>
            {avancys?.ultima_sincronizacion ? `Última sincronización: ${new Date(avancys.ultima_sincronizacion).toLocaleString('es-CO')}.` : 'Aún no se ha sincronizado.'}
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="secundario" onClick={() => conAvancys('probar')}>Probar conexión</button>
            <button onClick={() => conAvancys('traer')}>Traer de Avancys</button>
          </div>
        </div>
      </div>
      {estado && <div className="aviso-caja" style={{ margin: 0 }}>{estado}</div>}
      {error && <div className="aviso-caja error" style={{ margin: 0 }}>{error}</div>}

      {archivo && (
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <div><b style={{ overflowWrap: 'anywhere' }}>{archivo.nombre}</b> · <span className="num">{archivo.filas.length.toLocaleString('es-CO')}</span> filas. Confirme qué columna corresponde a cada dato:</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 8 }}>
            {campos.map((c) => (
              <label key={c.campo} className="campo">{c.etiqueta}{c.requerido ? ' *' : ''}
                <select value={mapeo[c.campo] ?? ''} onChange={(e) => setMapeo((m) => ({ ...m, [c.campo]: e.target.value || null }))}>
                  <option value="">— no viene —</option>
                  {archivo.encabezados.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div>
            <div style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 12 }}>
              <table style={{ fontSize: 12 }}>
                <thead><tr>{campos.map((c) => <th key={c.campo}>{c.etiqueta}</th>)}</tr></thead>
                <tbody>{mapeadas.slice(0, 5).map((f, i) => <tr key={i}>{campos.map((c) => <td key={c.campo}>{String(f[c.campo] ?? '')}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <div className="texto-suave" style={{ fontSize: 12, marginTop: 4 }}>Primeras 5 filas, como se van a leer.</div>
          </div>
          {faltanRequeridos.length > 0
            ? <div className="aviso-caja error" style={{ margin: 0 }}>Falta escoger: {faltanRequeridos.join(', ')}.</div>
            : <div><button onClick={comparar}>Comparar con la base</button></div>}
        </div>
      )}

      {cargue && <RevisionCargue cargue={cargue} onCambio={() => { abrirCargue(cargue.id); cargarHistorial(); }} />}

      <h3 className="titulo-seccion" style={{ marginBottom: 0 }}>Cargues recientes</h3>
      {historial.length === 0 ? <div className="vacio">Todavía no hay cargues.</div> : (
        <div className="lista">
          {historial.map((h) => (
            <button key={h.id} className="fila" onClick={() => abrirCargue(h.id)}>
              <span style={{ minWidth: 0 }}>
                <b>{h.entidad === 'empleados' ? 'Empleados' : h.entidad === 'clientes' ? 'Clientes' : h.entidad}</b>{' '}
                <span className={`badge ${ESTADO_CARGUE[h.estado] ?? 'gris'}`} style={{ marginLeft: 4 }}>{h.estado}</span>
                <span className="sub" style={{ display: 'block', overflowWrap: 'anywhere' }}>{new Date(h.creado_en).toLocaleString('es-CO')} · {h.origen === 'avancys' ? 'conexión Avancys' : h.archivo}</span>
              </span>
              <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {Object.entries(h.resumen).map(([k, n]) => <span key={k} className={`badge ${ACCION[k]?.c ?? 'gris'}`}>{ACCION[k]?.t ?? k}: {n}</span>)}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function RevisionCargue({ cargue, onCambio }: { cargue: Cargue; onCambio: () => void }) {
  const [filas, setFilas] = useState<FilaCargue[]>([]);
  const [ver, setVer] = useState<string>('');
  const [mensaje, setMensaje] = useState('');
  const pendiente = cargue.estado === 'previsualizado';

  const cargar = useCallback(async () => {
    const out: FilaCargue[] = [];
    for (let i = 0; ; i += 1000) {
      const { data } = await db().from('cargue_filas').select('id, accion, clave, datos, antes, cambios, mensaje, aplicar').eq('cargue_id', cargue.id).neq('accion', 'sin_cambio').order('id').range(i, i + 999);
      const f = (data as FilaCargue[]) ?? [];
      out.push(...f);
      if (f.length < 1000) break;
    }
    setFilas(out);
    setVer((v) => v || (Object.keys(cargue.resumen).find((k) => k !== 'sin_cambio') ?? ''));
  }, [cargue]);
  useEffect(() => { cargar(); }, [cargar]);

  const marcar = async (ids: number[], aplicar: boolean) => {
    for (let i = 0; i < ids.length; i += 200) await db().from('cargue_filas').update({ aplicar }).in('id', ids.slice(i, i + 200));
    cargar();
  };
  const aplicar = async () => {
    const r = cargue.resumen;
    if (!confirm(`¿Aplicar este cargue? Nuevos: ${r.alta ?? 0}, con cambios: ${r.cambio ?? 0}, retiros: ${r.retiro ?? 0}. Los "activos que no vienen" solo se retiran si los marcó.`)) return;
    const { data, error } = await db().rpc('aplicar_cargue', { p_cargue: cargue.id });
    if (error) { setMensaje(error.message); return; }
    const d = data as { altas: number; cambios: number; retirados_por_no_venir: number };
    setMensaje(`Aplicado: ${d.altas} nuevos, ${d.cambios} actualizados, ${d.retirados_por_no_venir} retirados por no venir.`);
    onCambio();
  };
  const descartar = async () => { await db().rpc('descartar_cargue', { p_cargue: cargue.id }); onCambio(); };

  const lista = filas.filter((f) => f.accion === ver);
  const nombre = (f: FilaCargue) => String(f.datos?.nombre ?? f.datos?.razon_social ?? f.antes?.nombre ?? f.antes?.razon_social ?? '');
  return (
    <div className="card" style={{ display: 'grid', gap: 10, border: '2px solid var(--blue)' }}>
      <div>
        <div style={subtitulo}>Vista previa del cargue</div>
        <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <b style={{ overflowWrap: 'anywhere' }}>{cargue.origen === 'avancys' ? 'conexión con Avancys' : cargue.archivo}</b>
          <span className={`badge ${ESTADO_CARGUE[cargue.estado] ?? 'gris'}`}>{cargue.estado}</span>
        </div>
      </div>
      <nav className="pestanas" style={{ margin: 0 }}>
        {Object.entries(cargue.resumen).map(([k, n]) => (
          <button key={k} className={ver === k ? 'activa' : ''} onClick={() => setVer(k)} disabled={k === 'sin_cambio'}>
            {ACCION[k]?.t ?? k} <span className={`badge ${ACCION[k]?.c ?? 'gris'} num`} style={{ marginLeft: 4 }}>{n.toLocaleString('es-CO')}</span>
          </button>
        ))}
      </nav>
      {ver === 'no_viene' && pendiente && (
        <div className="aviso-caja alerta" style={{ margin: 0, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ flex: '1 1 260px' }}>Estas personas están activas aquí pero no vienen en el cargue. No se retiran solas: marque las que sí se retiraron.</span>
          <button className="secundario chico" onClick={() => marcar(lista.map((f) => f.id), true)}>Marcar todas</button>
          <button className="secundario chico" onClick={() => marcar(lista.map((f) => f.id), false)}>Desmarcar todas</button>
        </div>
      )}
      <div style={{ maxHeight: 360, overflow: 'auto', display: 'grid', border: '1px solid var(--line)', borderRadius: 12 }}>
        {lista.length === 0 && <div className="texto-suave" style={{ padding: 12 }}>Nada en este grupo.</div>}
        {lista.slice(0, 500).map((f) => (
          <label key={f.id} style={{ display: 'flex', gap: 8, alignItems: 'start', fontSize: 13, fontWeight: 400, color: 'var(--text)', borderBottom: '1px solid var(--line)', padding: '8px 12px' }}>
            {pendiente && f.accion !== 'error' && <input type="checkbox" checked={f.aplicar} onChange={(e) => marcar([f.id], e.target.checked)} style={{ marginTop: 2 }} />}
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
              <b>{nombre(f) || '(sin nombre)'}</b> <span className="texto-suave num">{f.clave}</span>
              {f.cambios?.length ? <span> · cambia {f.cambios.map((c) => `${c}: ${String(f.antes?.[c] ?? '—')} → ${String(f.datos?.[c] ?? '—')}`).join('; ')}</span> : null}
              {f.mensaje && <span style={{ color: 'var(--amber)' }}> · {f.mensaje}</span>}
            </span>
          </label>
        ))}
        {lista.length > 500 && <div className="texto-suave" style={{ fontSize: 12, padding: '8px 12px' }}>Mostrando 500 de {lista.length}.</div>}
      </div>
      {mensaje && <div className="aviso-caja ok" style={{ margin: 0 }}>{mensaje}</div>}
      {pendiente && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={aplicar}>Aplicar lo marcado</button>
          <button className="secundario" onClick={descartar}>Descartar</button>
        </div>
      )}
    </div>
  );
}
