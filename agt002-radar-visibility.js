function ledgerUnavailable() {
  const error = new Error('AGT002_RADAR_VISIBILITY_LEDGER_UNAVAILABLE');
  error.code = 'AGT002_RADAR_VISIBILITY_LEDGER_UNAVAILABLE';
  error.runtime_boundary_code = 'AGT002_RADAR_VISIBILITY_LEDGER_UNAVAILABLE';
  error.status = 503;
  return error;
}

export function filterRadarRowsByCanonicalPreanalysis(rows, {
  canonicalByTenderId,
  alwaysVisibleTenderIds,
  computeSourceRowHash,
  policyVersion,
  contextVersion,
  enabled,
} = {}) {
  if (enabled === false) return rows;
  if (
    enabled !== true
    || !Array.isArray(rows)
    || !(canonicalByTenderId instanceof Map)
    || !(alwaysVisibleTenderIds instanceof Set)
    || typeof computeSourceRowHash !== 'function'
    || typeof policyVersion !== 'string'
    || !policyVersion
    || typeof contextVersion !== 'string'
    || !contextVersion
  ) throw ledgerUnavailable();

  try {
    return rows.filter(row => {
      if (alwaysVisibleTenderIds.has(row?.id)) return true;
      const canonical = canonicalByTenderId.get(row?.id);
      return canonical?.visibility_verdict === 'mostrar_en_radar'
        && canonical.source_row_hash === computeSourceRowHash(row)
        && canonical.policy_version === policyVersion
        && canonical.context_version === contextVersion;
    });
  } catch {
    throw ledgerUnavailable();
  }
}
