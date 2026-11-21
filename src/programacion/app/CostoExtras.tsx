// Costo en pesos de las horas extra y recargos del periodo, por cliente, puesto o guarda.
// Lee el cálculo guardado (resultados de nómina) y lo reparte por puesto en la base (costo_extras).
import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { db } from './supabase.ts';

interface Fila { empleado_id: number; puesto_id: number | null; concepto: string; horas: number; valor: number }
type Vista = 'cliente' | 'puesto' | 'guarda';

export const CONCEPTO: Record<string, { nombre: string; extra: boolean }> = {
  hed: { nombre: 'Extra diurna', extra: true }, hen: { nombre: 'Extra nocturna', extra: true },
  hedDoF: { nombre: 'Extra diurna dom./fest.', extra: true }, henDoF: { nombre: 'Extra nocturna dom./fest.', extra: true },
  recargoNocturno: { nombre: 'Recargo nocturno', extra: false },
  dofSinCompensatorio: { nombre: 'Dom./fest. sin compensatorio', extra: false }, dofConCompensatorio: { nombre: 'Dom./fest. con compensatorio', extra: false },
};
const pesos = (n: number) => n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const horas = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 1 });

export async function todas(periodo: number): Promise<Fila[]> {
  const out: Fila[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await db().rpc('costo_extras', { p_periodo: periodo }).range(i, i + 999);
    if (error) throw new Error(error.message);
    const f = ((data as Fila[]) ?? []).map((x) => ({ ...x, horas: Number(x.horas), valor: Number(x.valor) }));
    out.push(...f);
    if (f.length < 1000) return out;
  }
}

interface Grupo { clave: string; nombre: string; detalle: string; extras: number; horasExtra: number; recargos: number; total: number; guardas: Set<number> }

