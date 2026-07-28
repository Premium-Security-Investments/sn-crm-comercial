import { randomUUID } from 'node:crypto';
import { ACTIONS, requireAction } from './access-control.js';
import { buildAgt003CopilotRequest } from './agt003-copilot-input.js';
import { computeAgt003CopilotIdempotencyKey } from './agt003-copilot-persistence.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FEEDBACK_RATINGS = new Set(['useful', 'needs_change', 'discarded']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, required, optional = []) {
  if (!isRecord(value)) return false;
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return required.every(key => Object.hasOwn(value, key))
    && keys.every(key => allowed.has(key));
}

function publicError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function requireUuid(value, label) {
  if (typeof value !== 'string' || value.trim() !== value || !UUID.test(value)) {
    throw publicError(`${label} no es válido.`, 400, 'VIGIA_COPILOT_BAD_REQUEST');
  }
  return value;
}

function parseGenerateBody(body) {
  if (!exactKeys(body, ['opportunity_id'])) {
    throw publicError('El cuerpo de generación Vig-IA debe incluir únicamente opportunity_id.', 400, 'VIGIA_COPILOT_BAD_REQUEST');
  }
  return { opportunityId: requireUuid(body.opportunity_id, 'La oportunidad') };
}

function parseFeedbackBody(body) {
  if (!exactKeys(body, ['run_id', 'opportunity_id', 'rating'], ['comment'])) {
    throw publicError('El cuerpo de feedback Vig-IA contiene campos faltantes o inesperados.', 400, 'VIGIA_COPILOT_BAD_REQUEST');
  }
  if (!FEEDBACK_RATINGS.has(body.rating)) {
    throw publicError('El rating de feedback Vig-IA no es válido.', 400, 'VIGIA_COPILOT_BAD_REQUEST');
  }
  if (body.comment !== undefined && body.comment !== null
    && (typeof body.comment !== 'string' || body.comment.length > 2000)) {
    throw publicError('El comentario de feedback Vig-IA no es válido.', 400, 'VIGIA_COPILOT_BAD_REQUEST');
  }
  return {
    runId: requireUuid(body.run_id, 'La ejecución Vig-IA'),
    opportunityId: requireUuid(body.opportunity_id, 'La oportunidad'),
    rating: body.rating,
    comment: body.comment ?? null,
  };
}

function requireCommercialDraft(profile, resource) {
  return requireAction(profile, ACTIONS.AI_COMMERCIAL_DRAFT_RUN, resource);
}

function resultPayload(run, reused) {
  if (!run || run.status !== 'completed' || !isRecord(run.output)) {
    throw publicError('La ejecución Vig-IA no está disponible.', 502, 'VIGIA_COPILOT_UNAVAILABLE');
  }
  return {
    run_id: run.run_id,
    status: 'completed',
    reused,
    output: run.output,
    human_review_required: true,
  };
}

function claimError(status) {
  if (status === 'in_progress') return publicError('Vig-IA ya está procesando este snapshot.', 409, 'VIGIA_COPILOT_IN_PROGRESS');
  if (status === 'quota') return publicError('La cuota diaria de Vig-IA está agotada.', 429, 'VIGIA_COPILOT_QUOTA');
  if (status === 'saturated') return publicError('Vig-IA no tiene capacidad disponible.', 503, 'VIGIA_COPILOT_SATURATED');
  return publicError('No fue posible reservar la ejecución Vig-IA.', 503, 'VIGIA_COPILOT_UNAVAILABLE');
}

function failureCode(error) {
  const candidate = typeof error?.code === 'string' ? error.code.trim().toUpperCase() : '';
  return /^[A-Z0-9_]{1,80}$/.test(candidate) ? candidate : 'COPILOT_UNAVAILABLE';
}

function failureUsage(error, model) {
  const usage = error?.usage;
  if (isRecord(usage)
    && typeof usage.provider === 'string' && usage.provider.trim()
    && usage.model === model
    && Number.isInteger(usage.input_tokens) && usage.input_tokens >= 0
    && Number.isInteger(usage.output_tokens) && usage.output_tokens >= 0
    && Object.hasOwn(usage, 'rate_limit')) {
    return {
      provider: usage.provider,
      model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      rate_limit: usage.rate_limit,
    };
  }
  return { provider: 'agent_bridge', model, input_tokens: 0, output_tokens: 0, rate_limit: null };
}

