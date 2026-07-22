function normalized(value) {
  return String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function priorityHasSignal(row, code) {
  return Array.isArray(row?.signals) && row.signals.some(signal => signal?.code === code);
}

const LEGACY_ALERT_CATEGORY_MAP = Object.freeze({
  managed: 'managed',
  risk: 'risk',
  missing: 'missing',
  overdue: 'overdue',
  closing_soon: 'closing',
  high_value_stalled: 'high_value_stalled',
});

export function categoryFromAlertsHash(hash) {
  const query = String(hash || '').split('?')[1] || '';
  const status = new URLSearchParams(query).get('status') || '';
  return LEGACY_ALERT_CATEGORY_MAP[status] || '';
}

export function priorityCategory(row, category) {
  if (!category) return true;
  if (category === 'risk') return row?.level === 'alto';
  if (category === 'missing') return priorityHasSignal(row, 'missing_next_action');
  if (category === 'overdue') return priorityHasSignal(row, 'next_action_overdue');
  if (category === 'closing') return priorityHasSignal(row, 'close_soon') || priorityHasSignal(row, 'close_overdue');
  if (category === 'managed') return Boolean(row?.evidence?.next_action_at) && !priorityHasSignal(row, 'next_action_overdue');
  if (category === 'high_value_stalled') return priorityHasSignal(row, 'high_value') && (priorityHasSignal(row, 'stalled_warning') || priorityHasSignal(row, 'stalled_critical'));
  return false;
}

export function filterCommercialPriorities(rows, filters = {}) {
  if (!Array.isArray(rows)) return [];
  const query = normalized(filters.query);
  const reviewedIds = filters.reviewedIds instanceof Set ? filters.reviewedIds : new Set(filters.reviewedIds || []);
  return rows.filter(row => {
    if (reviewedIds.has(row?.id)) return false;
    if (!priorityCategory(row, filters.category)) return false;
    if (filters.owner && row?.owner_id !== filters.owner) return false;
    if (filters.regional && row?.regional_nombre !== filters.regional) return false;
    if (filters.stage && row?.stage_code !== filters.stage) return false;
    if (filters.service && row?.service_type_code !== filters.service) return false;
    if (filters.level && row?.level !== filters.level) return false;
    if (query) {
      const haystack = normalized([row?.company_name, row?.owner_name, row?.stage_name, row?.service_type_name, row?.regional_nombre].join(' '));
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function summarizeCommercialPriorities(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const count = category => safeRows.filter(row => priorityCategory(row, category)).length;
  return {
    total: safeRows.length,
    risk: count('risk'),
    missing: count('missing'),
    overdue: count('overdue'),
    closing: count('closing'),
    managed: count('managed'),
    highValueStalled: count('high_value_stalled'),
  };
}
