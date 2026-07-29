import { isWorkerYieldStatus } from './tender-processing-worker.js';

// Bounded, resumable drain loop over the durable worker (runOnce). One drain()
// call issues repeated worker.runOnce() calls, advancing consecutive phases of
// whatever job is currently claimable, and stops on the FIRST of:
//   - a yield/terminal status (see tender-processing-worker.js),
//   - no more claimable work ('empty'/'noop'),
//   - the wall-clock time budget (independent from any business quota),
//   - the iteration cap (a safety backstop),
//   - a thrown, non-recoverable error (e.g. a lost lease surfaced by the RPC),
//     which propagates to the caller after durable per-phase state is committed.
//
// Behavior is preserved when TENDER_CONTINUOUS_DRAIN is off: the loop then
// performs exactly one runOnce(), matching the pre-drain single-unit contract.
const DEFAULT_MAX_ITERATIONS = 40;
const DEFAULT_TIME_BUDGET_MS = 45_000;

export function createTenderProcessingDrain({
  worker,
  analysisConfig = Object.freeze({}),
  now = () => Date.now(),
  maxIterations = DEFAULT_MAX_ITERATIONS,
  timeBudgetMs = DEFAULT_TIME_BUDGET_MS,
  runOnceOptions = {},
} = {}) {
  if (!worker || typeof worker.runOnce !== 'function') {
    throw new Error('createTenderProcessingDrain: se requiere un worker con runOnce().');
  }

  const continuous = analysisConfig?.TENDER_CONTINUOUS_DRAIN === true;
  // Flags off => exactly one unit. Flags on => bounded by maxIterations.
  const iterationCap = continuous ? Math.max(1, maxIterations) : 1;

  async function run() {
    const startedAt = now();
    let iterations = 0;
    let processed = 0;
    let lastStatus = null;
    let stopReason = 'max_iterations';
    const statuses = [];

    while (iterations < iterationCap) {
      // The time budget is independent from any business/analysis quota: even
      // with an unlimited (0) quota and endless queued work, a drain must yield
      // before the platform's hard request ceiling. Checked BETWEEN units,
      // never mid-unit, so an in-flight document download is never truncated.
      const remaining = timeBudgetMs - (now() - startedAt);
      if (iterations > 0 && remaining <= 0) { stopReason = 'deadline'; break; }

      const perRunBudget = remaining > 0 ? remaining : timeBudgetMs;
      const result = await worker.runOnce({ ...runOnceOptions, timeBudgetMs: perRunBudget });
      iterations += 1;
      const status = result?.status || 'noop';
      statuses.push(status);
      lastStatus = status;
      if (status !== 'empty' && status !== 'noop') processed += 1;

      if (status === 'empty' || status === 'noop') { stopReason = 'empty'; break; }
      if (isWorkerYieldStatus(status)) { stopReason = 'yield'; break; }
      if (!continuous) { stopReason = 'single'; break; }
    }

    return { iterations, processed, last_status: lastStatus, statuses, stop_reason: stopReason };
  }

  return { run };
}
