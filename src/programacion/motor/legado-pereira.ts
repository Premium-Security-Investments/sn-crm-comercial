// Réplica fiel del cálculo de horas del Excel de programación de Pereira
// (macro VBA `horas_totales` + fórmulas de la columna AI de la hoja NOMINA).
//
// Propósito: prueba de aceptación. La plataforma debe reproducir exactamente
// lo que hoy liquida el Excel antes de cambiar cualquier regla. Por eso aquí
// se copian también sus rarezas (redondeos de VBA, reglas de sábado, límite
// del día 23, etc.). Las reglas nuevas viven en otro módulo; este no se "arregla".
//
// Unidades internas como en la macro: centésimas de hora (24 h = 2400),
// pasos de 0,25 h (25 unidades).

export type Celda = number | string | null;

export interface DiaLegado {
  /** Fila "DIA SEMANA": L, M, MI, J, V, S, D o F ('' fuera del periodo). */
  diaSemana: string;
  /** Fila "DIA MES": 1..31, o null/'' fuera del periodo. */
  diaMes: number | null;
  /** Filas HI/HF x5 (10 celdas): fracción de día (0,25 = 06:00) o letra de novedad. */
  tramos: Celda[];
}

export interface BloqueLegado {
  /** 33 columnas B..AH, en orden. */
  dias: DiaLegado[];
  /** Columna A de la fila Pl+8: 24 = método de dominicales anterior a 07-2018. */
  bandera24: boolean;
}

export interface ParametrosLegado {
  /** Celda NOMINA!AI1. Pereira: 43/6. */
  jornadaDiariaFormula: number;
  /** Constante VBA horas_laborales. Pereira: 48/6. */
  jornadaDiariaMacro: number;
  inicioDiurno: number; // 6
  finDiurno: number; // 19
  diaFinalCorte: number; // 23
}

export const PARAMETROS_PEREIRA_2026_08: ParametrosLegado = {
  jornadaDiariaFormula: 43 / 6,
  jornadaDiariaMacro: 48 / 6,
  inicioDiurno: 6,
  finDiurno: 19,
  diaFinalCorte: 23,
};

export interface ResultadoLegado {
  /** Filas por día (33 columnas B..AH) tal como las deja la macro. */
  filas: {
    horasT: number[]; // fila 22
    hed: number[]; // 24
    hen: number[]; // 25
    recargoNocturno: number[]; // 26
    horasFestivas: number[]; // 27
    hedDoF: number[]; // 30
    henDoF: number[]; // 31
  };
  /** Totales de la columna AI / AJ. */
  totales: {
    diasHabiles: number; // AI8
    diasLaborados: number; // AJ8
    horasALaborar: number; // AI10
    domingosTrabajados: number; // AI12
    horasFestivasPrimeras8: number; // AI13
    horasOrdinarias: number; // AI22
    saldoExtras: number; // AI23
    hed: number; // AI24
    hen: number; // AI25
    recargoNocturno: number; // AI26
    horasFestivas: number; // AI27
    dofSinCompensatorio: number; // AI28
    dofConCompensatorio: number; // AI29
    hedDoF: number; // AI30
    henDoF: number; // AI31
    totalNovedades: number; // AI32
    incapacidades: number; // AI33
    permisosNoRemunerados: number; // AI34
    permisosRemunerados: number; // AI35
    ausentismos: number; // AI36
    vacaciones: number; // AI37
    sanciones: number; // AI38
  };
}

export class ErrorCeldaLegado extends Error {
  readonly columna: number;
  readonly fila: number;
  readonly valor: Celda;
  constructor(columna: number, fila: number, valor: Celda) {
    super(`Valor no reconocido en día ${columna + 1}, fila de horario ${fila + 1}: ${JSON.stringify(valor)}`);
    this.columna = columna;
    this.fila = fila;
    this.valor = valor;
  }
}

