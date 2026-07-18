export const VIGIA_DASHBOARD_FILTER_KEYS = Object.freeze(['owner', 'stage', 'service', 'active']);

export function parseVigiaDashboardFilters(hash, validValues = {}) {
  const params = new URLSearchParams(String(hash || '').split('?')[1] || '');
  const allowedKeys = new Set(VIGIA_DASHBOARD_FILTER_KEYS);
  const hasUnknownKey = [...params.keys()].some(key => !allowedKeys.has(key));
  const owner = params.get('owner') || '';
  const stage = params.get('stage') || '';
  const service = params.get('service') || '';
  const active = params.get('active');
  const ownerValues = new Set(validValues.owners || []);
  const stageValues = new Set(validValues.stages || []);
  const serviceValues = new Set(validValues.services || []);
  const invalid = hasUnknownKey
    || (owner !== '' && !ownerValues.has(owner))
    || (stage !== '' && !stageValues.has(stage))
    || (service !== '' && !serviceValues.has(service))
    || (active !== null && active !== '' && active !== '1');

  if (invalid) return { owner: '__invalid_vigia_filter__', stage: '', service: '', onlyActive: true, invalid: true };
  return { owner, stage, service, onlyActive: active === '1', invalid: false };
}
