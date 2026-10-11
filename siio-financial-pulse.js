// Monthly pulse built from account balances per month. It only needs
// (year, month, account, level, previous_balance, final_balance), the same shape
// the manual workbook, the daily file or an ERP export provide, so the source can
// change without touching the Torre de Control.

const GROUPS = Object.freeze([
  { key: 'ingresos', label: 'Ingresos operacionales', kind: 'ingreso', accounts: ['41'] },
  { key: 'materiales', label: 'Materiales y equipos', kind: 'costo', accounts: ['71'] },
  { key: 'mano_obra', label: 'Mano de obra directa', kind: 'costo', accounts: ['72'] },
  { key: 'costos_indirectos', label: 'Costos indirectos', kind: 'costo', accounts: ['73'] },
  { key: 'administracion', label: 'Gastos de administración', kind: 'gasto', accounts: ['51'] },
  { key: 'ventas', label: 'Gastos de ventas', kind: 'gasto', accounts: ['52'] },
  { key: 'otros_ingresos', label: 'Ingresos no operacionales', kind: 'no_operacional_ingreso', accounts: ['42'] },
  { key: 'gastos_no_operacionales', label: 'Gastos no operacionales', kind: 'no_operacional_gasto', accounts: ['53'] },
  { key: 'impuesto_renta', label: 'Impuesto de renta', kind: 'impuesto', accounts: ['54'] },
]);

// Level-2 accounts outside the map still count, so totals reconcile with the balance.
const FALLBACK_GROUPS = Object.freeze({
  4: { key: 'otros_ingresos_operacionales', label: 'Otros ingresos (sin clasificar)', kind: 'ingreso' },
  5: { key: 'otros_gastos', label: 'Otros gastos (sin clasificar)', kind: 'gasto' },
  6: { key: 'otros_costos', label: 'Otros costos (sin clasificar)', kind: 'costo' },
  7: { key: 'otros_costos', label: 'Otros costos (sin clasificar)', kind: 'costo' },
});

const PERIOD_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])-01$/;

function pulseError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.code = 'INVALID_FINANCIAL_PULSE';
  return error;
}

function amount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function groupForAccount(account) {
  const mapped = GROUPS.find(group => group.accounts.includes(account));
  if (mapped) return mapped;
  return FALLBACK_GROUPS[Number(account[0])] || null;
}

// Monthly sheets close with the month's revenue provision and open the next month without it,
// so previous_balance(N) differs from final_balance(N-1). The month's figure is therefore the
// difference between consecutive closing balances: it telescopes to the year-to-date total of the
// latest sheet. The opening gap is kept apart as the provision carried between months.
export function buildFinancialPulse(lines, { periodMonth, monthsWithoutProvision = [] }) {
  if (!PERIOD_PATTERN.test(String(periodMonth || ''))) throw pulseError('El periodo del pulso debe ser el primer día de un mes.');
  const [year, month] = periodMonth.split('-').map(Number);
  const groups = new Map(GROUPS.map(group => [group.key, { key: group.key, label: group.label, kind: group.kind }]));
  const closings = new Map();
  for (const line of lines || []) {
    const account = String(line.account || '');
    if (Number(line.level) !== 2 || !/^[4-7]\d$/.test(account)) continue;
    if (Number(line.month) > month || (Number(line.year) !== year && Number(line.year) !== year - 1)) continue;
    const group = groupForAccount(account);
    if (!group) continue;
    if (!groups.has(group.key)) groups.set(group.key, { key: group.key, label: group.label, kind: group.kind });
    // Income accounts carry credit (negative) balances; flip them so every figure reads as a positive amount.
    const sign = account[0] === '4' ? -1 : 1;
    const key = `${line.year}|${account}`;
    if (!closings.has(key)) closings.set(key, { year: Number(line.year), groupKey: group.key, sign, byMonth: new Map() });
    closings.get(key).byMonth.set(Number(line.month), { previous: amount(line.previous_balance), final: amount(line.final_balance) });
  }
  const buckets = new Map();
  const bucketFor = (bucketYear, bucketMonth) => {
    const key = `${bucketYear}-${bucketMonth}`;
    if (!buckets.has(key)) buckets.set(key, { year: bucketYear, month: bucketMonth, values: {}, carried: {} });
    return buckets.get(key);
  };
  for (const series of closings.values()) {
    for (const [lineMonth, balance] of series.byMonth) {
      const prior = series.byMonth.get(lineMonth - 1);
      const movement = prior ? balance.final - prior.final : balance.final - balance.previous;
      const bucket = bucketFor(series.year, lineMonth);
      bucket.values[series.groupKey] = (bucket.values[series.groupKey] || 0) + series.sign * movement;
      if (prior) bucket.carried[series.groupKey] = (bucket.carried[series.groupKey] || 0) + series.sign * (prior.final - balance.previous);
    }
  }
  const sum = (values, kind) => [...groups.values()].filter(group => group.kind === kind).reduce((total, group) => total + (values[group.key] || 0), 0);
  const months = [...buckets.values()]
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .map(bucket => {
      const income = sum(bucket.values, 'ingreso');
      const costs = sum(bucket.values, 'costo');
      const expenses = sum(bucket.values, 'gasto');
      const operatingIncome = income - costs - expenses;
      const nonOperating = sum(bucket.values, 'no_operacional_ingreso') - sum(bucket.values, 'no_operacional_gasto');
      const values = Object.fromEntries(Object.entries(bucket.values).map(([key, value]) => [key, round(value)]));
      const carried = Object.fromEntries(Object.entries(bucket.carried).filter(([, value]) => Math.abs(value) >= 1).map(([key, value]) => [key, round(value)]));
      return {
        year: bucket.year,
        month: bucket.month,
        values,
        carried_from_previous_month: carried,
        provision_declared: !monthsWithoutProvision.some(item => item.year === bucket.year && item.month === bucket.month),
        totals: {
          ingresos: round(income),
          costos: round(costs),
          gastos_operacionales: round(expenses),
          utilidad_operacional: round(operatingIncome),
          margen_operacional: income ? operatingIncome / income : null,
          resultado_no_operacional: round(nonOperating),
        },
      };
    });
  return { period_month: periodMonth, year, month, groups: [...groups.values()], months };
}

