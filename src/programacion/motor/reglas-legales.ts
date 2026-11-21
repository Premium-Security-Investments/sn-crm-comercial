// Reglas legales nacionales con vigencia (tabla programacion.reglas_legales) y su comparación con los
// parámetros de una ciudad (programacion.parametros_nomina). Solo compara y avisa; no cambia cálculos.

export type TemaRegla =
  | 'jornada_semanal' | 'jornada_diaria_ordinaria' | 'inicio_nocturno' | 'fin_nocturno'
  | 'recargo_descanso_obligatorio' | 'habitualidad_dias_mes'
  | 'extras_max_dia' | 'extras_max_semana'
  | 'vigilancia_acuerdo_max_dia' | 'vigilancia_acuerdo_max_semana';

export interface ReglaLegal {
  tema: TemaRegla;
  vigente_desde: string;              // 'AAAA-MM-DD'
  valor: number | string;             // numeric llega como texto desde la base
  unidad: 'horas' | 'hora_del_dia' | 'fraccion' | 'dias';
  fuente: string;
  estado: 'norma' | 'por_confirmar';
  nota: string | null;
}

export interface ParametrosCiudad {
  vigente_desde: string;
  jornada_semanal: number | string;
  jornada_diaria_macro: number | string | null;
  fin_diurno: string;                 // 'HH:MM[:SS]'
  divisor_valor_hora: number | string;
  factores: Record<string, number>;
}

export const NOMBRE_TEMA: Record<TemaRegla, string> = {
  jornada_semanal: 'Jornada ordinaria semanal',
  jornada_diaria_ordinaria: 'Jornada ordinaria diaria máxima',
  inicio_nocturno: 'Inicio del trabajo nocturno',
  fin_nocturno: 'Fin del trabajo nocturno',
  recargo_descanso_obligatorio: 'Recargo por trabajar domingo o festivo',
  habitualidad_dias_mes: 'Días de descanso trabajados para ser habitual (mes calendario)',
  extras_max_dia: 'Horas extra máximas por día (régimen general)',
  extras_max_semana: 'Horas extra máximas por semana (régimen general)',
  vigilancia_acuerdo_max_dia: 'Vigilancia con acuerdo escrito: horas máximas por día',
  vigilancia_acuerdo_max_semana: 'Vigilancia con acuerdo escrito: horas máximas por semana',
};

/** Regla de un tema que rige en una fecha (la de vigente_desde más reciente que no la supere). */
export function reglaVigente(reglas: ReglaLegal[], tema: TemaRegla, fecha: string): ReglaLegal | null {
  let mejor: ReglaLegal | null = null;
  for (const r of reglas) {
    if (r.tema !== tema || r.vigente_desde > fecha) continue;
    if (!mejor || r.vigente_desde > mejor.vigente_desde) mejor = r;
  }
  return mejor;
}

/** Próximo cambio de un tema después de una fecha (p. ej. el recargo del 100 % el 1-jul-2027). */
export function proximoCambio(reglas: ReglaLegal[], tema: TemaRegla, fecha: string): ReglaLegal | null {
  let prox: ReglaLegal | null = null;
  for (const r of reglas) {
    if (r.tema !== tema || r.vigente_desde <= fecha) continue;
    if (!prox || r.vigente_desde < prox.vigente_desde) prox = r;
  }
  return prox;
}

export interface Comparacion {
  clave: string;
  que: string;
  legal: number | null;
  ciudad: number | null;
  coincide: boolean | null;           // null = no hay con qué comparar
  fuente: string;
  estado: 'norma' | 'por_confirmar';
  explicacion: string;
}

const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v));
const casi = (a: number, b: number) => Math.abs(a - b) < 0.005;
const hora = (t: string) => Number(t.slice(0, 2)) + Number(t.slice(3, 5)) / 60;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** '2026-07-15' → '15-jul-2026'. */
export const fechaCorta = (f: string) => `${Number(f.slice(8, 10))}-${MESES[Number(f.slice(5, 7)) - 1]}-${f.slice(0, 4)}`;

