export type FinancialPulseTotals = {
  ingresos: number;
  costos: number;
  gastos_operacionales: number;
  utilidad_operacional: number;
  margen_operacional: number | null;
  resultado_no_operacional: number;
};

export type FinancialPulseMonth = { year: number; month: number; values: Record<string, number>; carried_from_previous_month: Record<string, number>; provision_declared: boolean; balance_difference?: number | null; totals: FinancialPulseTotals };
export type FinancialPulseGroup = { key: string; label: string; kind: string };
export type FinancialPulse = {
  source: { import_id: string; file_name: string; period_month: string; cutoff_date: string; import_type: string; status: string; basis: string };
  period_month: string;
  year: number;
  month: number;
  groups: FinancialPulseGroup[];
  months: FinancialPulseMonth[];
};

export type PulseBreakdownRow = {
  key: string;
  label: string;
  kind: string;
  current: number;
  sameMonthLastYear: number | null;
  change: number | null;
  yearToDate: number;
  shareOfIncome: number | null;
};

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const shortMonth = (month: number) => MONTHS[month - 1] || '';
export const longMonth = (month: number) => MONTHS_LONG[month - 1] || '';

export function pulseMonth(pulse: FinancialPulse, year: number, month: number) {
  return pulse.months.find(item => item.year === year && item.month === month) || null;
}

export function relativeChange(current: number | null | undefined, previous: number | null | undefined) {
  if (current === null || current === undefined || previous === null || previous === undefined || !previous) return null;
  return (current - previous) / Math.abs(previous);
}