const LETRAS_NOVEDAD = new Set(['R', 'N', 'I', 'A', 'D', 'PR', 'PN', 'V', 'S', 'T']);
const LETRAS_SIN_DOMINGO = new Set(['I', 'A', 'D', 'PR', 'PN', 'V', 'S']);
const PASO = 25;
const FACTOR = 100;
const MEDIANOCHE = 2400;

/** Asignación a Integer en VBA: redondeo al par más cercano. */
function cint(x: number): number {
  const r = Math.round(x);
  if (Math.abs(x - Math.trunc(x)) === 0.5) {
    const f = Math.floor(x);
    return f % 2 === 0 ? f : f + 1;
  }
  return r;
}

/** Celda * 2400 como lo evalúa VBA: vacío = 0, texto = error. */
function aUnidades(v: Celda, col: number, fila: number): number {
  if (v === null) return 0;
  if (typeof v === 'number') return v * 2400;
  throw new ErrorCeldaLegado(col, fila, v);
}

function esNumerico(v: Celda | undefined): boolean {
  // IsNumeric de VBA: vacío cuenta como numérico; texto vacío no.
  if (v === null || v === undefined) return true;
  if (typeof v === 'number') return true;
  return v.trim() !== '' && !Number.isNaN(Number(v));
}

function esLetra(v: Celda): v is string {
  return typeof v === 'string' && LETRAS_NOVEDAD.has(v);
}

