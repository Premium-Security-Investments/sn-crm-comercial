// Calendario del periodo y conversión del modelo nuevo (turnos con fecha y hora
// reales + novedades por rango) al formato que entiende el motor legado.
import type { BloqueLegado, Celda, DiaLegado } from './legado-pereira.ts';

export type TipoNovedad =
  | 'incapacidad' | 'permiso_remunerado' | 'permiso_no_remunerado' | 'ausencia'
  | 'sancion' | 'vacaciones' | 'retiro' | 'no_vinculado' | 'fuera_de_corte';

export interface Turno {
  /** 'YYYY-MM-DDTHH:MM' hora local. */
  inicio: string;
  fin: string;
}

export interface Novedad {
  tipo: TipoNovedad;
  desde: string; // 'YYYY-MM-DD'
  hasta: string;
}

const LETRA_NOVEDAD: Record<TipoNovedad, string> = {
  incapacidad: 'I',
  permiso_remunerado: 'PR',
  permiso_no_remunerado: 'PN',
  ausencia: 'A',
  sancion: 'S',
  vacaciones: 'V',
  retiro: 'R',
  no_vinculado: 'N',
  fuera_de_corte: 'T',
};

const LETRA_DIA = ['D', 'L', 'M', 'MI', 'J', 'V', 'S']; // getUTCDay: 0 = domingo

export function sumarDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Periodo con corte en `diaCorte` (Pereira: 24 del mes anterior a 23 del mes). */
export function periodoConCorte(anio: number, mes: number, diaCorte: number): { inicio: string; fin: string } {
  const fin = `${anio}-${String(mes).padStart(2, '0')}-${String(diaCorte).padStart(2, '0')}`;
  const ini = new Date(Date.UTC(anio, mes - 2, diaCorte + 1));
  return { inicio: ini.toISOString().slice(0, 10), fin };
}

export interface DiaPeriodo {
  fecha: string;
  diaMes: number;
  /** L, M, MI, J, V, S, D o F (festivo; un festivo en domingo queda como D). */
  letra: string;
}

export function diasDelPeriodo(inicio: string, fin: string, festivos: Iterable<string>): DiaPeriodo[] {
  const fest = new Set(festivos);
  const dias: DiaPeriodo[] = [];
  for (let f = inicio; f <= fin; f = sumarDias(f, 1)) {
    const d = new Date(`${f}T00:00:00Z`);
    const dow = d.getUTCDay();
    const letra = dow !== 0 && fest.has(f) ? 'F' : LETRA_DIA[dow];
    dias.push({ fecha: f, diaMes: d.getUTCDate(), letra });
  }
  return dias;
}

function horaAFraccion(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h * 60 + m) / 1440;
}

/**
 * Arma el bloque del Excel a partir de turnos y novedades:
 * - un turno que cruza la medianoche se escribe en el día en que empieza, partido
 *   en dos tramos (inicio→24:00 y 00:00→fin), como lo exige la macro;
 * - un día con novedad lleva su letra; un día sin turno ni novedad, "D" (descanso).
 * El bloque siempre tiene 33 columnas (B..AH); las sobrantes quedan vacías.
 */
export function construirBloque(
  dias: DiaPeriodo[],
  turnos: Turno[],
  novedades: Novedad[] = [],
  opciones: { bandera24?: boolean } = {},
): BloqueLegado {
  const COLUMNAS = 33;
  const tramosPorDia = new Map<string, Celda[]>();
  const ordenados = [...turnos].sort((a, b) => a.inicio.localeCompare(b.inicio));
  for (const t of ordenados) {
    const fecha = t.inicio.slice(0, 10);
    const fechaFin = t.fin.slice(0, 10);
    const hi = horaAFraccion(t.inicio.slice(11, 16));
    const hf = horaAFraccion(t.fin.slice(11, 16));
    const lista = tramosPorDia.get(fecha) ?? [];
    if (fechaFin > fecha) {
      lista.push(hi, 1);
      if (hf > 0) lista.push(0, hf);
    } else {
      lista.push(hi, hf);
    }
    if (lista.length > 10) throw new Error(`Más de 5 tramos el ${fecha}`);
    tramosPorDia.set(fecha, lista);
  }
  const letraPorDia = new Map<string, string>();
  for (const n of novedades) {
    for (let f = n.desde; f <= n.hasta; f = sumarDias(f, 1)) letraPorDia.set(f, LETRA_NOVEDAD[n.tipo]);
  }

  const salida: DiaLegado[] = [];
  for (let c = 0; c < COLUMNAS; c++) {
    const d = dias[c];
    if (!d) {
      salida.push({ diaSemana: '', diaMes: null, tramos: new Array(10).fill(null) });
      continue;
    }
    const tramos: Celda[] = new Array(10).fill(null);
    const letra = letraPorDia.get(d.fecha);
    const horas = tramosPorDia.get(d.fecha);
    if (letra) tramos[0] = letra;
    else if (horas) horas.forEach((v, i) => (tramos[i] = v));
    else tramos[0] = 'D';
    salida.push({ diaSemana: d.letra, diaMes: d.diaMes, tramos });
  }
  return { dias: salida, bandera24: opciones.bandera24 ?? false };
}
