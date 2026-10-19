import { createClosureActaDrafter } from './agt002-closure-acta-draft.js';
import { runAgt002ClosureActaDrafts } from './agt002-closure-acta-run.js';
import { getAgt002WorkbenchRuntimeConfig, isAgt002WorkbenchDrainEnabled } from './agt002-workbench-runtime.js';
import { createAgt002HetznerBridgeClient } from './agt002-hetzner-bridge-client.js';

// Acta de cierre en el momento mismo del cierre (Juan, 2026-10-19): al archivar
// una licitación o dejarla en un estado final, Vig-IA redacta el borrador en el
// mismo pedido, para que la persona lo encuentre listo en Historial.
//
// Nunca rompe el cierre: el cierre ya se guardó cuando esto corre, así que
// cualquier falla se registra y se deja para la revisión semanal
// (`run-agt002-radar-import.mjs --closure-acta`). Tampoco se invoca al modelo si
// la Mesa está apagada o sin configurar.
/**
 * Redacta todas las actas pendientes. Es la red de seguridad: corre donde vive la
 * configuración del modelo (el proceso web), llamada por el `timer` semanal del
 * servidor a través de un endpoint protegido por secreto. El servidor no tiene la
 * configuración del puente y no debe tenerla.
 */
export async function sweepTenderClosureActas(database, {
  environment = process.env,
  limit,
  log = event => console.log(JSON.stringify(event)),
  bridgeClient,
} = {}) {
  if (!isAgt002WorkbenchDrainEnabled(environment)) return { status: 'skipped', reason: 'apagada' };
  const config = getAgt002WorkbenchRuntimeConfig(environment);
  const drafter = createClosureActaDrafter({
    client: bridgeClient || createAgt002HetznerBridgeClient({ url: config.bridgeUrl, hmacSecret: config.hmacSecret }),
    model: config.model,
    timeoutMs: config.timeoutMs,
    checkGate: () => isAgt002WorkbenchDrainEnabled(environment),
  });
  const outcome = await runAgt002ClosureActaDrafts(database, {
    drafter,
    agentId: config.agentId,
    limit: limit ?? environment.AGT002_CLOSURE_ACTA_MAX_PER_RUN,
    log,
  });
  return { status: 'ran', ...outcome };
}

export async function draftClosureActaAfterClosure(database, opportunityId, {
  environment = process.env,
  log = event => console.log(JSON.stringify(event)),
  bridgeClient,
} = {}) {
  const id = String(opportunityId || '').trim();
  if (!database || !id) return { status: 'skipped', reason: 'sin_oportunidad' };
  if (!isAgt002WorkbenchDrainEnabled(environment)) return { status: 'skipped', reason: 'apagada' };

  try {
    const config = getAgt002WorkbenchRuntimeConfig(environment);
    const drafter = createClosureActaDrafter({
      client: bridgeClient || createAgt002HetznerBridgeClient({ url: config.bridgeUrl, hmacSecret: config.hmacSecret }),
      model: config.model,
      timeoutMs: config.timeoutMs,
      checkGate: () => isAgt002WorkbenchDrainEnabled(environment),
    });
    const outcome = await runAgt002ClosureActaDrafts(database, {
      drafter,
      agentId: config.agentId,
      opportunityId: id,
      log,
    });
    // 'pending' es sólo cuando no había nada que redactar todavía; un borrador que
    // falló se reporta como tal, para que no parezca que quedó en cola.
    const status = outcome.drafted > 0 ? 'drafted' : outcome.failed > 0 ? 'failed' : 'pending';
    return { status, ...outcome };
  } catch (cause) {
    // Sin contenido del acta ni del modelo en el registro: sólo el código.
    log({ event: 'agt002_closure_acta_live_failed', opportunity_id: id, code: cause?.code || null, message: String(cause?.message || '').slice(0, 300) });
    return { status: 'failed', code: cause?.code || null };
  }
}
