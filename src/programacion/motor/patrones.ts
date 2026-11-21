// Turnos tipo (patrones) y generación de la programación del periodo.
// Un patrón se define por su contenido: un ciclo de días con sus tramos.
// El código ("T-24H-06-18-...-G1") es solo una etiqueta.
import type { Celda } from './legado-pereira.ts';
import type { DiaPeriodo, Turno } from './periodo.ts';
import { sumarDias } from './periodo.ts';

/** 'HH:MM'. Si fin <= inicio, el tramo termina al día siguiente. */
export interface Tramo {
  inicio: string;
  fin: string;
}

export interface DiaPatron {
  tramos: Tramo[]; // [] = descanso
}

export type Patron =
  | {
      tipo: 'rotativo';
      codigo: string;
      cicloDias: number;
      dias: DiaPatron[];
      /** Grupos que rotan con el mismo ciclo (p. ej. 3 en un puesto 24 h); el grupo g va (g-1)·desfase días adelante. */
      grupos?: number;
      desfaseGrupos?: number;
    }
  | {
      tipo: 'semanal';
      codigo: string;
      /** Lunes a domingo (7 elementos). */
      dias: DiaPatron[];
      /** Horario para festivos; si falta, el festivo usa el día de la semana. */
      horarioFestivo?: DiaPatron;
    };

const MIN_DIA = 1440;

