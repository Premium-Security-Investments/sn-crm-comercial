import { strict as assert } from 'node:assert';
import { createTenderProcessingDrain } from '../tender-processing-drain.js';

// A scripted worker whose runOnce() returns a predefined sequence of statuses
// (falling back to 'empty' once exhausted) and can advance a shared clock so
// the drain's time budget can be exercised deterministically.
function scriptedWorker(statuses, { onCall } = {}) {
  let i = 0;
  const calls = [];
  return {
    calls,
    runOnce: async (opts) => {
      calls.push(opts);
      if (onCall) onCall();
      const status = i < statuses.length ? statuses[i] : 'empty';
      i += 1;
      return { status, job_id: 'job-x' };
    },
  };
}

async function run() {
  // 1) Flag OFF: exactly one runOnce regardless of how much work remains.
  {
    const worker = scriptedWorker(['batch_processed', 'batch_processed', 'ready_for_snapshot']);
    const drain = createTenderProcessingDrain({ worker, analysisConfig: {} });
    const result = await drain.run();
    assert.equal(worker.calls.length, 1, 'sin drain continuo se procesa exactamente una unidad');
    assert.equal(result.iterations, 1);
    assert.equal(result.processed, 1);
    assert.equal(result.stop_reason, 'single');
  }

  // 2) Flag ON: drains three queued documents (three import units) plus the
  //    snapshot phase in a single invocation, stopping when no work remains.
  {
    const worker = scriptedWorker(['batch_processed', 'batch_processed', 'ready_for_snapshot', 'snapshot_published', 'empty']);
    const drain = createTenderProcessingDrain({ worker, analysisConfig: { TENDER_CONTINUOUS_DRAIN: true } });
    const result = await drain.run();
    assert.equal(worker.calls.length, 5);
    assert.equal(result.processed, 4, 'empty no cuenta como unidad procesada');
    assert.equal(result.statuses.filter(s => s === 'batch_processed').length, 2);
    assert.equal(result.stop_reason, 'empty');
  }

  // 3) Terminal state stops the drain immediately.
  {
    const worker = scriptedWorker(['completed']);
    const drain = createTenderProcessingDrain({ worker, analysisConfig: { TENDER_CONTINUOUS_DRAIN: true } });
    const result = await drain.run();
    assert.equal(worker.calls.length, 1);
    assert.equal(result.stop_reason, 'yield');
    assert.equal(result.last_status, 'completed');
  }

  // 3a) needs_attention (parked) also yields, never loops.
  {
    const worker = scriptedWorker(['batch_processed', 'needs_attention', 'batch_processed']);
    const drain = createTenderProcessingDrain({ worker, analysisConfig: { TENDER_CONTINUOUS_DRAIN: true } });
    const result = await drain.run();
    assert.equal(worker.calls.length, 2);
    assert.equal(result.last_status, 'needs_attention');
    assert.equal(result.stop_reason, 'yield');
  }

  // 3b) waiting_agent_capacity yields so a shown rules preview / capacity
  //     backoff never spins in a tight loop within one invocation.
  {
    const worker = scriptedWorker(['waiting_agent_capacity', 'waiting_agent_capacity']);
    const drain = createTenderProcessingDrain({ worker, analysisConfig: { TENDER_CONTINUOUS_DRAIN: true } });
    const result = await drain.run();
    assert.equal(worker.calls.length, 1);
    assert.equal(result.stop_reason, 'yield');
  }

  // 4) maxUnits/maxIterations bounds an otherwise endless stream of work.
  {
    const worker = scriptedWorker(Array.from({ length: 100 }, () => 'batch_processed'));
    const drain = createTenderProcessingDrain({ worker, analysisConfig: { TENDER_CONTINUOUS_DRAIN: true }, maxIterations: 3 });
    const result = await drain.run();
    assert.equal(worker.calls.length, 3);
    assert.equal(result.iterations, 3);
    assert.equal(result.stop_reason, 'max_iterations');
  }

  // 5) Deadline bounds wall-clock time independently of business quota: even
  //    with an unlimited (0) quota and endless work, a drain yields before the
  //    platform request ceiling. Budget is checked BETWEEN units, never mid-unit.
  {
    let clock = 0;
    const now = () => clock;
    const worker = scriptedWorker(Array.from({ length: 100 }, () => 'batch_processed'), { onCall: () => { clock += 30_000; } });
    const drain = createTenderProcessingDrain({ worker, analysisConfig: { TENDER_CONTINUOUS_DRAIN: true }, now, timeBudgetMs: 45_000, maxIterations: 100 });
    const result = await drain.run();
    assert.equal(worker.calls.length, 2, 'la primera unidad siempre corre; la tercera se corta por deadline');
    assert.equal(result.stop_reason, 'deadline');
  }

  // 6) Per-run time budget shrinks as the deadline approaches and is never
  //    negative (the first unit still receives the full budget).
  {
    let clock = 0;
    const now = () => clock;
    const worker = scriptedWorker(['batch_processed', 'batch_processed', 'empty'], { onCall: () => { clock += 10_000; } });
    const drain = createTenderProcessingDrain({ worker, analysisConfig: { TENDER_CONTINUOUS_DRAIN: true }, now, timeBudgetMs: 45_000 });
    await drain.run();
    assert.equal(worker.calls[0].timeBudgetMs, 45_000, 'la primera unidad recibe el presupuesto completo');
    assert.ok(worker.calls[1].timeBudgetMs <= 35_000 && worker.calls[1].timeBudgetMs > 0, 'la segunda unidad recibe el presupuesto restante');
  }

  // 7) Missing worker is rejected loudly.
  {
    assert.throws(() => createTenderProcessingDrain({ analysisConfig: {} }), /worker/i);
  }

  console.log('tender-processing-drain contract passed');
}

run();
