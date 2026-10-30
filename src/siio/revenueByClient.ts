// AGT-001 / Vig-IA Gerencia: provisión de ingresos por tercero de la Torre, leída de la hoja
// "Ingresos" del archivo contable del mes (migración 142).
//
// No es la facturación total de la empresa: es lo que Contabilidad provisiona al cierre y detalla
// por tercero. Los contratos ya facturados no aparecen en esa hoja. El archivo también puede dejar
// una línea por fuera de su propio total; esas filas se muestran, pero no suman.

export type SiioRevenueLine = {
  period_month: string;
  line_type: 'servicio' | 'ajuste';
  client_label: string;
  service_month?: string | null;
  amount: number | string;
  excluded_from_total?: boolean;
  source_sheet?: string;
  source_row?: number;
};

export type RevenueRow = {
  label: string;
  amount: number;
  share: number | null;
  excluded: boolean;
  serviceMonth: string | null;
};

export type RevenueByClient = {
  period: string;
  services: RevenueRow[];
  adjustments: RevenueRow[];
  servicesTotal: number;
  adjustmentsTotal: number;
  excludedTotal: number;
  total: number;
  excluded: RevenueRow[];
  readings: string[];
};

const amountOf = (line: SiioRevenueLine) => Number(line.amount || 0);
const share = (value: number, total: number) => (total > 0 ? value / total : null);
const millions = (value: number) => `$${Math.round(Math.abs(value) / 1e6).toLocaleString('es-CO')} M`;
const percent = (value: number) => `${Math.round(value * 100)} %`;

export function revenuePeriods(lines: SiioRevenueLine[]) {
  return [...new Set(lines.map(line => line.period_month))].sort();
}

export function deriveRevenueByClient(lines: SiioRevenueLine[], period?: string | null): RevenueByClient | null {
  const periods = revenuePeriods(lines);
  if (!periods.length) return null;
  const selected = period && periods.includes(period) ? period : periods[periods.length - 1];
  const rows = lines.filter(line => line.period_month === selected);
  if (!rows.length) return null;
  const total = rows.reduce((sum, line) => (line.excluded_from_total ? sum : sum + amountOf(line)), 0);
  const toRow = (line: SiioRevenueLine): RevenueRow => ({
    label: line.client_label,
    amount: amountOf(line),
    share: line.excluded_from_total ? null : share(amountOf(line), total),
    excluded: Boolean(line.excluded_from_total),
    serviceMonth: line.service_month || null,
  });
  const byAmount = (left: RevenueRow, right: RevenueRow) => right.amount - left.amount;
  const services = rows.filter(line => line.line_type === 'servicio').map(toRow).sort(byAmount);
  const adjustments = rows.filter(line => line.line_type === 'ajuste').map(toRow).sort(byAmount);
  const excluded = [...services, ...adjustments].filter(row => row.excluded);
  const summary: RevenueByClient = {
    period: selected,
    services,
    adjustments,
    servicesTotal: services.reduce((sum, row) => (row.excluded ? sum : sum + row.amount), 0),
    adjustmentsTotal: adjustments.reduce((sum, row) => (row.excluded ? sum : sum + row.amount), 0),
    excludedTotal: excluded.reduce((sum, row) => sum + row.amount, 0),
    total,
    excluded,
    readings: [],
  };
  summary.readings = revenueReadings(summary);
  return summary;
}

export function revenueReadings(summary: RevenueByClient) {
  const readings: string[] = [];
  const counted = summary.services.filter(row => !row.excluded);
  const first = counted[0];
  if (first && first.share !== null) readings.push(`${first.label} concentra el ${percent(first.share)} de la provisión del mes (${millions(first.amount)}).`);
  if (counted.length >= 3) {
    const topThree = counted.slice(0, 3).reduce((sum, row) => sum + row.amount, 0);
    readings.push(`Los tres primeros terceros suman ${percent(topThree / summary.total)} del total; son ${counted.length} en el mes.`);
  }
  if (summary.adjustments.length) readings.push(`${summary.adjustments.length} ajuste(s) de meses anteriores por ${millions(summary.adjustmentsTotal)}.`);
  for (const row of summary.excluded) readings.push(`${row.label} (${millions(row.amount)}) está en la hoja pero el archivo la deja fuera del total; Contabilidad no dice por qué.`);
  return readings;
}