function aHHMM(min: number): string {
  const m = ((Math.round(min) % MIN_DIA) + MIN_DIA) % MIN_DIA;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function aMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Lee una columna de horario del Excel (pares HI/HF) y la vuelve tramos.
 * Une "18:00→24:00" + "00:00→06:00" en un solo tramo 18:00→06:00.
 * Devuelve null si la columna tiene una letra distinta de descanso (novedad).
 */
export function diaDesdeCeldas(celdas: Celda[]): DiaPatron | { letra: string } {
  const intervalos: [number, number][] = [];
  let finAnterior: number | null = null;
  for (let k = 0; k + 1 < celdas.length; k += 2) {
    const hi = celdas[k];
    const hf = celdas[k + 1];
    if (typeof hi === 'string') {
      const letra = hi.trim();
      if (letra === 'D' || letra === '') return { tramos: [] };
      return { letra };
    }
    if (hi === null && hf === null) continue;
    if (typeof hi !== 'number' || typeof hf !== 'number') continue;
    let a = Math.round(hi * MIN_DIA);
    let b = Math.round(hf * MIN_DIA);
    if (a === b) continue;
    if (a === 0 && finAnterior === MIN_DIA) {
      a += MIN_DIA;
      b += MIN_DIA;
    }
    intervalos.push([a, b]);
    finAnterior = Math.round(hf * MIN_DIA);
  }
  // Une intervalos contiguos (18-24 + 24-30 → 18-30).
  const unidos: [number, number][] = [];
  for (const iv of intervalos) {
    const ult = unidos[unidos.length - 1];
    if (ult && ult[1] === iv[0]) ult[1] = iv[1];
    else unidos.push([...iv]);
  }
  return { tramos: unidos.map(([a, b]) => ({ inicio: aHHMM(a), fin: aHHMM(b) })) };
}

export function claveDia(d: DiaPatron): string {
  return d.tramos.map((t) => `${t.inicio}-${t.fin}`).join(',');
}

/** Ciclo más corto que repite exactamente la secuencia observada (máximo `maximo` días). */
export function inferirCiclo(dias: DiaPatron[], maximo = 16): number {
  const claves = dias.map(claveDia);
  for (let p = 1; p <= Math.min(maximo, claves.length); p++) {
    let ok = true;
    for (let i = p; i < claves.length && ok; i++) if (claves[i] !== claves[i - p]) ok = false;
    if (ok) return p;
  }
  return claves.length;
}

/**
 * Ciclo corto que explica la secuencia salvo unos pocos días (excepciones).
 * Devuelve el ciclo con menos excepciones, si son a lo sumo `maxExcepciones`.
 */
export function inferirCicloConExcepciones(
  dias: DiaPatron[],
  maxExcepciones = 3,
  maximo = 16,
): { ciclo: number; base: DiaPatron[]; excepciones: number[] } | null {
  let mejor: { ciclo: number; base: DiaPatron[]; excepciones: number[] } | null = null;
  for (let p = 1; p <= Math.min(maximo, Math.floor(dias.length / 2)); p++) {
    // Para cada posición del ciclo, el día más frecuente es el "normal".
    const base: DiaPatron[] = [];
    for (let j = 0; j < p; j++) {
      const conteo = new Map<string, { n: number; d: DiaPatron }>();
      for (let i = j; i < dias.length; i += p) {
        const k = claveDia(dias[i]);
        const c = conteo.get(k) ?? { n: 0, d: dias[i] };
        c.n++;
        conteo.set(k, c);
      }
      base.push([...conteo.values()].sort((a, b) => b.n - a.n)[0].d);
    }
    const excepciones = dias.flatMap((d, i) => (claveDia(d) === claveDia(base[i % p]) ? [] : [i]));
    if (excepciones.length <= maxExcepciones && (!mejor || excepciones.length < mejor.excepciones.length)) {
      mejor = { ciclo: p, base, excepciones };
      if (excepciones.length === 0) break;
    }
  }
  return mejor;
}

/**
 * Si la secuencia es un horario fijo por día de la semana (con festivos aparte),
 * devuelve ese patrón semanal. `letras`: L, M, MI, J, V, S, D o F de cada día.
 */
export function inferirSemanal(dias: DiaPatron[], letras: string[], codigo: string): Patron | null {
  const ORDEN = ['L', 'M', 'MI', 'J', 'V', 'S', 'D'];
  const porLetra = new Map<string, string>();
  const ejemplo = new Map<string, DiaPatron>();
  for (let i = 0; i < dias.length; i++) {
    const k = claveDia(dias[i]);
    const prev = porLetra.get(letras[i]);
    if (prev !== undefined && prev !== k) return null;
    porLetra.set(letras[i], k);
    ejemplo.set(letras[i], dias[i]);
  }
  if (!ORDEN.every((l) => ejemplo.has(l))) return null;
  return { tipo: 'semanal', codigo, dias: ORDEN.map((l) => ejemplo.get(l)!), horarioFestivo: ejemplo.get('F') };
}

function diaDelPatron(p: Patron, ancla: string, d: DiaPeriodo, grupo = 1): DiaPatron {
  if (p.tipo === 'rotativo') {
    const delta = Math.round((Date.parse(`${d.fecha}T00:00:00Z`) - Date.parse(`${ancla}T00:00:00Z`)) / 86400000)
      + (grupo - 1) * (p.desfaseGrupos ?? 0);
    const i = ((delta % p.cicloDias) + p.cicloDias) % p.cicloDias;
    return p.dias[i];
  }
  if (d.letra === 'F' && p.horarioFestivo) return p.horarioFestivo;
  const dow = new Date(`${d.fecha}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return p.dias[(dow + 6) % 7];
}

/** Genera los turnos programados de un periodo a partir de un patrón, su fecha ancla y el grupo. */
export function generarTurnos(p: Patron, ancla: string, dias: DiaPeriodo[], grupo = 1): Turno[] {
  const turnos: Turno[] = [];
  for (const d of dias) {
    for (const t of diaDelPatron(p, ancla, d, grupo).tramos) {
      const fin = aMin(t.fin) <= aMin(t.inicio) ? sumarDias(d.fecha, 1) : d.fecha;
      turnos.push({ inicio: `${d.fecha}T${t.inicio}`, fin: `${fin}T${t.fin}` });
    }
  }
  return turnos;
}

/**
 * Cuántos días va adelantado `otro` frente a `base` (otro[i] = base[i + s]), o null si no es la
 * misma rotación corrida. Sirve para unir G1, G2, G3… en un solo turno tipo con grupos.
 */
export function desfaseEntre(base: DiaPatron[], otro: DiaPatron[]): number | null {
  const n = base.length;
  if (otro.length !== n || n === 0) return null;
  const kb = base.map(claveDia);
  const ko = otro.map(claveDia);
  for (let s = 0; s < n; s++) if (ko.every((k, i) => k === kb[(i + s) % n])) return s;
  return null;
}

/** Une varios rotativos (G1, G2, G3… en orden) si el grupo g va (g-1)·d días adelante, con d fijo. */
export function unirGrupos(ciclos: DiaPatron[][]): { desfase: number } | { error: string } {
  if (ciclos.length < 2) return { error: 'Se necesitan al menos dos grupos' };
  const n = ciclos[0].length;
  const d = desfaseEntre(ciclos[0], ciclos[1]);
  if (d === null) return { error: 'El grupo 2 no es la misma rotación del grupo 1' };
  for (let g = 2; g < ciclos.length; g++) {
    const s = desfaseEntre(ciclos[0], ciclos[g]);
    if (s === null) return { error: `El grupo ${g + 1} no es la misma rotación del grupo 1` };
    if (s !== (g * d) % n) return { error: `El grupo ${g + 1} no va ${d} días después del grupo ${g}` };
  }
  return { desfase: d };
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Revisa un ciclo antes de guardarlo; devuelve los problemas en lenguaje simple (vacío = bien). */
export function revisarDias(dias: DiaPatron[], semanal: boolean): string[] {
  const errores: string[] = [];
  if (semanal && dias.length !== 7) errores.push('Un horario semanal tiene 7 días (lunes a domingo)');
  if (!semanal && (dias.length < 1 || dias.length > 62)) errores.push('El ciclo debe tener entre 1 y 62 días');
  dias.forEach((d, i) => {
    d.tramos.forEach((t) => {
      // Entrada = salida es un turno de 24 horas (igual que en la base).
      if (!HORA.test(t.inicio) || !HORA.test(t.fin)) errores.push(`Día ${i + 1}: escriba las horas como 06:00`);
    });
    const orden = d.tramos.map((t) => aMin(t.inicio)).sort((a, b) => a - b);
    for (let k = 1; k < d.tramos.length; k++) {
      const prev = d.tramos.find((t) => aMin(t.inicio) === orden[k - 1])!;
      const finPrev = aMin(prev.fin) <= aMin(prev.inicio) ? aMin(prev.fin) + MIN_DIA : aMin(prev.fin);
      if (orden[k] < finPrev) errores.push(`Día ${i + 1}: dos tramos se cruzan`);
    }
  });
  if (dias.every((d) => d.tramos.length === 0)) errores.push('El turno tipo no tiene ningún día trabajado');
  return [...new Set(errores)];
}

/** Horas trabajadas en un día del patrón. */
export function horasDelDia(d: DiaPatron): number {
  return d.tramos.reduce((s, t) => s + ((aMin(t.fin) - aMin(t.inicio) + MIN_DIA) % MIN_DIA || MIN_DIA) / 60, 0);
}
