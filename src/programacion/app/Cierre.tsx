// Cierre del periodo: calcular a todos los guardas con el motor verificado, revisar, descargar el
// listado para nómina y el informe de novedades, y cerrar (bloquea cambios).
import { useEffect, useMemo, useState } from 'react';
import { db, type Acceso } from './supabase.ts';
import { AlertTriangle, CheckCircle2, Download, Lock } from 'lucide-react';
import { CostoExtras } from './CostoExtras.tsx';
import { ResumenCierre } from './ResumenCierre.tsx';
import { calcularCierre, parametrosDesdeBase, type ResultadoGuarda } from '../motor/cierre.ts';

interface Periodo { id: number; ciudad_id: string; inicio: string; fin: string; estado: string; parametros_id: number | null; resultados_calculados_en: string | null }
interface Empleado { id: number; documento: string; nombre: string; cargo: string }
interface NovedadFila { empleado_id: number; tipo: string; desde: string; hasta: string; comentario: string | null }
type Totales = NonNullable<ResultadoGuarda['totales']>;

const VERSION_MOTOR = 'legado-pereira-2'; // 2: guarda sin turnos en el periodo = 0 días y 0 horas
const COLUMNAS: [keyof Totales, string][] = [
  ['hed', 'HED'], ['hen', 'HEN'], ['recargoNocturno', 'Rec. noct.'], ['dofSinCompensatorio', 'DoF sin C'],
  ['dofConCompensatorio', 'DoF con C'], ['hedDoF', 'HED DoF'], ['henDoF', 'HEN DoF'], ['diasLaborados', 'Días lab.'],
  ['incapacidades', 'Incap.'], ['permisosNoRemunerados', 'Perm. no rem.'], ['permisosRemunerados', 'Perm. rem.'],
  ['ausentismos', 'Ausent.'], ['vacaciones', 'Vac.'], ['sanciones', 'Sanc.'],
];
const TIPO_NOVEDAD: Record<string, string> = {
  incapacidad: 'Incapacidad', permiso_remunerado: 'Permiso remunerado', permiso_no_remunerado: 'Permiso no remunerado',
  ausencia: 'Ausencia', sancion: 'Sanción', vacaciones: 'Vacaciones', retiro: 'Retiro', no_vinculado: 'No vinculado', fuera_de_corte: 'Fuera de corte',
};

async function todo<T>(consulta: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await consulta(i, i + 999);
    if (error) throw new Error(error.message);
    const filas = (data as T[]) ?? [];
    out.push(...filas);
    if (filas.length < 1000) return out;
  }
}

