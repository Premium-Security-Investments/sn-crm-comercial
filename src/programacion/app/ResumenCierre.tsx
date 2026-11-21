// Resumen único del periodo (Juan, 2026-10-17): horas y pesos lado a lado, igual en un periodo cerrado y en una
// proyección. Sale del cálculo guardado, la misma fuente del listado y del costo por cliente, así que todo cuadra.
import { useEffect, useMemo, useState } from 'react';
import { db } from './supabase.ts';
import { todas } from './CostoExtras.tsx';

const FILAS: { grupo: 'extras' | 'recargos'; concepto: string; nombre: string }[] = [
  { grupo: 'extras', concepto: 'hed', nombre: 'Extras diurnas (HED)' },
  { grupo: 'extras', concepto: 'hen', nombre: 'Extras nocturnas (HEN)' },
  { grupo: 'extras', concepto: 'hedDoF', nombre: 'Extras diurnas en domingo o festivo' },
  { grupo: 'extras', concepto: 'henDoF', nombre: 'Extras nocturnas en domingo o festivo' },
  { grupo: 'recargos', concepto: 'recargoNocturno', nombre: 'Recargo nocturno (horas normales de noche)' },
  { grupo: 'recargos', concepto: 'dofConCompensatorio', nombre: 'Domingo o festivo con compensatorio' },
  { grupo: 'recargos', concepto: 'dofSinCompensatorio', nombre: 'Domingo o festivo sin compensatorio' },
];
const pesos = (n: number) => n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const horas = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 1 });

export function ResumenCierre({ periodo, calculadoEn, proyeccion }: {
  periodo: { id: number }; calculadoEn: string; proyeccion: boolean;
}) {
  const [filas, setFilas] = useState<{ puesto_id: number | null; concepto: string; horas: number; valor: number }[] | null>(null);
  const [guardas, setGuardas] = useState<{ total: number; sinTurnos: number; dias: number } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setFilas(null); setGuardas(null); setError('');
    todas(periodo.id).then(setFilas).catch((e) => setError((e as Error).message));
    (async () => {
      let total = 0, sinTurnos = 0, dias = 0;
      for (let i = 0; ; i += 1000) {
        const { data, error } = await db().from('resultados_nomina').select('totales').eq('periodo_id', periodo.id).order('empleado_id').range(i, i + 999);
        if (error) { setError(error.message); return; }
        const f = (data as { totales: Record<string, number> }[]) ?? [];
        f.forEach(({ totales: t }) => {
          total += 1; dias += Number(t.diasLaborados ?? 0);
          if (!Number(t.diasLaborados) && !Number(t.horasOrdinarias)) sinTurnos += 1;
        });
        if (f.length < 1000) break;
      }
      setGuardas({ total, sinTurnos, dias });
    })();
  }, [periodo.id, calculadoEn]);

  const suma = useMemo(() => {
    const m = new Map<string, { horas: number; valor: number }>();
    let fuera = 0;
    for (const f of filas ?? []) {
      if (f.puesto_id === null) { fuera += Number(f.valor); continue; }
      const x = m.get(f.concepto) ?? { horas: 0, valor: 0 };
      x.horas += Number(f.horas); x.valor += Number(f.valor);
      m.set(f.concepto, x);
    }
    const de = (g: 'extras' | 'recargos') => FILAS.filter((r) => r.grupo === g).reduce((t, r) => ({
      horas: t.horas + (m.get(r.concepto)?.horas ?? 0), valor: t.valor + (m.get(r.concepto)?.valor ?? 0) }), { horas: 0, valor: 0 });
    return { m, extras: de('extras'), recargos: de('recargos'), fuera };
  }, [filas]);

  if (error) return <div className="aviso-caja error">{error}</div>;
  if (!filas || !guardas) return <p className="texto-suave">Armando el resumen del periodo…</p>;
  const fila = (nombre: string, h: number | null, v: number, fuerte = false) => (
    <tr key={nombre} style={fuerte ? { fontWeight: 700, background: 'var(--soft)' } : undefined}>
      <td>{nombre}</td>
      <td className="num" style={{ textAlign: 'right' }}>{h === null ? '' : horas(h)}</td>
      <td className="num" style={{ textAlign: 'right' }}>{pesos(v)}</td>
    </tr>
  );
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
        <h3 className="titulo-seccion" style={{ margin: 0 }}>Resumen del periodo{proyeccion ? ' (proyección)' : ''}</h3>
        <div className="texto-suave" style={{ fontSize: 13, marginTop: 4 }}>
          <b>{guardas.total.toLocaleString('es-CO')}</b> guardas calculados
          {guardas.sinTurnos > 0 && <> · <b>{guardas.sinTurnos.toLocaleString('es-CO')}</b> sin ningún turno (quedan con 0 días y 0 horas)</>}
          {' '}· <b>{guardas.dias.toLocaleString('es-CO')}</b> días trabajados en total
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ fontSize: 14 }}>
          <thead><tr><th>Concepto</th><th style={{ textAlign: 'right' }}>Horas</th><th style={{ textAlign: 'right' }}>Pesos</th></tr></thead>
          <tbody>
            {FILAS.filter((r) => r.grupo === 'extras').map((r) => fila(r.nombre, suma.m.get(r.concepto)?.horas ?? 0, suma.m.get(r.concepto)?.valor ?? 0))}
            {fila('Total horas extra', suma.extras.horas, suma.extras.valor, true)}
            {FILAS.filter((r) => r.grupo === 'recargos').map((r) => fila(r.nombre, suma.m.get(r.concepto)?.horas ?? 0, suma.m.get(r.concepto)?.valor ?? 0))}
            {fila('Total recargos', null, suma.recargos.valor, true)}
            {fila('Total extras y recargos', null, suma.extras.valor + suma.recargos.valor, true)}
          </tbody>
        </table>
      </div>
      <p className="texto-suave" style={{ margin: 0, padding: '10px 16px', fontSize: 12, borderTop: '1px solid var(--line)' }}>
        Pesos = horas × valor hora (salario mínimo ÷ divisor, como el Excel) × factor de cada concepto. Sin prestaciones ni seguridad social; no es el salario real.
        {suma.fuera !== 0 && <> Además hay {pesos(suma.fuera)} de guardas sin turnos que el cálculo anterior del Excel dejó con valores de domingo; no se suman.</>}
      </p>
    </div>
  );
}