function assertDependencies(dependencies) {
  const required = [
    'isConfigured', 'getConfig', 'resolveOpportunityResource', 'loadOpportunityContext',
    'loadApprovedAssets', 'claimRun', 'findRunByKey', 'findRunById', 'createRuntime',
    'recordRun', 'recordFailure', 'releaseClaim', 'recordFeedback',
  ];
  if (!isRecord(dependencies) || required.some(name => typeof dependencies[name] !== 'function')) {
    throw new Error('Las dependencias de la API Vig-IA no están completas.');
  }
}

export function createAgt003CopilotApi(dependencies) {
  assertDependencies(dependencies);
  const correlationId = typeof dependencies.correlationId === 'function'
    ? dependencies.correlationId
    : randomUUID;

  return Object.freeze({
    async generate({ profile, body }) {
      const { opportunityId } = parseGenerateBody(body);
      const resource = await dependencies.resolveOpportunityResource(opportunityId, profile);
      requireCommercialDraft(profile, resource);
      if (!dependencies.isConfigured()) {
        throw publicError('Vig-IA no está configurado.', 503, 'VIGIA_COPILOT_NOT_CONFIGURED');
      }

      const config = dependencies.getConfig();
      const [context, approvedAssets] = await Promise.all([
        dependencies.loadOpportunityContext(opportunityId),
        dependencies.loadApprovedAssets(),
      ]);
      if (!context || context.opportunity?.id !== opportunityId || !context.snapshotId) {
        throw publicError('El contexto de la oportunidad no está disponible.', 503, 'VIGIA_COPILOT_CONTEXT_UNAVAILABLE');
      }
      const request = buildAgt003CopilotRequest({
        opportunity: context.opportunity,
        interactions: context.interactions || [],
        approvedAssets,
        correlationId: correlationId(),
        snapshotId: context.snapshotId,
      });
      const idempotencyKey = computeAgt003CopilotIdempotencyKey({
        snapshotId: request.snapshot_id,
        policyVersion: config.policyVersion,
        model: config.model,
      });
      const claim = await dependencies.claimRun({
        idempotencyKey,
        dailyMaxRuns: config.dailyMaxRuns,
        maxConcurrent: config.maxConcurrent,
        leaseSeconds: config.leaseSeconds,
      });
      if (claim.status === 'existing') {
        return resultPayload(await dependencies.findRunByKey(idempotencyKey), true);
      }
      if (claim.status !== 'claimed') throw claimError(claim.status);

      let terminalRecorded = false;
      try {
        const generated = await dependencies.createRuntime().draft(request, { idempotencyKey });
        const run = await dependencies.recordRun({
          opportunityId,
          actorId: profile.id,
          claimId: claim.claim_id,
          request,
          response: generated.response,
          usage: generated.usage,
        });
        terminalRecorded = true;
        return resultPayload(run, false);
      } catch (error) {
        try {
          await dependencies.recordFailure({
            opportunityId,
            actorId: profile.id,
            claimId: claim.claim_id,
            request,
            policyVersion: config.policyVersion,
            model: config.model,
            usage: failureUsage(error, config.model),
            failureCode: failureCode(error),
          });
          terminalRecorded = true;
        } catch {
          // The finally block releases a claim when no terminal row could be recorded.
        }
        throw publicError('Vig-IA no pudo generar el borrador.', 502, 'VIGIA_COPILOT_UNAVAILABLE');
      } finally {
        if (!terminalRecorded) {
          try { await dependencies.releaseClaim({ idempotencyKey, claimId: claim.claim_id }); } catch { /* lease expiry is the final fallback */ }
        }
      }
    },

    async feedback({ profile, body }) {
      const parsed = parseFeedbackBody(body);
      const run = await dependencies.findRunById(parsed.runId);
      if (!run || run.opportunity_id !== parsed.opportunityId) {
        throw publicError('La ejecución Vig-IA no existe.', 404, 'VIGIA_COPILOT_RUN_NOT_FOUND');
      }
      if (run.status !== 'completed' || !isRecord(run.output)) {
        throw publicError('Sólo una ejecución completada admite feedback.', 409, 'VIGIA_COPILOT_RUN_NOT_COMPLETED');
      }
      const resource = await dependencies.resolveOpportunityResource(parsed.opportunityId, profile);
      requireCommercialDraft(profile, resource);
      return dependencies.recordFeedback({
        runId: parsed.runId,
        opportunityId: parsed.opportunityId,
        actorId: profile.id,
        rating: parsed.rating,
        comment: parsed.comment,
      });
    },
  });
}