export function pulseBreakdown(pulse: FinancialPulse): PulseBreakdownRow[] {
  const current = pulseMonth(pulse, pulse.year, pulse.month);
  const lastYear = pulseMonth(pulse, pulse.year - 1, pulse.month);
  const yearMonths = pulse.months.filter(item => item.year === pulse.year);
  const income = current?.totals.ingresos || 0;
  return pulse.groups
    .map(group => {
      const value = current?.values[group.key] || 0;
      const previous = lastYear ? lastYear.values[group.key] || 0 : null;
      return {
        key: group.key,
        label: group.label,
        kind: group.kind,
        current: value,
        sameMonthLastYear: previous,
        change: previous === null ? null : value - previous,
        yearToDate: yearMonths.reduce((total, item) => total + (item.values[group.key] || 0), 0),
        shareOfIncome: income && group.kind !== 'ingreso' ? value / income : null,
      };
    })
    .filter(row => row.current || row.sameMonthLastYear || row.yearToDate);
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const money = (value: number) => `$${Math.round(value / 1e6).toLocaleString('es-CO')} millones`;
const pesos = (value: number) => `$${Math.round(Math.abs(value)).toLocaleString('es-CO')}`;
const pct = (value: number) => `${(value * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })}%`;

// Deterministic reading: each sentence states the figures it relies on, nothing is inferred beyond them.
export function pulseReadings(pulse: FinancialPulse): string[] {
  const readings: string[] = [];
  const current = pulseMonth(pulse, pulse.year, pulse.month);
  if (!current) return readings;
  const lastYear = pulseMonth(pulse, pulse.year - 1, pulse.month);
  const yearMonths = pulse.months.filter(item => item.year === pulse.year);
  const monthLabel = `${longMonth(pulse.month)} de ${pulse.year}`;

  if (lastYear) {
    const change = relativeChange(current.totals.ingresos, lastYear.totals.ingresos);
    if (change !== null) readings.push(`Los ingresos de ${monthLabel} fueron ${money(current.totals.ingresos)}, ${change >= 0 ? 'un' : 'una caída del'} ${pct(Math.abs(change))} ${change >= 0 ? 'más que' : 'frente a'} ${longMonth(pulse.month)} de ${pulse.year - 1}.`);
  }

  const withoutProvision = yearMonths.filter(item => !item.provision_declared);
  for (const item of withoutProvision) {
    const next = yearMonths.find(candidate => candidate.month === item.month + 1);
    readings.push(next
      ? `${capitalize(longMonth(item.month))} no tiene provisión de ingresos declarada: su ingreso (${money(item.totals.ingresos)}) puede verse más bajo y el de ${longMonth(next.month)} (${money(next.totals.ingresos)}) más alto de lo real. Juntos promedian ${money((item.totals.ingresos + next.totals.ingresos) / 2)} al mes.`
      : `${capitalize(longMonth(item.month))} no tiene provisión de ingresos declarada: su ingreso (${money(item.totals.ingresos)}) puede estar subestimado.`);
  }

  // Months whose balance does not add up in the Excel are published marked, not hidden.
  for (const item of pulse.months.filter(month => month.balance_difference)) {
    readings.push(`El balance de ${longMonth(item.month)} de ${item.year} en el Excel no cuadra por ${pesos(item.balance_difference || 0)}: sus cifras pueden no ser exactas hasta que Contabilidad lo corrija.`);
  }

  let biggestJump: { from: FinancialPulseMonth; to: FinancialPulseMonth; change: number } | null = null;
  for (let index = 1; index < yearMonths.length; index += 1) {
    // A jump next to a month without provision is an accounting timing effect, not a business change.
    // The month after a missing provision absorbs it, so it is distorted too.
    const distorted = (position: number) => position >= 0 && (!yearMonths[position].provision_declared || (position > 0 && !yearMonths[position - 1].provision_declared));
    if (distorted(index - 1) || distorted(index)) continue;
    const change = relativeChange(yearMonths[index].totals.ingresos, yearMonths[index - 1].totals.ingresos);
    if (change !== null && Math.abs(change) >= 0.15 && (!biggestJump || Math.abs(change) > Math.abs(biggestJump.change))) biggestJump = { from: yearMonths[index - 1], to: yearMonths[index], change };
  }
  if (biggestJump) readings.push(`En ${longMonth(biggestJump.to.month)} los ingresos ${biggestJump.change > 0 ? 'subieron' : 'bajaron'} de ${money(biggestJump.from.totals.ingresos)} a ${money(biggestJump.to.totals.ingresos)} (${biggestJump.change > 0 ? '+' : '−'}${pct(Math.abs(biggestJump.change))}).`);

  const losingMonths = yearMonths.filter(item => item.totals.utilidad_operacional < 0);
  if (losingMonths.length) {
    const caveat = losingMonths.some(item => !item.provision_declared) ? ', en parte por la falta de provisión de ingresos' : '';
    readings.push(`${capitalize(losingMonths.map(item => longMonth(item.month)).join(', '))} ${losingMonths.length === 1 ? 'cerró' : 'cerraron'} con pérdida operativa según el balance de cuentas${caveat}.`);
  }

  if (current.totals.ingresos && lastYear?.totals.ingresos) {
    const shareNow = current.totals.costos / current.totals.ingresos;
    const shareBefore = lastYear.totals.costos / lastYear.totals.ingresos;
    readings.push(`Los costos representan ${pct(shareNow)} de los ingresos del mes, frente a ${pct(shareBefore)} en ${longMonth(pulse.month)} de ${pulse.year - 1}.`);
  }

  const breakdown = pulseBreakdown(pulse).filter(row => row.kind !== 'ingreso' && row.change !== null);
  const biggestIncrease = breakdown.sort((a, b) => (b.change || 0) - (a.change || 0))[0];
  if (biggestIncrease && (biggestIncrease.change || 0) > 0) readings.push(`El rubro que más creció frente a ${longMonth(pulse.month)} de ${pulse.year - 1} es ${biggestIncrease.label.toLowerCase()}: +${money(biggestIncrease.change || 0)}.`);

  const nonOperating = yearMonths.map(item => item.values.gastos_no_operacionales || 0);
  if (nonOperating.length >= 3 && nonOperating[nonOperating.length - 1] > Math.max(...nonOperating.slice(0, -1))) {
    readings.push(`Los gastos no operacionales de ${longMonth(pulse.month)} (${money(nonOperating[nonOperating.length - 1])}) son los más altos del año.`);
  }
  return readings;
}
