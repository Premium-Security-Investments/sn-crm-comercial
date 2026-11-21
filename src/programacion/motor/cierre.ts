// Cálculo del cierre de un periodo: un resultado por guarda con todos sus turnos y novedades
// del periodo (en cualquier puesto). Usa el motor legado de Pereira, ya verificado contra el Excel.
import { calcularBloqueLegado, type ParametrosLegado, type ResultadoLegado } from './legado-pereira.ts';
import { construirBloque, diasDelPeriodo, type Novedad, type TipoNovedad, type Turno } from './periodo.ts';

export interface DatosCierre {
  inicio: string;
  fin: string;
  festivos: string[];
  parametros: ParametrosLegado;
  /** Guardas a liquidar (con asignación en el periodo). */
  empleados: number[];
  turnos: { empleado_id: number; inicio: string; fin: string }[];
  novedades: { empleado_id: number; tipo: string; desde: string; hasta: string }[];
  /** Guardas con la regla de dominicales anterior a 07-2018. */
  reglaAntigua: Set<number>;
}

export interface ResultadoGuarda {
  empleado_id: number;
  totales?: ResultadoLegado['totales'];
  traza?: ResultadoLegado['filas'];
  error?: string;
  /** No tuvo ningún turno en el periodo: días trabajados y horas en cero (regla de la plataforma, no del Excel). */
  sinTurnos?: boolean;
}

// Regla de la plataforma (Juan, 2026-10-17): el Excel cuenta los días trabajados como días del periodo menos
// novedades, sin mirar los turnos, y su fórmula de domingos puede dejar valores a quien no trabajó. Un guarda
// sin ningún turno en el periodo queda con 0 días trabajados y 0 horas; conserva sus días de novedad.
const HORAS_EN_CERO = ['horasOrdinarias', 'saldoExtras', 'hed', 'hen', 'recargoNocturno', 'horasFestivas',
  'dofSinCompensatorio', 'dofConCompensatorio', 'hedDoF', 'henDoF', 'domingosTrabajados', 'horasFestivasPrimeras8'] as const;

const norm = (ts: string) => ts.slice(0, 16).replace(' ', 'T');

export function calcularCierre(d: DatosCierre): ResultadoGuarda[] {
  const dias = diasDelPeriodo(d.inicio, d.fin, d.festivos);
  const primer = dias.map((x) => x.letra);
  const turnosPor = new Map<number, Turno[]>();
  for (const t of d.turnos) {
    (turnosPor.get(t.empleado_id) ?? turnosPor.set(t.empleado_id, []).get(t.empleado_id)!).push({ inicio: norm(t.inicio), fin: norm(t.fin) });
  }
  const novPor = new Map<number, Novedad[]>();
  for (const n of d.novedades) {
    (novPor.get(n.empleado_id) ?? novPor.set(n.empleado_id, []).get(n.empleado_id)!)
      .push({ tipo: n.tipo as TipoNovedad, desde: n.desde.slice(0, 10), hasta: n.hasta.slice(0, 10) });
  }
  return d.empleados.map((id) => {
    try {
      const bloque = construirBloque(dias, turnosPor.get(id) ?? [], novPor.get(id) ?? [], { bandera24: d.reglaAntigua.has(id) });
      const r = calcularBloqueLegado(bloque, d.parametros, primer);
      if (!turnosPor.get(id)?.length) {
        const totales = { ...r.totales, diasLaborados: 0 };
        for (const k of HORAS_EN_CERO) totales[k] = 0;
        const traza = Object.fromEntries(Object.entries(r.filas).map(([k, v]) => [k, v.map(() => 0)])) as ResultadoLegado['filas'];
        return { empleado_id: id, totales, traza, sinTurnos: true };
      }
      return { empleado_id: id, totales: r.totales, traza: r.filas };
    } catch (e) {
      return { empleado_id: id, error: (e as Error).message };
    }
  });
}

/** Parámetros del motor a partir de la fila de parametros_nomina y el día de corte de la ciudad. */
export function parametrosDesdeBase(p: { jornada_semanal: number | string; jornada_diaria_macro: number | string | null; inicio_diurno: string; fin_diurno: string }, diaCorte: number): ParametrosLegado {
  const sem = Number(p.jornada_semanal);
  return {
    jornadaDiariaFormula: sem / 6,
    jornadaDiariaMacro: p.jornada_diaria_macro !== null ? Number(p.jornada_diaria_macro) : sem / 6,
    inicioDiurno: Number(p.inicio_diurno.slice(0, 2)),
    finDiurno: Number(p.fin_diurno.slice(0, 2)),
    diaFinalCorte: diaCorte,
  };
}