const hoyCol = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10); // hora de Colombia
const num = (x: number) => (Math.round(x * 100) / 100).toLocaleString('es-CO');
function descargar(nombre: string, filas: (string | number)[][]) {
  const csv = '﻿' + filas.map((f) => f.map((v) => {
    const s = typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function Cierre({ acceso, ciudad }: { acceso: Acceso; ciudad: string }) {
  const puedeCerrar = acceso.rol === 'admin' || acceso.rol === 'nomina';
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [periodoId, setPeriodoId] = useState<number | null>(null);
  const [resultados, setResultados] = useState<ResultadoGuarda[] | null>(null);
  const [empleados, setEmpleados] = useState<Map<number, Empleado>>(new Map());
  const [puestoDe, setPuestoDe] = useState<Map<number, string>>(new Map());
  const [novedades, setNovedades] = useState<NovedadFila[]>([]);
  const [estado, setEstado] = useState('');
  const [error, setError] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [pestana, setPestana] = useState<'listado' | 'costo'>('listado');
  const [revision, setRevision] = useState<{ control: string; cantidad: number; ejemplos: Record<string, unknown>[] }[] | null>(null);

  const cargarPeriodos = () =>
    db().from('periodos').select('id, ciudad_id, inicio, fin, estado, parametros_id, resultados_calculados_en').eq('ciudad_id', ciudad).order('inicio', { ascending: false })
      .then(({ data }) => {
        const ps = (data as Periodo[]) ?? [];
        setPeriodos(ps);
        setPeriodoId((actual) => actual ?? ps.find((p) => p.estado === 'abierto')?.id ?? ps[0]?.id ?? null);
      });
  useEffect(() => { cargarPeriodos(); }, [ciudad]);
  const periodo = periodos.find((p) => p.id === periodoId) ?? null;
  // Un periodo que no ha terminado se calcula con lo programado: es una proyección, no lo trabajado.
  const proyeccion = !!periodo && periodo.estado !== 'cerrado' && hoyCol() <= periodo.fin
    ? (hoyCol() < periodo.inicio ? 'no_empieza' : 'en_curso') : null;
  useEffect(() => {
    setResultados(null); setEstado(''); setError(''); setRevision(null);
    if (periodoId) db().rpc('revision_cierre', { p_periodo: periodoId }).then(({ data }) => setRevision((data as typeof revision) ?? []));
    if (periodo?.resultados_calculados_en) verGuardado(periodo);
  }, [periodoId]);

  // Al entrar se muestra el último cálculo guardado (no hay que pulsar nada); Calcular lo rehace.
  const verGuardado = async (per: Periodo) => {
    try {
      const [res, asig, novs, emps, puestos] = await Promise.all([
        todo<{ empleado_id: number; totales: Totales }>((a, b) =>
          db().from('resultados_nomina').select('empleado_id, totales').eq('periodo_id', per.id).order('empleado_id').range(a, b)),
        todo<{ empleado_id: number; puesto_id: number | null }>((a, b) =>
          db().from('asignaciones').select('empleado_id, puesto_id').lte('desde', per.fin).gte('hasta', per.inicio).order('id').range(a, b)),
        todo<NovedadFila>((a, b) =>
          db().from('novedades').select('empleado_id, tipo, desde, hasta, comentario').lte('desde', per.fin).gte('hasta', per.inicio).neq('estado', 'anulada').order('id').range(a, b)),
        todo<Empleado>((a, b) => db().from('empleados').select('id, documento, nombre, cargo').eq('ciudad_id', per.ciudad_id).order('id').range(a, b)),
        todo<{ id: number; nombre: string }>((a, b) => db().from('puestos').select('id, nombre').order('id').range(a, b)),
      ]);
      const nombresPuesto = new Map(puestos.map((x) => [x.id, x.nombre]));
      setEmpleados(new Map(emps.map((e) => [e.id, e])));
      setPuestoDe(new Map(asig.map((a) => [a.empleado_id, nombresPuesto.get(a.puesto_id ?? -1) ?? ''])));
      setNovedades(novs);
      setResultados(res.map((r) => ({ empleado_id: r.empleado_id, totales: r.totales,
        sinTurnos: !Number(r.totales.diasLaborados) && !Number(r.totales.horasOrdinarias) ? true : undefined })));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const calcular = async () => {
    if (!periodo) return;
    setError(''); setResultados(null);
    try {
      setEstado('Leyendo guardas, turnos y novedades…');
      const finMas1 = new Date(Date.parse(periodo.fin + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
      const [asig, turnos, novs, emps, puestos, fest, ciudades, params] = await Promise.all([
        todo<{ empleado_id: number; puesto_id: number | null; regla_dominical_antigua: boolean }>((a, b) =>
          db().from('asignaciones').select('empleado_id, puesto_id, regla_dominical_antigua').lte('desde', periodo.fin).gte('hasta', periodo.inicio).order('id').range(a, b)),
        todo<{ empleado_id: number; inicio: string; fin: string }>((a, b) =>
          db().from('turnos').select('empleado_id, inicio, fin').gte('inicio', periodo.inicio).lt('inicio', finMas1).order('id').range(a, b)),
        todo<NovedadFila>((a, b) =>
          db().from('novedades').select('empleado_id, tipo, desde, hasta, comentario').lte('desde', periodo.fin).gte('hasta', periodo.inicio).neq('estado', 'anulada').order('id').range(a, b)),
        todo<Empleado>((a, b) => db().from('empleados').select('id, documento, nombre, cargo').eq('ciudad_id', ciudad).order('id').range(a, b)),
        todo<{ id: number; nombre: string }>((a, b) => db().from('puestos').select('id, nombre').order('id').range(a, b)),
        todo<{ fecha: string }>((a, b) => db().from('festivos').select('fecha').order('fecha').range(a, b)),
        db().from('ciudades').select('id, dia_corte').eq('id', ciudad),
        periodo.parametros_id
          ? db().from('parametros_nomina').select('*').eq('id', periodo.parametros_id)
          : db().from('parametros_nomina').select('*').eq('ciudad_id', ciudad).lte('vigente_desde', periodo.inicio).order('vigente_desde', { ascending: false }).limit(1),
      ]);
      const p = (params.data as { jornada_semanal: number; jornada_diaria_macro: number | null; inicio_diurno: string; fin_diurno: string }[] | null)?.[0];
      if (!p) throw new Error('No hay parámetros de nómina para este periodo.');
      const diaCorte = (ciudades.data as { dia_corte: number | null }[] | null)?.[0]?.dia_corte ?? Number(periodo.fin.slice(8, 10));
      const nombresPuesto = new Map(puestos.map((x) => [x.id, x.nombre]));
      setEmpleados(new Map(emps.map((e) => [e.id, e])));
      setPuestoDe(new Map(asig.map((a) => [a.empleado_id, nombresPuesto.get(a.puesto_id ?? -1) ?? ''])));
      setNovedades(novs);

      setEstado(`Calculando ${new Set(asig.map((a) => a.empleado_id)).size} guardas…`);
      const res = calcularCierre({
        inicio: periodo.inicio, fin: periodo.fin, festivos: fest.map((f) => f.fecha),
        parametros: parametrosDesdeBase(p, diaCorte),
        empleados: [...new Set(asig.map((a) => a.empleado_id))],
        turnos, novedades: novs,
        reglaAntigua: new Set(asig.filter((a) => a.regla_dominical_antigua).map((a) => a.empleado_id)),
      });

      // Periodo histórico cargado ya cerrado y nunca calculado: el administrador guarda el cálculo una vez.
      const historicoSinCalculo = periodo.estado === 'cerrado' && !periodo.resultados_calculados_en && acceso.rol === 'admin';
      if ((periodo.estado !== 'cerrado' && puedeCerrar) || historicoSinCalculo) {
        const validos = res.filter((r) => r.totales);
        for (let i = 0; i < validos.length; i += 200) {
          setEstado(`Guardando resultados ${Math.min(i + 200, validos.length)} de ${validos.length}…`);
          const { error } = await db().rpc('guardar_resultados', {
            p_periodo: periodo.id, p_metodo: 'legado_pereira', p_version: VERSION_MOTOR,
            p_resultados: validos.slice(i, i + 200).map((r) => ({ empleado_id: r.empleado_id, totales: r.totales, traza: r.traza })),
            p_es_primer_lote: i === 0,
          });
          if (error) throw new Error(error.message);
        }
        await cargarPeriodos();
        setEstado(periodo.estado === 'cerrado' ? 'Cálculo del periodo histórico guardado (el periodo sigue cerrado). Ya puede ver el costo en pesos.' : 'Cálculo guardado. Revise y, si todo está bien, cierre el periodo.');
      } else {
        setEstado(periodo.estado === 'cerrado' ? 'Periodo cerrado: cálculo solo de consulta.' : 'Cálculo de consulta (su rol no guarda resultados).');
      }
      setResultados(res);
    } catch (e) {
      setEstado('');
      setError((e as Error).message);
    }
  };

  const cerrar = async () => {
    const pendientes = (revision ?? []).filter((r) => r.cantidad > 0).map((r) => `• ${r.control}: ${r.cantidad}`).join('\n');
    if (!periodo || !confirm(`¿Cerrar el periodo ${periodo.inicio} a ${periodo.fin}? Después nadie podrá cambiar turnos ni novedades de esas fechas.${pendientes ? '\n\nLa revisión encontró:\n' + pendientes : ''}`)) return;
    const { data, error } = await db().rpc('cerrar_periodo', { p_periodo: periodo.id });
    if (error) { setError(error.message); return; }
    setEstado(`Periodo cerrado con ${(data as { guardas: number }).guardas} guardas.`);
    cargarPeriodos();
  };
  const reabrir = async () => {
    if (!periodo) return;
    const motivo = prompt('Motivo para reabrir el periodo:');
    if (!motivo) return;
    const { error } = await db().rpc('reabrir_periodo', { p_periodo: periodo.id, p_motivo: motivo });
    if (error) { setError(error.message); return; }
    setEstado('Periodo reabierto.');
    cargarPeriodos();
  };

  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (resultados ?? []).map((r) => ({ r, e: empleados.get(r.empleado_id), puesto: puestoDe.get(r.empleado_id) ?? '' }))
      .filter(({ e, puesto }) => !q || [e?.nombre, e?.documento, puesto].some((x) => x?.toLowerCase().includes(q)))
      .sort((a, b) => (a.e?.nombre ?? '').localeCompare(b.e?.nombre ?? ''));
  }, [resultados, empleados, puestoDe, busqueda]);

  const conError = (resultados ?? []).filter((r) => r.error);

  const descargarListado = () => {
    if (!periodo) return;
    descargar(`listado-nomina-${periodo.ciudad_id}-${periodo.inicio}-a-${periodo.fin}.csv`, [
      ['Documento', 'Nombre', 'Puesto', ...COLUMNAS.map(([, t]) => t)],
      ...filas.filter(({ r }) => r.totales).map(({ r, e, puesto }) => [e?.documento ?? '', e?.nombre ?? '', puesto, ...COLUMNAS.map(([k]) => Number(r.totales![k]))]),
    ]);
  };
  const descargarNovedades = () => {
    if (!periodo) return;
    const dias = (n: NovedadFila) => {
      const a = Math.max(Date.parse(n.desde), Date.parse(periodo.inicio)), b = Math.min(Date.parse(n.hasta), Date.parse(periodo.fin));
      return Math.round((b - a) / 86400000) + 1;
    };
    descargar(`novedades-${periodo.ciudad_id}-${periodo.inicio}-a-${periodo.fin}.csv`, [
      ['Tipo', 'Documento', 'Nombre', 'Desde', 'Hasta', 'Días en el periodo', 'Comentario'],
      ...[...novedades].sort((a, b) => a.tipo.localeCompare(b.tipo) || a.desde.localeCompare(b.desde))
        .filter((n) => !['no_vinculado', 'fuera_de_corte'].includes(n.tipo))
        .map((n) => { const e = empleados.get(n.empleado_id); return [TIPO_NOVEDAD[n.tipo] ?? n.tipo, e?.documento ?? '', e?.nombre ?? '', n.desde, n.hasta, dias(n), n.comentario ?? '']; }),
    ]);
  };

  return (
    <section>
      <div className="barra-filtros">
        <label className="campo" style={{ flex: '1 1 240px', maxWidth: 360 }}>Periodo
          <select value={periodoId ?? ''} onChange={(e) => setPeriodoId(Number(e.target.value))}>
            {periodos.map((p) => <option key={p.id} value={p.id}>{p.inicio} a {p.fin} ({p.estado})</option>)}
          </select>
        </label>
        <button onClick={calcular} disabled={!periodo}>
          {periodo?.estado === 'cerrado' ? 'Ver cálculo' : 'Calcular'}
        </button>
        {resultados && <button className="secundario" onClick={descargarListado}><Download size={15} style={{ verticalAlign: '-3px', marginRight: 6 }} />Descargar listado para nómina</button>}
        {resultados && <button className="secundario" onClick={descargarNovedades}><Download size={15} style={{ verticalAlign: '-3px', marginRight: 6 }} />Descargar informe de novedades</button>}
        {periodo && periodo.estado !== 'cerrado' && puedeCerrar && periodo.resultados_calculados_en && (
          <button className="peligro" onClick={cerrar}><Lock size={15} style={{ verticalAlign: '-3px', marginRight: 6 }} />Cerrar periodo</button>
        )}
        {periodo?.estado === 'cerrado' && acceso.rol === 'admin' && <button className="secundario" onClick={reabrir}>Reabrir</button>}
      </div>
      <p className="texto-suave" style={{ margin: '0 0 12px' }}>
        Reglas actuales del Excel de Pereira (por validar con nómina).
        {periodo?.resultados_calculados_en && ` Último cálculo guardado: ${new Date(periodo.resultados_calculados_en).toLocaleString('es-CO')}`}
      </p>
      {proyeccion && (
        <div className="aviso-caja alerta" style={{ margin: '0 0 12px' }}>
          <b>Proyección, no lo trabajado.</b>{' '}
          {proyeccion === 'no_empieza'
            ? `Este periodo empieza el ${periodo!.inicio}: el cálculo usa el borrador automático (la rotación de cada guarda copiada del periodo anterior), como si todo se cumpliera tal cual.`
            : `Este periodo va hasta el ${periodo!.fin}: el cálculo usa lo ya trabajado y, para los días que faltan, el borrador automático (la rotación de cada guarda).`}
          {' '}Lo real sale al final del periodo, con los cambios de Alertas del día y las novedades aplicadas. Si la programación cambió, pulse Calcular para actualizar.
        </div>
      )}
      {revision && periodo?.estado !== 'cerrado' && (
        <div className="card" style={{ margin: '0 0 12px' }}>
          <h3 className="titulo-seccion" style={{ margin: '0 0 8px' }}>Revisión antes del cierre</h3>
          <div style={{ display: 'grid', gap: 6 }}>
            {revision.map((r) => (
              <details key={r.control} style={{ fontSize: 14, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
                <summary style={{ cursor: r.cantidad ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {r.cantidad
                    ? <AlertTriangle size={16} color="var(--amber)" style={{ flex: '0 0 auto' }} aria-hidden />
                    : <CheckCircle2 size={16} color="var(--green)" style={{ flex: '0 0 auto' }} aria-hidden />}
                  <span style={{ flex: 1, minWidth: 0 }}>{r.control}</span>
                  <span className={`badge num ${r.cantidad ? 'ambar' : 'verde'}`}>{r.cantidad.toLocaleString('es-CO')}</span>
                </summary>
                {r.cantidad > 0 && (
                  <div className="texto-suave" style={{ maxHeight: 200, overflow: 'auto', padding: '6px 0 2px 24px', display: 'grid', gap: 2 }}>
                    {r.ejemplos.map((e, i) => <div key={i} style={{ overflowWrap: 'anywhere' }}>{Object.values(e).map((v) => String(v).replace('T', ' ').slice(0, 16)).join(' · ')}</div>)}
                    {r.cantidad > r.ejemplos.length && <div>… y {r.cantidad - r.ejemplos.length} más</div>}
                  </div>
                )}
              </details>
            ))}
          </div>
        </div>
      )}
      {estado && <div className="aviso-caja">{estado}</div>}
      {error && <div className="aviso-caja error">{error}</div>}
      {conError.length > 0 && (
        <div className="aviso-caja alerta">
          {conError.length} guarda{conError.length === 1 ? '' : 's'} no se pudieron calcular: {conError.slice(0, 5).map((r) => `${empleados.get(r.empleado_id)?.nombre ?? r.empleado_id} (${r.error})`).join('; ')}
        </div>
      )}
      {periodo?.resultados_calculados_en && (
        <ResumenCierre periodo={periodo} calculadoEn={periodo.resultados_calculados_en} proyeccion={!!proyeccion} />
      )}
      {periodo?.resultados_calculados_en && (
        <div className="pestanas" role="tablist" aria-label="Vista del cierre" style={{ marginTop: 6 }}>
          <button role="tab" aria-selected={pestana === 'listado'} onClick={() => setPestana('listado')}>Listado para nómina</button>
          <button role="tab" aria-selected={pestana === 'costo'} onClick={() => setPestana('costo')}>Costo de horas extra en pesos</button>
        </div>
      )}
      {pestana === 'costo' && periodo?.resultados_calculados_en && (
        <CostoExtras periodo={periodo} calculadoEn={periodo.resultados_calculados_en} onDescargar={descargar} />
      )}
      {pestana === 'listado' && resultados && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="barra-filtros" style={{ margin: 0 }}>
            <label className="campo" style={{ maxWidth: 360 }}>Buscar guarda, documento o puesto
              <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            </label>
          </div>
          <p className="texto-suave" style={{ margin: 0, fontSize: 13 }}>
            <b>HED</b> extra diurna (6:00–19:00) · <b>HEN</b> extra nocturna (19:00–6:00) · <b>Rec. noct.</b> horas normales de noche con recargo ·
            {' '}<b>DoF</b> domingo o festivo, <b>con C</b> o <b>sin C</b>: con o sin día compensatorio · <b>HED DoF / HEN DoF</b> extras en domingo o festivo.
            {' '}Las cifras son horas, salvo las columnas de días.
          </p>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            {filas.length === 0 ? <div className="vacio" style={{ border: 0 }}>{busqueda.trim() ? 'Ningún guarda coincide con la búsqueda.' : 'No hay guardas calculados en este periodo.'}</div> : (
              <table style={{ fontSize: 13, minWidth: 900 }}>
                <thead>
                  <tr>
                    <th>Guarda</th>
                    <th>Puesto</th>
                    {COLUMNAS.map(([, t]) => <th key={t} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{t}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filas.slice(0, 300).map(({ r, e, puesto }) => (
                    <tr key={r.empleado_id}>
                      <td style={{ minWidth: 180 }}><strong>{e?.nombre}</strong><div className="texto-suave" style={{ fontSize: 12 }}>{e?.documento}{r.sinTurnos && <span className="badge gris" style={{ marginLeft: 6 }}>sin turnos</span>}</div></td>
                      <td style={{ maxWidth: 220 }}>{puesto}</td>
                      {COLUMNAS.map(([k]) => <td key={k} className="num" style={{ textAlign: 'right' }}>{r.totales ? num(Number(r.totales[k])) : '—'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {filas.length > 300 && <p className="texto-suave" style={{ margin: 0 }}>Mostrando 300 de {filas.length}. Use la búsqueda o descargue el listado completo.</p>}
        </div>
      )}
    </section>
  );
}