/** Compara los parámetros de una ciudad con las reglas legales vigentes en `fecha`. */
export function compararConLey(reglas: ReglaLegal[], par: ParametrosCiudad, fecha: string): Comparacion[] {
  const out: Comparacion[] = [];
  const jornada = reglaVigente(reglas, 'jornada_semanal', fecha);
  const nocturno = reglaVigente(reglas, 'inicio_nocturno', fecha);
  const recargo = reglaVigente(reglas, 'recargo_descanso_obligatorio', fecha);
  const legalJornada = num(jornada?.valor);

  if (jornada) {
    const c = num(par.jornada_semanal);
    out.push({
      clave: 'jornada_formulas', que: 'Jornada semanal usada en los cálculos', legal: legalJornada, ciudad: c,
      coincide: c === null ? null : casi(c, legalJornada!), fuente: jornada.fuente, estado: jornada.estado,
      explicacion: `La ley fija ${legalJornada} h por semana desde el ${fechaCorta(jornada.vigente_desde)}.`,
    });
    const macro = num(par.jornada_diaria_macro);
    if (macro !== null) {
      out.push({
        clave: 'jornada_macro', que: 'Jornada semanal que usa la macro (jornada diaria × 6)', legal: legalJornada, ciudad: macro * 6,
        coincide: casi(macro * 6, legalJornada!), fuente: jornada.fuente, estado: jornada.estado,
        explicacion: `La macro reparte ${macro} h por día en 6 días.`,
      });
    }
  }
  if (nocturno) {
    const c = hora(par.fin_diurno);
    const l = num(nocturno.valor)!;
    out.push({
      clave: 'inicio_nocturno', que: 'Hora en que empieza el trabajo nocturno', legal: l, ciudad: c,
      coincide: casi(c, l), fuente: nocturno.fuente, estado: nocturno.estado,
      explicacion: `Desde el ${fechaCorta(nocturno.vigente_desde)} el trabajo nocturno empieza a las ${l}:00.`,
    });
  }
  if (recargo) {
    const l = num(recargo.valor)!;
    const f = par.factores ?? {};
    const conComp = f.dof_con_compensatorio ?? f.rdf;
    if (conComp !== undefined) {
      out.push({
        clave: 'recargo_dof', que: 'Recargo por domingo o festivo', legal: l, ciudad: Number(conComp),
        coincide: casi(Number(conComp), l), fuente: recargo.fuente, estado: recargo.estado,
        explicacion: `Desde el ${fechaCorta(recargo.vigente_desde)} el recargo es del ${Math.round(l * 100)} %.`,
      });
    }
    if (f.dof_sin_compensatorio !== undefined) {
      out.push({
        clave: 'recargo_dof_sin_compensatorio', que: 'Domingo o festivo sin compensatorio (hora + recargo)', legal: 1 + l, ciudad: Number(f.dof_sin_compensatorio),
        coincide: casi(Number(f.dof_sin_compensatorio), 1 + l), fuente: recargo.fuente, estado: 'por_confirmar',
        explicacion: 'Se espera el valor de la hora (1) más el recargo vigente. Que sea así lo confirma Nómina.',
      });
    }
    for (const [k, base, que] of [['hed_dof', 1.25, 'Extra diurna en domingo o festivo'], ['hen_dof', 1.75, 'Extra nocturna en domingo o festivo']] as const) {
      if (f[k] === undefined) continue;
      out.push({
        clave: k, que, legal: base + l, ciudad: Number(f[k]),
        coincide: casi(Number(f[k]), base + l), fuente: `${recargo.fuente}; CST art. 168`, estado: 'por_confirmar',
        explicacion: `Se espera la extra (${base}) más el recargo vigente (${l}). Que se sumen así lo confirma Nómina.`,
      });
    }
  }
  if (legalJornada !== null) {
    const d = num(par.divisor_valor_hora);
    const esperado = Math.round((legalJornada / 6) * 30);
    out.push({
      clave: 'divisor', que: 'Divisor del valor hora', legal: esperado, ciudad: d,
      coincide: d === null ? null : casi(d, esperado), fuente: 'Ninguna norma fija el divisor; es la cuenta jornada ÷ 6 × 30', estado: 'por_confirmar',
      explicacion: 'Referencia aritmética, no legal. El divisor lo aprueba Nómina; la ley prohíbe que la reducción de jornada baje el valor de la hora.',
    });
  }
  return out;
}

/** Regla de nómina que aplica a una ciudad en una fecha: la propia de la ciudad y, si no tiene, la del resto del país. */
export function parametrosAplicables<T extends { ciudad_id: string | null; vigente_desde: string }>(filas: T[], ciudad: string | null, fecha: string): T | null {
  const vigente = (c: string | null) => filas
    .filter((f) => f.ciudad_id === c && f.vigente_desde <= fecha)
    .sort((a, b) => (a.vigente_desde < b.vigente_desde ? 1 : -1))[0] ?? null;
  return (ciudad !== null ? vigente(ciudad) : null) ?? vigente(null);
}