function requireResult(result) {
  if (result?.error) throw result.error;
  return result?.data;
}

// Same eligibility as siio_financial_metrics_current: the published cut wins, a validated daily
// cut feeds the Torre until the month closes.
export async function loadFinancialPulse(database, requestedPeriod) {
  if (requestedPeriod && !PERIOD_PATTERN.test(String(requestedPeriod))) throw pulseError('El periodo del pulso debe ser el primer día de un mes.');
  let query = database.from('siio_financial_imports')
    .select('id,file_name,period_month,cutoff_date,import_type,status,published_at,validated_at,uploaded_at')
    .or('status.eq.publicado,and(status.eq.validado,import_type.eq.parcial_diario)');
  if (requestedPeriod) query = query.eq('period_month', requestedPeriod);
  const candidates = requireResult(await query.order('period_month', { ascending: false }).limit(20)) || [];
  const latestPeriod = candidates[0]?.period_month || null;
  const active = candidates
    .filter(item => item.period_month === latestPeriod)
    .sort((a, b) => (a.status === 'publicado' ? 0 : 1) - (b.status === 'publicado' ? 0 : 1)
      || String(b.cutoff_date).localeCompare(String(a.cutoff_date))
      || String(b.uploaded_at).localeCompare(String(a.uploaded_at)))[0];
  if (!active) return null;
  const provisionCheck = requireResult(await database.from('siio_financial_validations')
    .select('ok,obtained')
    .eq('import_id', active.id)
    .eq('rule', 'V9_PROVISION_DECLARADA')) || [];
  // V9 lists the monthly sheets ("1 26") whose provision cell is empty.
  const monthsWithoutProvision = provisionCheck.filter(item => !item.ok)
    .flatMap(item => String(item.obtained || '').split(','))
    .map(name => /^(1[0-2]|[1-9]) (\d{2})$/.exec(name.trim()))
    .filter(Boolean)
    .map(match => ({ month: Number(match[1]), year: 2000 + Number(match[2]) }));
  const lines = requireResult(await database.from('siio_financial_balance_lines')
    .select('year,month,account,level,previous_balance,final_balance')
    .eq('import_id', active.id)
    .eq('level', 2)
    .in('account_class', [4, 5, 6, 7])) || [];
  return {
    source: {
      import_id: active.id,
      file_name: active.file_name,
      period_month: active.period_month,
      cutoff_date: active.cutoff_date,
      import_type: active.import_type,
      status: active.status,
      basis: 'balance_de_cuentas',
    },
    ...buildFinancialPulse(lines, { periodMonth: active.period_month, monthsWithoutProvision }),
  };
}

export const SIIO_FINANCIAL_PULSE_GROUPS = GROUPS;
