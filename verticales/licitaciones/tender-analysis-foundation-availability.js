const FOUNDATION_ERROR_CODE = 'TENDER_ANALYSIS_FOUNDATION_UNAVAILABLE';
const FOUNDATION_ERROR_MESSAGE = 'La fundación de análisis documental no está disponible.';
const FOUNDATION_TABLES = Object.freeze([
  'psi_tender_document_snapshots',
  'psi_tender_analysis_runs',
]);
const FOUNDATION_RPC = 'psi_tender_analysis_foundation_ready';

export class TenderAnalysisFoundationUnavailableError extends Error {
  constructor() {
    super(FOUNDATION_ERROR_MESSAGE);
    this.name = 'TenderAnalysisFoundationUnavailableError';
    this.status = 503;
    this.code = FOUNDATION_ERROR_CODE;
  }
}

export function isTenderAnalysisFoundationUnavailable(error) {
  return error?.code === FOUNDATION_ERROR_CODE;
}

function sanitizedFailure(logger, category) {
  logger?.warn?.('tender_analysis_foundation_unavailable', {
    event: 'tender_analysis_foundation_unavailable',
    category,
  });
  return new TenderAnalysisFoundationUnavailableError();
}

async function assertTableReadable(database, table, logger) {
  try {
    const response = await database.from(table).select('id').limit(1);
    if (response?.error) throw response.error;
  } catch (_error) {
    throw sanitizedFailure(logger, 'table_unavailable');
  }
}

/** Verifies PostgREST exposes the read-only readiness RPC installed by 025. */
async function assertRunRpcCallable(database, logger) {
  try {
    const response = await database.rpc(FOUNDATION_RPC, {});
    if (!response?.error && response?.data === true) return;
    throw response?.error || new Error('unexpected foundation readiness response');
  } catch (_error) {
    throw sanitizedFailure(logger, 'rpc_unavailable');
  }
}

/** Server-side fail-closed readiness guard for migration 025. */
export async function requireTenderAnalysisFoundation(database, { logger = console } = {}) {
  if (!database?.from || !database?.rpc) throw sanitizedFailure(logger, 'database_unavailable');
  for (const table of FOUNDATION_TABLES) await assertTableReadable(database, table, logger);
  await assertRunRpcCallable(database, logger);
  return true;
}

export const TENDER_ANALYSIS_FOUNDATION_UNAVAILABLE = Object.freeze({
  status: 503,
  code: FOUNDATION_ERROR_CODE,
  message: FOUNDATION_ERROR_MESSAGE,
});
