// Simulador "¿Cuánto cuesta este cambio?" (Juan, 2026-10-17): se escoge un guarda real y el periodo, se cargan
// sus turnos y se cambian días para ver, antes de decidir, cuántas horas extra y cuánta plata sube o baja.
// Usa el mismo cálculo de Cierre y nómina. No guarda nada. Sin guarda escogido, trae un guarda de ejemplo.
import { useEffect, useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { db } from './supabase.ts';
import { calcularCierre, parametrosDesdeBase } from '../motor/cierre.ts';
import { factorDe } from '../motor/factores.ts';
import { diasDelPeriodo } from '../motor/periodo.ts';

interface Periodo { id: number; inicio: string; fin: string; estado: string; parametros_id: number | null }
interface Parametros { jornada_semanal: number; jornada_diaria_macro: number | null; inicio_diurno: string; fin_diurno: string; smlv: number; divisor_valor_hora: number; factores: Record<string, number> }
interface Turno { inicio: string; fin: string }
interface Empleado { id: number; nombre: string; documento: string }
// Cada día: lo que tenía (original) o un cambio simulado.
type Marca = 'original' | 'descanso' | 'dia' | 'noche';

const CONCEPTOS: { k: string; nombre: string; factor: string | null; extra?: boolean }[] = [
  { k: 'hed', nombre: 'Extras diurnas (HED)', factor: 'hed', extra: true },
  { k: 'hen', nombre: 'Extras nocturnas (HEN)', factor: 'hen', extra: true },
  { k: 'hedDoF', nombre: 'Extras diurnas en domingo o festivo', factor: 'hed_dof', extra: true },
  { k: 'henDoF', nombre: 'Extras nocturnas en domingo o festivo', factor: 'hen_dof', extra: true },
  { k: 'recargoNocturno', nombre: 'Recargo nocturno', factor: 'rn' },
  { k: 'dofConCompensatorio', nombre: 'Domingo o festivo con compensatorio', factor: 'dof_con_compensatorio' },
  { k: 'dofSinCompensatorio', nombre: 'Domingo o festivo sin compensatorio', factor: 'dof_sin_compensatorio' },
  { k: 'horasOrdinarias', nombre: 'Horas normales', factor: null },
  { k: 'diasLaborados', nombre: 'Días trabajados', factor: null },
];
const pesos = (n: number) => n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const num = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 2 });
const hm = (ts: string) => ts.slice(11, 16);
const sig = (fecha: string) => new Date(Date.parse(`${fecha}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
const norm = (ts: string) => ts.slice(0, 16).replace(' ', 'T');

async function todo<T>(consulta: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await consulta(i, i + 999);
    if (error) throw new Error(error.message);
    const f = (data as T[]) ?? [];
    out.push(...f);
    if (f.length < 1000) return out;
  }
}

export function Simulador({ ciudad }: { ciudad: string }) {
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [periodoId, setPeriodoId] = useState<number | null>(null);
  const [festivos, setFestivos] = useState<string[]>([]);
  const [param, setParam] = useState<Parametros | null>(null);
  const [diaCorte, setDiaCorte] = useState(23);
  const [q, setQ] = useState('');
  const [opciones, setOpciones] = useState<Empleado[]>([]);
  const [guarda, setGuarda] = useState<Empleado | null>(null);
  const [turnos, setTurnos] = useState<Turno[] | null>(null);
  const [novedades, setNovedades] = useState<{ tipo: string; desde: string; hasta: string }[]>([]);
  const [reglaAntigua, setReglaAntigua] = useState(false);
  const [marcas, setMarcas] = useState<Record<string, Marca>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    db().from('periodos').select('id, inicio, fin, estado, parametros_id').eq('ciudad_id', ciudad).order('inicio', { ascending: false }).then(({ data }) => {
      const ps = (data as Periodo[]) ?? [];
      setPeriodos(ps);
      setPeriodoId(ps.find((p) => p.estado === 'abierto')?.id ?? ps[0]?.id ?? null);
    });
    db().from('festivos').select('fecha').then(({ data }) => setFestivos(((data as { fecha: string }[]) ?? []).map((f) => f.fecha)));
    db().from('ciudades').select('dia_corte').eq('id', ciudad).then(({ data }) => setDiaCorte((data as { dia_corte: number | null }[] | null)?.[0]?.dia_corte ?? 23));
  }, [ciudad]);
  const periodo = periodos.find((p) => p.id === periodoId) ?? null;

  useEffect(() => {
    if (!periodo) return;
    const consulta = periodo.parametros_id
      ? db().from('parametros_nomina').select('*').eq('id', periodo.parametros_id)
      : db().from('parametros_nomina').select('*').eq('ciudad_id', ciudad).lte('vigente_desde', periodo.inicio).order('vigente_desde', { ascending: false }).limit(1);
    consulta.then(({ data }) => setParam(((data as Parametros[]) ?? [])[0] ?? null));
  }, [periodo?.id]);

  // Búsqueda de guardas por nombre o cédula.
  useEffect(() => {
    const t = q.trim();
    if (t.length < 3 || (guarda && t === guarda.nombre)) { setOpciones([]); return; }
    const h = setTimeout(() => {
      db().from('empleados').select('id, nombre, documento').eq('ciudad_id', ciudad).neq('estado', 'retirado')
        .or(`nombre.ilike.%${t.replace(/[%,()]/g, '')}%,documento.ilike.%${t.replace(/\D/g, '') || '~'}%`).order('nombre').limit(12)
        .then(({ data }) => setOpciones((data as Empleado[]) ?? []));
    }, 300);
    return () => clearTimeout(h);
  }, [q, ciudad, guarda]);

  const dias = useMemo(() => (periodo ? diasDelPeriodo(periodo.inicio, periodo.fin, festivos) : []), [periodo?.id, festivos]);

  // Turnos del guarda en el periodo (o el guarda de ejemplo: 2 días, 2 noches, 2 descansos).
  useEffect(() => {
    setMarcas({}); setError('');
    if (!periodo) return;
    if (!guarda) {
      const ej: Turno[] = [];
      dias.forEach((d, i) => {
        const m = ['-', '-', 'D', 'D', 'N', 'N'][i % 6];
        if (m === 'D') ej.push({ inicio: `${d.fecha}T06:00`, fin: `${d.fecha}T18:00` });
        if (m === 'N') ej.push({ inicio: `${d.fecha}T18:00`, fin: `${sig(d.fecha)}T06:00` });
      });
      setTurnos(ej); setNovedades([]); setReglaAntigua(false);
      return;
    }
    setTurnos(null);
    const finMas1 = sig(periodo.fin);
    Promise.all([
      todo<Turno>((a, b) => db().from('turnos').select('inicio, fin').eq('empleado_id', guarda.id).gte('inicio', periodo.inicio).lt('inicio', finMas1).order('inicio').range(a, b)),
      todo<{ tipo: string; desde: string; hasta: string }>((a, b) => db().from('novedades').select('tipo, desde, hasta').eq('empleado_id', guarda.id)
        .lte('desde', periodo.fin).gte('hasta', periodo.inicio).neq('estado', 'anulada').range(a, b)),
      db().from('asignaciones').select('regla_dominical_antigua').eq('empleado_id', guarda.id).lte('desde', periodo.fin).gte('hasta', periodo.inicio).limit(1),
    ]).then(([ts, ns, as]) => {
      setTurnos(ts.map((t) => ({ inicio: norm(t.inicio), fin: norm(t.fin) })));
      setNovedades(ns);
      setReglaAntigua(!!(as.data as { regla_dominical_antigua: boolean }[] | null)?.[0]?.regla_dominical_antigua);
    }).catch((e) => setError((e as Error).message));
  }, [guarda?.id, periodo?.id, dias.length]);

  const turnosDe = (fecha: string) => (turnos ?? []).filter((t) => t.inicio.slice(0, 10) === fecha);
  const simulados = useMemo(() => {
    const out: Turno[] = [];
    for (const d of dias) {
      const m = marcas[d.fecha] ?? 'original';
      if (m === 'original') out.push(...turnosDe(d.fecha));
      if (m === 'dia') out.push({ inicio: `${d.fecha}T06:00`, fin: `${d.fecha}T18:00` });
      if (m === 'noche') out.push({ inicio: `${d.fecha}T18:00`, fin: `${sig(d.fecha)}T06:00` });
    }
    return out;
  }, [dias, marcas, turnos]);

  const calcular = (ts: Turno[]) => {
    if (!periodo || !param) return null;
    const r = calcularCierre({
      inicio: periodo.inicio, fin: periodo.fin, festivos, parametros: parametrosDesdeBase(param, diaCorte),
      empleados: [1], turnos: ts.map((t) => ({ empleado_id: 1, ...t })), novedades: novedades.map((n) => ({ empleado_id: 1, ...n })),
      reglaAntigua: reglaAntigua ? new Set([1]) : new Set(),
    })[0];
    if (r.error) { return { error: r.error } as const; }
    return { totales: r.totales as unknown as Record<string, number> } as const;
  };
  const antes = useMemo(() => (turnos ? calcular(turnos) : null), [turnos, param, novedades, reglaAntigua, diaCorte, periodo?.id, festivos]);
  const despues = useMemo(() => (turnos ? calcular(simulados) : null), [simulados, param, novedades, reglaAntigua, diaCorte, periodo?.id, festivos]);
  const valorHora = param ? Number(param.smlv) / Number(param.divisor_valor_hora) : 0;
  // null = la ciudad no define el factor de ese concepto; se muestra "—" y queda fuera del total.
  const plata = (t: Record<string, number> | undefined, c: typeof CONCEPTOS[number]): number | null => {
    if (!t || !c.factor) return null;
    const f = factorDe(param?.factores, c.factor);
    return f === null ? null : Number(t[c.k] ?? 0) * valorHora * f;
  };
  const totalPesos = (t: Record<string, number> | undefined) => CONCEPTOS.reduce((s, c) => s + (plata(t, c) ?? 0), 0);
  // Conceptos con horas en el periodo pero sin factor en la ciudad: su costo no se puede calcular.
  const sinFactor = (t: Record<string, number> | undefined) => CONCEPTOS.filter(
    (c) => c.factor && factorDe(param?.factores, c.factor) === null && Number(t?.[c.k] ?? 0) !== 0,
  );
  const cambios = Object.values(marcas).filter((m) => m !== 'original').length;

  const ciclo = (fecha: string) => setMarcas((m) => {
    const tiene = turnosDe(fecha).length > 0;
    const orden: Marca[] = tiene ? ['original', 'descanso', 'dia', 'noche'] : ['original', 'dia', 'noche'];
    const actual = m[fecha] ?? 'original';
    return { ...m, [fecha]: orden[(orden.indexOf(actual) + 1) % orden.length] };
  });

  const ta = antes && 'totales' in antes ? antes.totales : undefined;
  const td = despues && 'totales' in despues ? despues.totales : undefined;
  return (
    <section style={{ display: 'grid', gap: 14 }}>
      <p className="texto-suave" style={{ margin: 0, fontSize: 14 }}>
        Escoja un guarda y el periodo; toque un día para cambiarlo y vea cuánto suben o bajan las horas extra y el costo. No se guarda nada.
      </p>
      <div className="barra-filtros" style={{ margin: 0 }}>
        <label className="campo" style={{ flex: '0 1 300px' }}>Periodo
          <select value={periodoId ?? ''} onChange={(e) => setPeriodoId(Number(e.target.value))}>
            {periodos.map((p) => <option key={p.id} value={p.id}>{p.inicio} a {p.fin} ({p.estado})</option>)}
          </select>
        </label>
        <label className="campo" style={{ flex: '1 1 300px', position: 'relative' }}>Guarda (nombre o cédula)
          <input value={q} onChange={(e) => { setQ(e.target.value); if (guarda) setGuarda(null); }} placeholder="Vacío = guarda de ejemplo" />
          {opciones.length > 0 && (
            <div className="card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, padding: 4, maxHeight: 280, overflow: 'auto' }}>
              {opciones.map((o) => (
                <button key={o.id} className="secundario" style={{ display: 'block', width: '100%', textAlign: 'left', margin: '2px 0' }}
                  onClick={() => { setGuarda(o); setQ(o.nombre); setOpciones([]); }}>
                  <b>{o.nombre}</b> <span className="texto-suave" style={{ fontSize: 12 }}>{o.documento}</span>
                </button>
              ))}
            </div>
          )}
        </label>
        {cambios > 0 && <button className="secundario" onClick={() => setMarcas({})}><RotateCcw size={14} style={{ verticalAlign: '-3px', marginRight: 6 }} />Deshacer cambios ({cambios})</button>}
      </div>
      <div className="texto-suave" style={{ fontSize: 13 }}>
        {guarda ? <>Guarda: <b>{guarda.nombre}</b> · {guarda.documento} · {turnos ? `${turnos.length} turnos en el periodo` : 'cargando…'}{novedades.length ? ` · ${novedades.length} novedad(es)` : ''}</>
          : <>Guarda de ejemplo: rotación 2 días, 2 noches, 2 descansos.</>}
        {' '}Toque un día: {guarda ? 'lo que tenía → descanso → ' : ''}día (06–18) → noche (18–06). Borde naranja = domingo o festivo; borde azul = día cambiado.
      </div>
      {error && <div className="aviso-caja error" style={{ margin: 0 }}>{error}</div>}
      <div className="card" style={{ padding: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
          {dias.map((d) => {
            const m = marcas[d.fecha] ?? 'original';
            const ts = m === 'original' ? turnosDe(d.fecha) : m === 'dia' ? [{ inicio: `${d.fecha}T06:00`, fin: `${d.fecha}T18:00` }] : m === 'noche' ? [{ inicio: `${d.fecha}T18:00`, fin: `${sig(d.fecha)}T06:00` }] : [];
            const noche = ts.some((t) => Number(hm(t.inicio).slice(0, 2)) >= 18 || Number(hm(t.inicio).slice(0, 2)) < 5);
            return (
              <button key={d.fecha} onClick={() => ciclo(d.fecha)} style={{
                padding: '6px 2px', borderRadius: 9, boxShadow: 'none', minWidth: 0,
                border: m !== 'original' ? '2px solid #2563eb' : d.letra === 'D' || d.letra === 'F' ? '2px solid var(--amber)' : '1px solid var(--line)',
                background: !ts.length ? '#f1f5f9' : noche ? '#dbeafe' : '#fef3c7',
                color: !ts.length ? 'var(--muted)' : noche ? '#1e3a8a' : '#92400e',
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.8 }}>{d.letra} {d.diaMes}</div>
                <div style={{ fontSize: 12 }}>{ts.length ? ts.map((t) => `${hm(t.inicio)}–${hm(t.fin)}`).join(' · ') : 'Desc.'}</div>
              </button>
            );
          })}
        </div>
      </div>
      {antes && 'error' in antes && <div className="aviso-caja error" style={{ margin: 0 }}>No se pudo calcular: {antes.error}</div>}
      {ta && td && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ fontSize: 14 }}>
            <thead><tr><th>Concepto</th><th style={{ textAlign: 'right' }}>Antes</th><th style={{ textAlign: 'right' }}>Con los cambios</th><th style={{ textAlign: 'right' }}>Diferencia</th><th style={{ textAlign: 'right' }}>Diferencia en pesos</th></tr></thead>
            <tbody>
              {CONCEPTOS.map((c) => {
                const a = Number(ta[c.k] ?? 0), b = Number(td[c.k] ?? 0);
                const pa = plata(ta, c), pd = plata(td, c);
                const dp = pa === null || pd === null ? null : pd - pa;
                return (
                  <tr key={c.k} style={b !== a ? { background: '#eff6ff' } : undefined}>
                    <td>{c.nombre}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{num(a)}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{num(b)}</td>
                    <td className="num" style={{ textAlign: 'right', fontWeight: b !== a ? 700 : 400 }}>{b === a ? '—' : `${b > a ? '+' : ''}${num(b - a)}`}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{c.factor && dp === null ? '—' : dp ? `${dp > 0 ? '+' : ''}${pesos(dp)}` : ''}</td>
                  </tr>
                );
              })}
              <tr style={{ fontWeight: 700, background: 'var(--soft)' }}>
                <td>Total extras y recargos en pesos</td>
                <td className="num" style={{ textAlign: 'right' }}>{pesos(totalPesos(ta))}</td>
                <td className="num" style={{ textAlign: 'right' }}>{pesos(totalPesos(td))}</td>
                <td />
                <td className="num" style={{ textAlign: 'right' }}>{(() => { const d = totalPesos(td) - totalPesos(ta); return d ? `${d > 0 ? '+' : ''}${pesos(d)}` : '—'; })()}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {ta && td && sinFactor(td).length > 0 && (
        <div className="aviso-caja alerta" style={{ margin: 0 }}>
          Los parámetros de esta ciudad no traen el factor de: {sinFactor(td).map((c) => c.nombre).join(', ')}. Esas horas aparecen con «—» y quedan fuera del total en pesos, para no mostrarlas como si no costaran. Por validar con Nómina.
        </div>
      )}
      <p className="texto-suave" style={{ margin: 0, fontSize: 12 }}>
        Mismo cálculo de Cierre y nómina (reglas del Excel de Pereira, por validar con nómina). Pesos con el valor hora {valorHora ? pesos(valorHora) : '…'} (salario mínimo ÷ divisor) por el factor de cada concepto; no es el salario real ni incluye prestaciones.
      </p>
    </section>
  );
}