export function CostoExtras({ periodo, calculadoEn, onDescargar }: {
  periodo: { id: number; inicio: string; fin: string; ciudad_id: string; parametros_id: number | null };
  calculadoEn: string | null;
  onDescargar: (nombre: string, filas: (string | number)[][]) => void;
}) {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [puestos, setPuestos] = useState<Map<number, { nombre: string; cliente_id: number | null }>>(new Map());
  const [clientes, setClientes] = useState<Map<number, string>>(new Map());
  const [valorHora, setValorHora] = useState<number | null>(null);
  const [vista, setVista] = useState<Vista>('cliente');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [empleados, setEmpleados] = useState<Map<number, { nombre: string; documento: string }>>(new Map());
  const nombreEmpleado = (id: number) => empleados.get(id);

  useEffect(() => {
    if (!calculadoEn) return;
    setFilas(null); setError('');
    todas(periodo.id).then(setFilas).catch((e) => setError((e as Error).message));
    db().from('puestos').select('id, nombre, cliente_id').eq('ciudad_id', periodo.ciudad_id).limit(5000)
      .then(({ data }) => setPuestos(new Map(((data as { id: number; nombre: string; cliente_id: number | null }[]) ?? []).map((p) => [p.id, p]))));
    (async () => {
      const m = new Map<number, { nombre: string; documento: string }>();
      for (let i = 0; ; i += 1000) {
        const { data } = await db().from('empleados').select('id, nombre, documento').eq('ciudad_id', periodo.ciudad_id).order('id').range(i, i + 999);
        const f = (data as { id: number; nombre: string; documento: string }[]) ?? [];
        f.forEach((e) => m.set(e.id, e));
        if (f.length < 1000) break;
      }
      setEmpleados(m);
    })();
    db().from('clientes').select('id, razon_social').limit(5000)
      .then(({ data }) => setClientes(new Map(((data as { id: number; razon_social: string }[]) ?? []).map((c) => [c.id, c.razon_social]))));
    const par = periodo.parametros_id
      ? db().from('parametros_nomina').select('smlv, divisor_valor_hora').eq('id', periodo.parametros_id)
      : db().from('parametros_nomina').select('smlv, divisor_valor_hora').eq('ciudad_id', periodo.ciudad_id).lte('vigente_desde', periodo.fin).order('vigente_desde', { ascending: false }).limit(1);
    par.then(({ data }) => { const p = (data as { smlv: number; divisor_valor_hora: number }[] | null)?.[0]; setValorHora(p ? p.smlv / p.divisor_valor_hora : null); });
  }, [periodo.id, calculadoEn]);

  // Guardas sin turnos en el periodo: el cálculo heredado del Excel les deja valores dominicales; van aparte.
  const sinPuesto = useMemo(() => (filas ?? []).filter((f) => f.puesto_id === null), [filas]);
  const conPuesto = useMemo(() => (filas ?? []).filter((f) => f.puesto_id !== null), [filas]);

  const grupos = useMemo(() => {
    const m = new Map<string, Grupo>();
    for (const f of conPuesto) {
      const p = puestos.get(f.puesto_id!);
      const cliente = p?.cliente_id ? clientes.get(p.cliente_id) ?? 'Cliente sin nombre' : 'Sin cliente asignado';
      const [clave, nombre, detalle] = vista === 'cliente' ? [`c${p?.cliente_id ?? 0}`, cliente, '']
        : vista === 'puesto' ? [`p${f.puesto_id}`, p?.nombre ?? `Puesto ${f.puesto_id}`, cliente]
        : [`e${f.empleado_id}`, nombreEmpleado(f.empleado_id)?.nombre ?? `Guarda ${f.empleado_id}`, nombreEmpleado(f.empleado_id)?.documento ?? ''];
      const g = m.get(clave) ?? { clave, nombre, detalle, extras: 0, horasExtra: 0, recargos: 0, total: 0, guardas: new Set<number>() };
      if (CONCEPTO[f.concepto]?.extra) { g.extras += f.valor; g.horasExtra += f.horas; } else g.recargos += f.valor;
      g.total += f.valor;
      g.guardas.add(f.empleado_id);
      m.set(clave, g);
    }
    const t = q.trim().toLowerCase();
    return [...m.values()].filter((g) => !t || g.nombre.toLowerCase().includes(t) || g.detalle.toLowerCase().includes(t)).sort((a, b) => b.extras - a.extras);
  }, [conPuesto, puestos, clientes, vista, q, empleados]);

  const descargar = () => onDescargar(`costo-extras-${vista}-${periodo.ciudad_id}-${periodo.inicio}-a-${periodo.fin}.csv`, [
    [vista === 'cliente' ? 'Cliente' : vista === 'puesto' ? 'Puesto' : 'Guarda', vista === 'puesto' ? 'Cliente' : vista === 'guarda' ? 'Documento' : '', 'Guardas', 'Horas extra', 'Valor horas extra', 'Valor recargos', 'Total'],
    ...grupos.map((g) => [g.nombre, g.detalle, g.guardas.size, g.horasExtra, Math.round(g.extras), Math.round(g.recargos), Math.round(g.total)]),
  ]);

  if (!calculadoEn) return <div className="vacio">Calcule el periodo para ver el costo en pesos de las horas extra.</div>;
  if (error) return <div className="aviso-caja error">{error}</div>;
  if (!filas) return <p>Calculando el costo por puesto…</p>;
  const maximo = Math.max(1, ...grupos.map((g) => g.extras));
  // Fila de total arriba de la tabla (respeta la búsqueda): horas extra y su costo de un vistazo.
  const suma = grupos.reduce((t, g) => ({ horasExtra: t.horasExtra + g.horasExtra, extras: t.extras + g.extras, recargos: t.recargos + g.recargos,
    total: t.total + g.total, guardas: new Set([...t.guardas, ...g.guardas]) }), { horasExtra: 0, extras: 0, recargos: 0, total: 0, guardas: new Set<number>() });
  const conGuardas = vista !== 'guarda';

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
        Valor hora {valorHora ? pesos(valorHora) : '…'} (salario mínimo ÷ divisor, como el Excel) por el factor de cada concepto. Sin prestaciones ni seguridad social.
        Cada hora se carga al puesto donde se trabajó ese día. Cálculo del {new Date(calculadoEn).toLocaleString('es-CO')}
      </p>
      {sinPuesto.length > 0 && (
        <div className="aviso-caja alerta">
          {(() => { const n = new Set(sinPuesto.map((f) => f.empleado_id)).size; return n === 1 ? '1 guarda sin turnos en el periodo queda' : `${n} guardas sin turnos en el periodo quedan`; })()} con valores dominicales en el cálculo heredado del Excel
          (neto {pesos(sinPuesto.reduce((s, f) => s + f.valor, 0))}). No se suman aquí; conviene revisarlos con nómina.
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }} role="tablist" aria-label="Agrupar por">
          {(['cliente', 'puesto', 'guarda'] as Vista[]).map((v) => (
            <button key={v} role="tab" aria-selected={vista === v} className={`chico ${vista === v ? '' : 'secundario'}`} onClick={() => setVista(v)}>
              Por {v}
            </button>
          ))}
        </div>
        <label style={{ display: 'grid', gap: 6, flex: '1 1 220px' }}>Buscar<input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Nombre del ${vista}`} /></label>
        <button className="secundario" onClick={descargar}><Download size={15} style={{ verticalAlign: '-3px', marginRight: 6 }} />Descargar</button>
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        {grupos.length === 0 ? <div className="vacio">No hay horas extra ni recargos en este periodo.</div> : (
          <table>
            <thead><tr><th>{vista === 'cliente' ? 'Cliente' : vista === 'puesto' ? 'Puesto' : 'Guarda'}</th>{conGuardas && <th style={{ textAlign: 'right' }}>Guardas</th>}<th style={{ textAlign: 'right' }}>Horas extra</th><th style={{ minWidth: 200 }}>Valor horas extra</th><th style={{ textAlign: 'right' }}>Recargos</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
            <tbody>
              <tr style={{ fontWeight: 700, background: 'var(--soft)' }}>
                <td>Total{q.trim() ? ' (búsqueda)' : ''} · {grupos.length.toLocaleString('es-CO')} {vista === 'cliente' ? 'clientes' : vista === 'puesto' ? 'puestos' : 'guardas'}</td>
                {conGuardas && <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{suma.guardas.size.toLocaleString('es-CO')}</td>}
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{horas(suma.horasExtra)}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{pesos(suma.extras)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{pesos(suma.recargos)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{pesos(suma.total)}</td>
              </tr>
              {grupos.slice(0, 200).map((g) => (
                <tr key={g.clave}>
                  <td style={{ minWidth: 200 }}><strong style={{ overflowWrap: 'anywhere' }}>{g.nombre}</strong>{g.detalle && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{g.detalle}</div>}</td>
                  {conGuardas && <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{g.guardas.size}</td>}
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{horas(g.horasExtra)}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: '0 0 auto', width: 90, height: 6, borderRadius: 3, background: '#eef2f7', overflow: 'hidden' }}>
                        <span style={{ display: 'block', height: '100%', width: `${(g.extras / maximo) * 100}%`, background: 'var(--amber)' }} />
                      </span>
                      <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{pesos(g.extras)}</span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{pesos(g.recargos)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}><strong>{pesos(g.total)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {grupos.length > 200 && <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>Se muestran 200 de {grupos.length}; la descarga trae todos.</p>}
    </div>
  );
}