function num(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Calcula un bloque (un guarda en un puesto) igual que Ctrl+W en el Excel.
 * `diaSemanaPrimerBloque`: la fórmula de días hábiles usa la fila 9 del
 * primer bloque de la hoja (referencia absoluta $B$9:$AH$9).
 */
export function calcularBloqueLegado(
  bloque: BloqueLegado,
  p: ParametrosLegado = PARAMETROS_PEREIRA_2026_08,
  diaSemanaPrimerBloque?: string[],
): ResultadoLegado {
  const N = bloque.dias.length; // 33 (B..AH)
  // Índice 0 = columna B. Columna "N" (AI) se modela como índice N.
  const ds = (c: number): string | number => (c < N ? bloque.dias[c].diaSemana ?? '' : 0);
  const dm = (c: number): number | null => (c < N ? bloque.dias[c].diaMes : null);
  const g = (c: number, k: number): Celda => (c < N && k >= 0 ? bloque.dias[c].tramos[k] ?? null : null);
  // Celdas "por encima" de los tramos (k = -1 es DIA MES, k = -2 es FECHA, etc.).
  const filaSobreTramos = (c: number, k: number): Celda => (k === -1 ? dm(c) : k >= 0 ? g(c, k) : null);

  const mk = () => new Array<number>(N + 1).fill(0);
  const r22 = mk(), r24 = mk(), r25 = mk(), r26 = mk(), r27 = mk(), r30 = mk(), r31 = mk();

  const jm = p.jornadaDiariaMacro * FACTOR;
  const iniD = p.inicioDiurno * FACTOR;
  const finD = p.finDiurno * FACTOR;

  let CDT = 0;
  let CCHF = 0; // Integer en VBA
  let horasFestivasAcum = 0;
  let domingosReales = 0;
  let curHol = 0, curHdot = 0, curHnot = 0, curBus = 0;
  let esUltimo = false;
  let ai12 = 0;
  let ai13 = 0;

  for (let c = 0; c <= N - 1; c++) {
    let primerTramo = true;
    let Ht = 0, RNOC = 0, Henf = 0, Hedf = 0;
    let holidayHours = 0, bus = 0, hdot = 0, hnot = 0, hft = 0;
    let flagHol = false;

    if (c < N - 1) {
      r27[c + 1] = 0; r30[c + 1] = 0; r31[c + 1] = 0; r22[c + 1] = 0;
    }
    if (dm(c) === p.diaFinalCorte) esUltimo = true;

    const hoy = ds(c);
    const manana = ds(c + 1);
    let hAnt = 0;
    for (let k = 0; k < 10; k += 2) {
      let flagDomingo = false;
      let hAct = 0;
      const v = g(c, k);
      if (esLetra(v)) {
        Ht = 0;
        primerTramo = false;
        hAnt = hAct;
        break;
      }
      const Hi = cint(aUnidades(v, c, k));
      const Hf = cint(aUnidades(g(c, k + 1), c, k + 1));
      const prevFin = primerTramo ? 9999 : aUnidadesSuave(filaSobreTramos(c, k - 1));

      if (Hi !== Hf) {
        for (let i = Hi + PASO; i <= Hf; i += PASO) {
          Ht += PASO;
          hAct += PASO;
          if (Hi === 0 && prevFin === MEDIANOCHE) {
            const extra = () => {
              if (hAnt + hAct > jm) {
                if (i > iniD && i <= finD) hdot += PASO; else hnot += PASO;
              }
            };
            const contarDomingo = () => {
              if (!flagDomingo && !esNumerico(g(c + 1, 0))) {
                domingosReales++;
                flagDomingo = true;
              }
            };
            if (hoy === 'S') {
              flagHol = true;
              holidayHours += PASO;
              contarDomingo();
              if (!esUltimo) {
                extra();
              } else if (holidayHours > jm) {
                if (i > iniD && i <= finD) hdot += PASO; else hnot += PASO;
              }
            } else if (hoy === 'D') {
              flagHol = true;
              if (manana !== 'F') {
                bus += PASO;
              } else {
                hft += PASO;
                if (Ht <= jm) horasFestivasAcum += PASO;
                extra();
              }
            } else if (hoy === 'F') {
              flagHol = true;
              if (manana === 'F') {
                hft += PASO;
                if (Ht <= jm) horasFestivasAcum += PASO;
                extra();
              } else if (manana === 'D') {
                contarDomingo();
                extra();
              } else {
                bus += PASO;
              }
            } else {
              if (manana === 'F') {
                flagHol = true;
                hft += PASO;
                holidayHours += PASO;
                if (Ht <= jm) horasFestivasAcum += PASO;
                extra();
              } else if (manana === 'D') {
                flagHol = true;
                holidayHours += PASO;
                contarDomingo();
                extra();
              } else {
                bus += PASO;
              }
            }
          }
          if (i <= iniD || i > finD) RNOC += PASO;
          if (Ht > jm && !flagHol) {
            if (i <= iniD || i > finD) Henf += PASO; else Hedf += PASO;
          }
        }
      }
      primerTramo = false;
      hAnt = hAct;
    }

    if (hoy === 'D' || hoy === 'F') {
      if (bloque.bandera24) {
        ai12 = 3;
      } else {
        if (hoy === 'D') {
          const t0 = g(c, 0);
          if ((typeof t0 === 'string' && LETRAS_SIN_DOMINGO.has(t0)) || Ht <= 0) {
            // no cuenta
          } else {
            CDT++;
          }
        }
        ai12 = CDT;
      }
      r27[c] = (Ht + curHol - bus) / FACTOR;
      if (!esUltimo) {
        r22[c + 1] = bus / FACTOR;
        r22[c] = 0;
      } else {
        r22[c] = bus / FACTOR;
      }
      if (bloque.bandera24) {
        ai13 = 0;
      } else {
        const hf = (Ht - bus - hft) / 100;
        if (hoy === 'F' && hf <= p.jornadaDiariaMacro) CCHF = cint(CCHF + hf);
        else if (hoy === 'F' && hf > p.jornadaDiariaMacro) CCHF = cint(CCHF + p.jornadaDiariaMacro);
        ai13 = CCHF;
      }
    } else {
      if (flagHol) {
        r22[c] = (Ht - holidayHours) / 100;
        if (!esUltimo) r27[c + 1] = (holidayHours + curHol) / FACTOR;
        else r27[c] = (holidayHours + curHol) / FACTOR;
      } else {
        r22[c] = (Ht + curBus) / FACTOR;
        r27[c] = 0;
      }
      if (!bloque.bandera24) {
        ai13 = CCHF + horasFestivasAcum / FACTOR;
        ai12 = CDT + domingosReales;
      }
    }

    r26[c] = RNOC / 100;

    if (hoy === 'D' || hoy === 'F') {
      if (flagHol) {
        if (!esUltimo) { r30[c + 1] = hdot / FACTOR; r31[c + 1] = hnot / FACTOR; }
        else { r30[c] = hdot / FACTOR; r31[c] = hnot / FACTOR; }
      }
      r30[c] = (Hedf + curHdot) / 100;
      r31[c] = (Henf + curHnot) / 100;
      r24[c] = 0;
      r25[c] = 0;
    } else {
      if (flagHol) {
        if (!esUltimo) {
          r30[c + 1] = hdot / FACTOR; r31[c + 1] = hnot / FACTOR;
          r30[c] = 0; r31[c] = 0;
        } else {
          r30[c] = hdot / FACTOR; r31[c] = hnot / FACTOR;
        }
      } else {
        r24[c] = Hedf / 100;
        r25[c] = Henf / 100;
        r30[c] = 0;
        r31[c] = 0;
      }
    }

    if (dm(c) === p.diaFinalCorte) break;

    curHol = num(r27[c + 1]) * FACTOR;
    curHdot = num(r30[c + 1]) * FACTOR;
    curHnot = num(r31[c + 1]) * FACTOR;
    curBus = num(r22[c + 1]) * FACTOR;
  }

  // ---- Fórmulas de la hoja (recalculadas antes del reparto) ----
  const sum = (a: number[]) => a.slice(0, N).reduce((s, x) => s + x, 0);
  const dsPrimer = diaSemanaPrimerBloque ?? bloque.dias.map((d) => d.diaSemana);
  const diasConFecha = bloque.dias.filter((d) => typeof d.diaMes === 'number').length;
  const domingosYFestivos = dsPrimer.slice(0, N).filter((x) => eqCI(x, 'D') || eqCI(x, 'F')).length;
  const contar = (letra: string) => {
    let n = 0;
    for (let c = 0; c < Math.min(31, N); c++) {
      const v = g(c, 0);
      const d = ds(c);
      if (typeof v === 'string' && eqCI(v, letra) && !eqCI(d, 'D') && !eqCI(d, 'F')) n++;
    }
    return n;
  };
  const ai33 = contar('I'), ai34 = contar('PN'), ai35 = contar('PR');
  const ai36 = contar('A') + contar('R') + contar('N') + contar('T');
  const ai37 = contar('V'), ai38 = contar('S');
  const ai8 = diasConFecha - domingosYFestivos - ai37 - ai38 - ai33 - ai35 - ai34 - ai36;
  const aj8 = diasConFecha - ai37 - ai38 - ai33 - ai35 - ai34 - ai36;
  const ai10 = ai8 * p.jornadaDiariaFormula;
  const ai22pre = sum(r22);
  const ai23pre = ai22pre - ai10;

  // ---- Reparto del saldo de extras hacia atrás ----
  let ET = cint(ai23pre * 100);
  for (let M = N - 1; M >= 0; M--) {
    let HEDO = 0, HENO = 0, DIUR = 0, NOCT = 0;
    const tomar = (FIN: number, INI: number) => {
      for (let Y = FIN - PASO; Y >= INI; Y -= PASO) {
        const toma = ET > 0 ? (ET > PASO ? PASO : ET) : 0;
        if (Y < iniD || Y >= finD) NOCT += toma; else DIUR += toma;
        ET -= toma;
        if (ET <= 0) break;
      }
    };
    if (ET > 0) {
      const dM = ds(M);
      if (dM !== 'D' && dM !== 'F' && r22[M] !== 0) {
        for (let X = 9; X >= 1; X -= 2) {
          if (!(ET > 0)) break;
          const hi = g(M, X - 1);
          if (esLetra(hi)) continue;
          const FIN = cint(aUnidades(g(M, X), M, X));
          const INI = cint(aUnidades(hi, M, X - 1));
          if (dM === 'S' && dm(M) === p.diaFinalCorte && INI === 0 && aUnidadesSuave(filaSobreTramos(M, X - 2)) === MEDIANOCHE) {
            // último día del corte en sábado: no se toma
          } else if (INI === 0) {
            const sig = ds(M + 1);
            if (sig !== 'D' && sig !== 'F' && sig !== '' && dM !== 'S') tomar(FIN, INI);
          } else {
            tomar(FIN, INI);
          }
        }
        HEDO += DIUR; HENO += NOCT;
        r24[M] = HEDO / 100;
        r25[M] = HENO / 100;
      } else if (dM === 'D' || (dM === 'F' && dm(M) !== p.diaFinalCorte)) {
        for (let X = 9; X >= 1; X -= 2) {
          if (!(ET > 0)) break;
          const hi = g(M, X - 1);
          if (esLetra(hi)) continue;
          const FIN = cint(aUnidades(g(M, X), M, X));
          const INI = cint(aUnidades(hi, M, X - 1));
          const prevFin = aUnidadesSuave(filaSobreTramos(M, X - 2));
          // La macro repite aquí la excepción del sábado; en un día D/F nunca aplica.
          if (INI === 0 && prevFin === MEDIANOCHE) {
            const sig = ds(M + 1);
            if (sig !== 'D' && sig !== 'F' && sig !== '') tomar(FIN, INI);
          }
        }
        HEDO += DIUR; HENO += NOCT;
        r24[M + 1] = num(r24[M + 1]) + HEDO / 100;
        r25[M + 1] = num(r25[M + 1]) + HENO / 100;
      } else {
        r24[M] = 0; r25[M] = 0;
      }
    } else {
      r24[M] = 0; r25[M] = 0;
    }
  }

  // ---- Totales finales (fórmulas AI) ----
  const ai22 = sum(r22);
  const ai23 = ai22 - ai10;
  const ai24 = sum(r24), ai25 = sum(r25), ai27 = sum(r27), ai30 = sum(r30), ai31 = sum(r31);
  const ai26 = sum(r26) - ai25 - ai31;
  const X = ai23 < 1 ? ai23 * -1 + ai13 : ai13;
  const ai29 = ai12 < 3 ? ai27 + ai22 - ai23 - ai10 - ai30 - ai31 - X + X : X;
  const ai28 = ai12 < 3 ? 0 : ai27 + ai22 - ai23 - ai10 - ai30 - ai31 - ai29;
  const ai32 = ai33 + ai34 + ai35 + ai36 + ai37 + ai38;

  const corta = (a: number[]) => a.slice(0, N);
  return {
    filas: {
      horasT: corta(r22), hed: corta(r24), hen: corta(r25), recargoNocturno: corta(r26),
      horasFestivas: corta(r27), hedDoF: corta(r30), henDoF: corta(r31),
    },
    totales: {
      diasHabiles: ai8, diasLaborados: aj8, horasALaborar: ai10,
      domingosTrabajados: ai12, horasFestivasPrimeras8: ai13,
      horasOrdinarias: ai22, saldoExtras: ai23, hed: ai24, hen: ai25,
      recargoNocturno: ai26, horasFestivas: ai27,
      dofSinCompensatorio: ai28, dofConCompensatorio: ai29,
      hedDoF: ai30, henDoF: ai31, totalNovedades: ai32,
      incapacidades: ai33, permisosNoRemunerados: ai34, permisosRemunerados: ai35,
      ausentismos: ai36, vacaciones: ai37, sanciones: ai38,
    },
  };
}

/** Celda * 2400 sin redondear (la macro guarda el fin del tramo anterior como Variant). Texto = 0. */
function aUnidadesSuave(v: Celda): number {
  return typeof v === 'number' ? v * 2400 : 0;
}

function eqCI(a: string | number, b: string): boolean {
  return typeof a === 'string' && a.toUpperCase() === b.toUpperCase();
}
