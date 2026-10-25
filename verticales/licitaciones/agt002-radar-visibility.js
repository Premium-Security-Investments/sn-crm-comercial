import { isAgt002RadarDerivedDayOnlyChurn } from './agt002-radar-derived-day-churn.js';

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
  nowIso,
  evaluateGate,
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
    || typeof evaluateGate !== 'function'
    || typeof nowIso !== 'string'
    || !Number.isFinite(Date.parse(nowIso))
  ) throw ledgerUnavailable();

  try {
    return rows.filter(row => {
      if (alwaysVisibleTenderIds.has(row?.id)) return true;
      const canonical = canonicalByTenderId.get(row?.id);
      if (
        canonical?.visibility_verdict !== 'mostrar_en_radar'
        || canonical.policy_version !== policyVersion
        || canonical.context_version !== contextVersion
      ) return false;
      // Un rollover diario del recolector externo reescribe SÓLO raw.days/raw.window y por eso
      // cambia el hash literal sin cambiar nada material (agt002-radar-derived-day-churn.js). El
      // mismo clasificador puro que ya usan el scan y el worker antes de encolar decide aquí si ese
      // positivo canónico sigue siendo la misma fila; cualquier otra diferencia sigue ocultando.
      if (
        canonical.source_row_hash !== computeSourceRowHash(row)
        && !isAgt002RadarDerivedDayOnlyChurn(row, canonical, { policyVersion, contextVersion })
      ) return false;
      // Un positivo canónico sigue siendo una foto de cuando se produjo. El gate determinista se
      // reevalúa aquí con un único reloj para toda la página, de modo que una fila que ya cruzó su
      // fecha de cierre deja de mostrarse aunque su canónico positivo siga fresco.
      const gate = evaluateGate(row, { nowIso, contextVersion });
      if (
        gate === null
        || typeof gate !== 'object'
        || (gate.verdict !== 'sobreviviente' && gate.verdict !== 'eliminada')
      ) throw ledgerUnavailable();
      return gate.verdict === 'sobreviviente';
    });
  } catch {
    throw ledgerUnavailable();
  }
}
