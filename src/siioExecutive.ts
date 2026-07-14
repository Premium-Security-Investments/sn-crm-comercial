export type SiioFinancialMetric = {
  period_month: string;
  category?: string;
  concept: string;
  value_current?: number | null;
  value_comparison?: number | null;
  variation_abs?: number | null;
  variation_pct?: number | null;
  source_id?: string | null;
  validated_by?: string | null;
  notes?: string | null;
};

export type SiioPayrollAggregate = {
  period_month: string;
  area?: string | null;
  total_people?: number | null;
  total_accrued?: number | null;
  total_deductions?: number | null;
  net_total?: number | null;
  variation_abs?: number | null;
  alert?: string | null;
  source_id?: string | null;
  visibility_level?: string | null;
};

export type SiioExecutiveSource = {
  id: string;
  name: string;
  status?: string | null;
  trust_level?: string | null;
  last_reviewed_at?: string | null;
  next_review_at?: string | null;
  update_frequency?: string | null;
  url?: string | null;
};

export type SiioExecutiveInput = {
  financialMetrics: SiioFinancialMetric[];
  payrollAggregates: SiioPayrollAggregate[];
  sources: SiioExecutiveSource[];
};

function latestPeriod(rows: Array<{ period_month?: string | null }>): string | null {
  return rows.reduce<string | null>((latest, row) => {
    const period = row.period_month || null;
    return period && (!latest || period > latest) ? period : latest;
  }, null);
}

function numeric(value: number | null | undefined): number {
  return Number(value || 0);
}

export function deriveSiioExecutiveSnapshot(input: SiioExecutiveInput) {
  const financialPeriod = latestPeriod(input.financialMetrics);
  const payrollPeriod = latestPeriod(input.payrollAggregates);
  const financialRows = input.financialMetrics.filter(row => row.period_month === financialPeriod);
  const payrollRows = input.payrollAggregates
    .filter(row => row.period_month === payrollPeriod)
    .sort((a, b) => numeric(b.total_accrued) - numeric(a.total_accrued));
  const financialByConcept = Object.fromEntries(financialRows.map(row => [row.concept, row]));
  const payrollTotals = payrollRows.reduce((totals, row) => ({
    totalPeople: totals.totalPeople + numeric(row.total_people),
    totalAccrued: totals.totalAccrued + numeric(row.total_accrued),
    totalDeductions: totals.totalDeductions + numeric(row.total_deductions),
    netTotal: totals.netTotal + numeric(row.net_total),
    alerts: totals.alerts + (row.alert ? 1 : 0),
  }), { totalPeople: 0, totalAccrued: 0, totalDeductions: 0, netTotal: 0, alerts: 0 });
  const financialValidationStatus = !financialRows.length
    ? 'sin_datos'
    : financialRows.every(row => Boolean(row.validated_by)) ? 'validado' : 'pendiente_validacion';
  const sourceFreshness = [...input.sources].sort((a, b) =>
    String(b.last_reviewed_at || '').localeCompare(String(a.last_reviewed_at || ''))
  );
  return {
    financialPeriod,
    payrollPeriod,
    financialRows,
    financialByConcept,
    payrollRows,
    payrollTotals,
    financialValidationStatus,
    sourceFreshness,
  };
}
