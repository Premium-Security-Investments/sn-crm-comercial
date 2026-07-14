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

export type SiioManagementInsight = {
  id: string;
  front: 'F5';
  tone: 'green' | 'amber' | 'red' | 'blue';
  priority: 'alta' | 'media' | 'informativa';
  title: string;
  finding: string;
  evidence: string;
  action: string;
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

function percent(value: number | null | undefined): string {
  return `${(numeric(value) * 100).toFixed(1)}%`;
}

function deriveManagementInsights(
  financialByConcept: Record<string, SiioFinancialMetric>,
  payrollTotals: { alerts: number },
  financialValidationStatus: string,
): SiioManagementInsight[] {
  const insights: SiioManagementInsight[] = [];
  const income = financialByConcept.INGRESOS;
  const costs = financialByConcept.COSTOS;
  const nonOperating = financialByConcept['NO OPERACIONAL'];

  if (financialValidationStatus === 'pendiente_validacion') {
    insights.push({
      id: 'financial-validation-pending', front: 'F5', tone: 'amber', priority: 'alta',
      title: 'Cifras financieras pendientes de validación',
      finding: 'El snapshot permite lectura gerencial, pero todavía no debe tratarse como cierre financiero aprobado.',
      evidence: 'Las métricas del último periodo no tienen responsable registrado en validated_by.',
      action: 'Solicitar validación del periodo y registrar al responsable financiero antes de usar Modo Junta.',
    });
  }
  if (income && costs && numeric(costs.variation_pct) > numeric(income.variation_pct)) {
    insights.push({
      id: 'cost-growth-pressure', front: 'F5', tone: 'amber', priority: 'alta',
      title: 'Los costos crecen más rápido que los ingresos',
      finding: 'El crecimiento comercial no se está convirtiendo íntegramente en expansión del margen.',
      evidence: `Costos ${percent(costs.variation_pct)} vs. ingresos ${percent(income.variation_pct)} frente al comparativo.`,
      action: 'Abrir el detalle de costos y asignar responsables a los rubros con mayor variación absoluta.',
    });
  }
  if (nonOperating && numeric(nonOperating.value_current) < 0 && numeric(nonOperating.variation_abs) < 0) {
    insights.push({
      id: 'non-operating-drag', front: 'F5', tone: 'red', priority: 'alta',
      title: 'El resultado no operacional deteriora la utilidad',
      finding: 'El componente no operacional es negativo y empeoró frente al periodo comparativo.',
      evidence: `Variación no operacional ${percent(nonOperating.variation_pct)}; cambio absoluto negativo registrado en la fuente.`,
      action: 'Desagregar gastos e ingresos no operacionales y definir una explicación ejecutiva del deterioro.',
    });
  }
  if (payrollTotals.alerts > 0) {
    insights.push({
      id: 'payroll-source-alert', front: 'F5', tone: 'red', priority: 'alta',
      title: 'La nómina agregada contiene una diferencia de control',
      finding: 'Al menos un total del archivo fuente no coincide con devengado menos deducciones.',
      evidence: `${payrollTotals.alerts} área(s) con alerta automática en el último periodo de nómina.`,
      action: 'Validar el archivo de origen con Gestión Humana o Financiera antes de cerrar el dato.',
    });
  }
  return insights;
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
  const managementInsights = deriveManagementInsights(financialByConcept, payrollTotals, financialValidationStatus);
  return {
    financialPeriod,
    payrollPeriod,
    financialRows,
    financialByConcept,
    payrollRows,
    payrollTotals,
    financialValidationStatus,
    sourceFreshness,
    managementInsights,
  };
}
