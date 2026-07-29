import { createAgt002HetznerBridgeClient } from './agt002-hetzner-bridge-client.js';
import { createAgt002WorkbenchResponder } from './agt002-workbench-responder.js';
import {
  claimAgt002WorkbenchJob,
  appendAgt002WorkbenchJobEvent,
  completeAgt002WorkbenchJob,
  sweepExpiredLeases,
} from './agt002-workbench-persistence.js';
import { runAgt002WorkbenchWorker } from './agt002-workbench-worker.js';

// Fase B1: puente de producción mínimo de la Mesa Vig-IA, sin ruta HTTP ni
// programador todavía. Ningún gate de esta fábrica lee AGT002_PREVIEW_* — la Mesa
// requiere su propio modelo explícito, sin heredar el de AGT-002 Preview.
export const AGT002_WORKBENCH_ENGINE_ID = 'agt002_workbench_bridge_v1';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 45_000;
const DEFAULT_DAILY_MAX_JOBS = 1;
const MAX_DAILY_MAX_JOBS = 100;
const DEFAULT_SWEEP_MAX = 25;
const MAX_SWEEP_MAX = 500;
const MAX_LEASE_SECONDS = 600;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function validHttps(value) {
  if (!nonEmpty(value)) return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

/** Parses a bounded positive-integer env override; returns the fallback when unset, NaN when invalid. */
function boundedIntFromEnv(rawValue, { min, max, fallback }) {
  if (rawValue === undefined) return fallback;
  if (!nonEmpty(rawValue)) return NaN;
  const parsed = Number(rawValue);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : NaN;
}

/** Cheap, side-effect-free gate: only the exact engine id enables the API surface. */
export function isAgt002WorkbenchApiEnabled(environment = process.env) {
  return environment?.AGT002_WORKBENCH_RUNTIME === AGT002_WORKBENCH_ENGINE_ID;
}

/**
 * Deep gate: API enabled + explicit drain flag + every runtime value valid. Meant to
 * be called cheaply and repeatedly (e.g. by the responder right before the bridge
 * call) so a mid-flight switch flip is observed immediately.
 */
export function isAgt002WorkbenchDrainEnabled(environment = process.env) {
  if (!isAgt002WorkbenchApiEnabled(environment) || environment?.AGT002_WORKBENCH_DRAIN_ENABLED !== 'true') {
    return false;
  }
  try {
    getAgt002WorkbenchRuntimeConfig(environment);
    return true;
  } catch {
    return false;
  }
}

/** Single validated source of runtime limits. Fails closed (throws) on any gap. */
export function getAgt002WorkbenchRuntimeConfig(environment = process.env) {
  if (!isAgt002WorkbenchApiEnabled(environment) || environment?.AGT002_WORKBENCH_DRAIN_ENABLED !== 'true') {
    throw new Error('La Mesa Vig-IA no está configurada para ejecutar el drain.');
  }

  const model = environment.AGT002_WORKBENCH_MODEL;
  const bridgeUrl = environment.AGT002_HETZNER_BRIDGE_URL;
  const hmacSecret = environment.AGT002_HETZNER_BRIDGE_HMAC_SECRET;
  const agentId = environment.AGT002_WORKBENCH_AGENT_ID;
  const workerId = environment.AGT002_WORKBENCH_WORKER_ID;

  if (!nonEmpty(model)) throw new Error('La Mesa Vig-IA no está configurada: falta AGT002_WORKBENCH_MODEL.');
  if (!validHttps(bridgeUrl)) throw new Error('La Mesa Vig-IA no está configurada: la URL del puente no es HTTPS válida.');
  if (typeof hmacSecret !== 'string' || Buffer.byteLength(hmacSecret) < 32) {
    throw new Error('La Mesa Vig-IA no está configurada: el secreto HMAC debe tener al menos 32 bytes.');
  }
  if (!isUuid(agentId)) throw new Error('La Mesa Vig-IA no está configurada: el identificador de agente no es un UUID válido.');
  if (!nonEmpty(workerId)) throw new Error('La Mesa Vig-IA no está configurada: falta el identificador de worker.');

  const dailyMaxJobs = boundedIntFromEnv(environment.AGT002_WORKBENCH_DAILY_MAX_JOBS, {
    min: 1, max: MAX_DAILY_MAX_JOBS, fallback: DEFAULT_DAILY_MAX_JOBS,
  });
  const maxConcurrent = boundedIntFromEnv(environment.AGT002_WORKBENCH_MAX_CONCURRENT, { min: 1, max: 1, fallback: 1 });
  const timeoutMs = boundedIntFromEnv(environment.AGT002_WORKBENCH_TIMEOUT_MS, {
    min: 1, max: MAX_TIMEOUT_MS, fallback: DEFAULT_TIMEOUT_MS,
  });
  const sweepMax = boundedIntFromEnv(environment.AGT002_WORKBENCH_SWEEP_MAX, {
    min: 1, max: MAX_SWEEP_MAX, fallback: DEFAULT_SWEEP_MAX,
  });

  if (!Number.isInteger(dailyMaxJobs) || !Number.isInteger(maxConcurrent)
    || !Number.isInteger(timeoutMs) || !Number.isInteger(sweepMax)) {
    throw new Error('La Mesa Vig-IA no está configurada: un límite numérico es inválido o está fuera de rango.');
  }
  if (maxConcurrent !== 1) throw new Error('La Mesa Vig-IA no está configurada: maxConcurrent debe ser exactamente 1 en esta fase.');

  const leaseSeconds = Math.ceil(timeoutMs / 1000) + 15;
  if (leaseSeconds > MAX_LEASE_SECONDS) throw new Error('La Mesa Vig-IA no está configurada: el lease derivado excede el máximo permitido.');

  return {
    model: model.trim(),
    bridgeUrl,
    hmacSecret,
    agentId,
    workerId: workerId.trim(),
    dailyMaxJobs,
    maxConcurrent,
    timeoutMs,
    leaseSeconds,
    sweepMax,
  };
}

/**
 * Builds the Hetzner bridge client + responder from server-side configuration only.
 * Fails closed (throws) when unconfigured. Does not perform any network I/O at
 * construction time; the bridge client only opens a connection when invoked.
 */
export function createAgt002WorkbenchRuntime({ environment = process.env } = {}) {
  const config = getAgt002WorkbenchRuntimeConfig(environment);
  const bridgeClient = createAgt002HetznerBridgeClient({ url: config.bridgeUrl, hmacSecret: config.hmacSecret });
  const responder = createAgt002WorkbenchResponder({
    client: bridgeClient,
    model: config.model,
    timeoutMs: config.timeoutMs,
    checkGate: () => isAgt002WorkbenchDrainEnabled(environment),
  });
  return { config, responder };
}

function createDatabasePersistenceAdapter(database) {
  return {
    claimAgt002WorkbenchJob: args => claimAgt002WorkbenchJob(database, args),
    appendAgt002WorkbenchJobEvent: args => appendAgt002WorkbenchJobEvent(database, args),
    completeAgt002WorkbenchJob: args => completeAgt002WorkbenchJob(database, args),
  };
}

/**
 * Fase B1: drena la Mesa Vig-IA un ciclo a la vez, sin ruta HTTP ni programador.
 * `runOnce()` vuelve a comprobar el interruptor dinámicamente al inicio (no memoiza
 * el estado de `environment` entre invocaciones), barre leases expirados antes de
 * intentar reclamar, ejecuta como máximo una llamada a `runAgt002WorkbenchWorker`
 * (nunca un segundo trabajo por invocación) y devuelve únicamente estado y conteos
 * saneados — nunca el payload del trabajo ni contenido del modelo.
 */
export function createAgt002WorkbenchDrain({ database, environment = process.env, bridgeClient } = {}) {
  if (!database || typeof database.rpc !== 'function') throw new TypeError('database.rpc es obligatorio.');

  return Object.freeze({
    async runOnce() {
      if (!isAgt002WorkbenchDrainEnabled(environment)) {
        return { status: 'disabled' };
      }
      const config = getAgt002WorkbenchRuntimeConfig(environment);

      const sweep = await sweepExpiredLeases(database, { max: config.sweepMax });

      const client = bridgeClient || createAgt002HetznerBridgeClient({ url: config.bridgeUrl, hmacSecret: config.hmacSecret });
      // Re-chequeo del interruptor cableado al responder: si `environment` cambia
      // entre el claim (ya ejecutado dentro del worker) y el instante justo previo a
      // la llamada al puente, el modelo nunca se invoca.
      const responder = createAgt002WorkbenchResponder({
        client,
        model: config.model,
        timeoutMs: config.timeoutMs,
        checkGate: () => isAgt002WorkbenchDrainEnabled(environment),
      });

      const outcome = await runAgt002WorkbenchWorker({
        persistence: createDatabasePersistenceAdapter(database),
        responder,
        limits: {
          workerId: config.workerId,
          dailyMaxJobs: config.dailyMaxJobs,
          maxConcurrent: config.maxConcurrent,
          leaseSeconds: config.leaseSeconds,
          responderTimeoutMs: config.timeoutMs,
          agentId: config.agentId,
        },
      });

      return {
        status: outcome.status,
        ...(outcome.job_id !== undefined ? { job_id: outcome.job_id } : {}),
        swept: sweep.released,
      };
    },
  });
}
