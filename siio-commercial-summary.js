// Commercial and public-tender summary for the Gerencia Torre de Control. Read-only and
// aggregated: the CRM stays the place to manage each opportunity. Opportunity values and
// sales goals are MONTHLY service values; tender values are the total process value.

const TENDER_SERVICE = 'licitacion_publica';
const STALE_DAYS = 30;
const DECISION_WINDOW_DAYS = 21;
const CLOSED_TENDER_STATUSES = new Set(['cerrada_no_go', 'adjudicada', 'no_adjudicada']);
const DAY_MS = 24 * 60 * 60 * 1000;

function amount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function monthKey(value) {
  return value ? String(value).slice(0, 7) : null;
}

function daysBetween(from, to) {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

// SECOP names sometimes carry markup leftovers (trailing asterisks) and Windows-1252
// dashes decoded as C1 control characters (U+0096 / U+0097).
export function cleanEntityName(value) {
  return String(value || '')
    .replace(/\*+/g, '')
    .replace(/\s*[\u0096\u0097]\s*/g, ' – ')
    .replace(/[\u0080-\u009f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildCommercialSummary({ opportunities = [], stages = [], goals = [], tenders = [], decisions = [], profiles = [] }, { now = new Date() } = {}) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const year = today.getUTCFullYear();
  const currentMonth = `${year}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`;
  const stageByCode = new Map(stages.map(stage => [stage.code, stage]));
  const ownerName = new Map(profiles.map(profile => [profile.id, profile.full_name]));
  const live = opportunities.filter(item => !item.deleted_at);
  // Archivar una oportunidad es haber decidido sobre ella: deja de pedir atención y sale del
  // embudo. Las ventas ya aprobadas sí siguen contando, porque ocurrieron.
  const activas = live.filter(item => !item.archived_at);
  const sales = live.filter(item => item.service_type_code !== TENDER_SERVICE);
  const salesActivas = activas.filter(item => item.service_type_code !== TENDER_SERVICE);

  // Same definition as v_psi_sales_kpis_by_commercial_month: approved value grouped by quote month.
  const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
  const salesByMonth = Object.fromEntries(months.map(month => [month, 0]));
  for (const item of sales) {
    if (item.stage_code !== 'aprobado') continue;
    const month = monthKey(item.quote_date || item.created_at);
    if (month in salesByMonth) salesByMonth[month] += amount(item.offer_value);
  }
  const goalByMonth = Object.fromEntries(months.map(month => [month, 0]));
  for (const goal of goals) {
    if (goal.service_type_code === TENDER_SERVICE) continue;
    const month = monthKey(goal.period_month);
    if (month in goalByMonth) goalByMonth[month] += amount(goal.sales_budget);
  }
  const closedMonths = months.filter(month => month < currentMonth);
  const salesYtd = closedMonths.reduce((total, month) => total + salesByMonth[month], 0);
  const goalYtd = closedMonths.reduce((total, month) => total + goalByMonth[month], 0);
  const goalYear = months.reduce((total, month) => total + goalByMonth[month], 0);
  const salesYear = months.reduce((total, month) => total + salesByMonth[month], 0);

  const open = salesActivas.filter(item => {
    const stage = stageByCode.get(item.stage_code);
    return stage && !stage.is_terminal;
  });
  const lastActivity = item => new Date(item.last_interaction_at || item.updated_at || item.created_at);
  const pipelineByStage = stages
    .filter(stage => !stage.is_terminal)
    .sort((a, b) => a.stage_order - b.stage_order)
    .map(stage => {
      const rows = open.filter(item => item.stage_code === stage.code);
      return {
        code: stage.code,
        name: stage.name,
        probability: amount(stage.close_probability),
        count: rows.length,
        monthly_value: rows.reduce((total, item) => total + amount(item.offer_value), 0),
        weighted_monthly_value: rows.reduce((total, item) => total + amount(item.offer_value) * amount(stage.close_probability), 0),
        stale: rows.filter(item => daysBetween(lastActivity(item), today) > STALE_DAYS).length,
        without_value: rows.filter(item => !amount(item.offer_value)).length,
      };
    });
  const weighted = pipelineByStage.reduce((total, stage) => total + stage.weighted_monthly_value, 0);
  const remainingGoal = Math.max(0, goalYear - salesYear);
  const staleLarge = open
    .filter(item => item.stage_code !== 'prospecto' && amount(item.offer_value) > 0 && daysBetween(lastActivity(item), today) > STALE_DAYS)
    .sort((a, b) => amount(b.offer_value) - amount(a.offer_value))
    .slice(0, 5)
    .map(item => ({
      id: item.id,
      company_name: item.company_name,
      stage: stageByCode.get(item.stage_code)?.name || item.stage_code,
      monthly_value: amount(item.offer_value),
      days_without_activity: daysBetween(lastActivity(item), today),
      owner_name: ownerName.get(item.owner_id) || null,
    }));

  // Tenders: only live processes. Closed, discarded or archived ones do not exist for the Torre.
  const tenderByOpportunity = new Map(tenders.filter(item => item.converted_opportunity_id).map(item => [item.converted_opportunity_id, item]));
  const latestDecision = new Map();
  for (const decision of [...decisions].sort((a, b) => String(a.decided_at).localeCompare(String(b.decided_at)))) latestDecision.set(decision.opportunity_id, decision.decision);
  const tenderRows = activas
    .filter(item => item.service_type_code === TENDER_SERVICE)
    .filter(item => !stageByCode.get(item.stage_code)?.is_terminal)
    .filter(item => !CLOSED_TENDER_STATUSES.has(item.tender_offer_status) && latestDecision.get(item.id) !== 'no_go')
    .map(item => {
      const tender = tenderByOpportunity.get(item.id) || null;
      const deadline = tender?.deadline_at ? new Date(tender.deadline_at) : null;
      const daysToDeadline = deadline ? Math.ceil((deadline.getTime() - today.getTime()) / DAY_MS) : null;
      const decision = latestDecision.get(item.id) || null;
      const offerStatus = item.tender_offer_status || (decision ? null : 'pendiente_decision');
      let attention = null;
      if (daysToDeadline !== null && daysToDeadline < 0 && offerStatus !== 'presentada') attention = 'cierre_vencido_sin_actualizar';
      else if (!decision && daysToDeadline !== null && daysToDeadline <= DECISION_WINDOW_DAYS) attention = 'requiere_decision';
      return {
        id: item.id,
        entity: cleanEntityName(tender?.entity || item.company_name),
        total_value: amount(tender?.value ?? item.offer_value),
        deadline_at: tender?.deadline_at || null,
        days_to_deadline: daysToDeadline,
        decision,
        offer_status: offerStatus,
        attention,
      };
    })
    .sort((a, b) => String(a.deadline_at || '9999').localeCompare(String(b.deadline_at || '9999')));
  const awarded = live.filter(item => item.service_type_code === TENDER_SERVICE && item.tender_offer_status === 'adjudicada').length;
  const notAwarded = live.filter(item => item.service_type_code === TENDER_SERVICE && item.tender_offer_status === 'no_adjudicada').length;

  return {
    as_of: today.toISOString().slice(0, 10),
    sales: {
      year,
      closed_months: closedMonths.length,
      ytd_monthly_value: salesYtd,
      ytd_goal: goalYtd,
      ytd_attainment: goalYtd ? salesYtd / goalYtd : null,
      year_goal: goalYear,
      year_monthly_value: salesYear,
      by_month: months.map(month => ({ month, approved_monthly_value: salesByMonth[month], goal: goalByMonth[month] })),
    },
    pipeline: {
      open_count: open.length,
      monthly_value: pipelineByStage.reduce((total, stage) => total + stage.monthly_value, 0),
      weighted_monthly_value: weighted,
      remaining_goal: remainingGoal,
      coverage_of_remaining_goal: remainingGoal ? weighted / remainingGoal : null,
      stale_count: pipelineByStage.reduce((total, stage) => total + stage.stale, 0),
      without_value_count: pipelineByStage.reduce((total, stage) => total + stage.without_value, 0),
      stale_days: STALE_DAYS,
      by_stage: pipelineByStage,
      stale_large: staleLarge,
    },
    tenders: {
      open_count: tenderRows.length,
      total_value: tenderRows.reduce((total, item) => total + item.total_value, 0),
      requires_decision: tenderRows.filter(item => item.attention === 'requiere_decision').length,
      overdue_status: tenderRows.filter(item => item.attention === 'cierre_vencido_sin_actualizar').length,
      decision_window_days: DECISION_WINDOW_DAYS,
      award_rate: awarded + notAwarded ? awarded / (awarded + notAwarded) : null,
      awarded,
      not_awarded: notAwarded,
      calendar: tenderRows,
    },
    data_quality: {
      approved_without_date: sales.filter(item => item.stage_code === 'aprobado' && !item.approved_at).length,
      open_without_value: pipelineByStage.reduce((total, stage) => total + stage.without_value, 0),
      open_stale: pipelineByStage.reduce((total, stage) => total + stage.stale, 0),
      open_total: open.length,
    },
  };
}

function requireResult(result) {
  if (result?.error) throw result.error;
  return result?.data;
}

export async function loadCommercialSummary(database, { now = new Date() } = {}) {
  const [opportunities, stages, goals, tenders, decisions, profiles] = await Promise.all([
    database.from('psi_sales_opportunities')
      .select('id,owner_id,company_name,service_type_code,stage_code,offer_value,quote_date,created_at,updated_at,last_interaction_at,approved_at,deleted_at,archived_at,tender_offer_status')
      .is('deleted_at', null)
      .limit(5000),
    database.from('psi_sales_pipeline_stages').select('code,name,stage_order,close_probability,is_terminal'),
    database.from('psi_sales_goals').select('period_month,sales_budget,service_type_code').gte('period_month', `${now.getUTCFullYear()}-01-01`).lte('period_month', `${now.getUTCFullYear()}-12-01`),
    database.from('psi_public_tenders').select('converted_opportunity_id,entity,value,deadline_at').not('converted_opportunity_id', 'is', null),
    database.from('psi_tender_go_no_go_decisions').select('opportunity_id,decision,decided_at'),
    database.from('psi_sales_profiles').select('id,full_name'),
  ]).then(results => results.map(result => requireResult(result) || []));
  return buildCommercialSummary({ opportunities, stages, goals, tenders, decisions, profiles }, { now });
}
