import { randomUUID } from 'node:crypto';
import { ACTIONS, requireAction } from './access-control.js';
import { buildAgt003CopilotPreflightRequest } from './agt003-preflight-input.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, required) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return required.every(key => Object.hasOwn(value, key))
    && keys.length === required.length;
}

function publicError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function parseBody(body) {
  if (!exactKeys(body, ['opportunity_id'])
    || typeof body.opportunity_id !== 'string'
    || body.opportunity_id.trim() !== body.opportunity_id
    || !UUID.test(body.opportunity_id)) {
    throw publicError(
      'El cuerpo de preflight Vig-IA debe incluir únicamente un opportunity_id válido.',
      400,
      'VIGIA_PREFLIGHT_BAD_REQUEST',
    );
  }
  return { opportunityId: body.opportunity_id };
}

function mapRuntimeError(error) {
  if (error?.code === 'AGT003_PREFLIGHT_CONCURRENCY' || error?.code === 'AGT003_BRIDGE_BUSY') {
    return publicError('Vig-IA no tiene capacidad disponible.', 503, 'VIGIA_PREFLIGHT_SATURATED');
  }
  if (error?.code === 'AGT003_PREFLIGHT_QUOTA') {
    return publicError('La cuota diaria de preflight Vig-IA está agotada.', 429, 'VIGIA_PREFLIGHT_QUOTA');
  }
  if (error?.code === 'AGT003_CLAUDE_SESSION_LIMIT') {
    return publicError(
      'Vig-IA alcanzó temporalmente el límite de sesión. Intente de nuevo más tarde.',
      503,
      'VIGIA_PREFLIGHT_SESSION_LIMIT',
    );
  }
  if (error?.code === 'AGT003_BRIDGE_AUTH_INVALID') {
    return publicError('Vig-IA no está configurado.', 503, 'VIGIA_PREFLIGHT_NOT_CONFIGURED');
  }
  return publicError('Vig-IA no pudo completar el preflight.', 502, 'VIGIA_PREFLIGHT_UNAVAILABLE');
}

function assertDependencies(dependencies) {
  const required = ['isConfigured', 'getConfig', 'resolveOpportunityResource', 'loadOpportunityContext', 'createRuntime'];
  if (!isRecord(dependencies) || required.some(name => typeof dependencies[name] !== 'function')) {
    throw new Error('Las dependencias de la API de preflight Vig-IA no están completas.');
  }
}

export function createAgt003PreflightApi(dependencies) {
  assertDependencies(dependencies);
  const correlationId = typeof dependencies.correlationId === 'function'
    ? dependencies.correlationId
    : randomUUID;

  return Object.freeze({
    async preflight({ profile, body }) {
      const { opportunityId } = parseBody(body);
      const resource = await dependencies.resolveOpportunityResource(opportunityId, profile);
      requireAction(profile, ACTIONS.AI_COMMERCIAL_DRAFT_RUN, resource);
      if (!dependencies.isConfigured()) {
        throw publicError('Vig-IA no está configurado.', 503, 'VIGIA_PREFLIGHT_NOT_CONFIGURED');
      }
      const config = dependencies.getConfig();

      const context = await dependencies.loadOpportunityContext(opportunityId);
      if (!context || context.opportunity?.id !== opportunityId || !context.snapshotId) {
        throw publicError(
          'El contexto de la oportunidad no está disponible.',
          503,
          'VIGIA_PREFLIGHT_CONTEXT_UNAVAILABLE',
        );
      }
      const request = buildAgt003CopilotPreflightRequest({
        opportunity: context.opportunity,
        interactions: context.interactions || [],
        correlationId: correlationId(),
        snapshotId: context.snapshotId,
      });

      try {
        const generated = await dependencies.createRuntime().preflight(request, {
          idempotencyKey: `${context.snapshotId}:${config.policyVersion}:${config.model}`,
        });
        return {
          status: 'completed',
          actions: generated.response.actions,
        };
      } catch (error) {
        throw mapRuntimeError(error);
      }
    },
  });
}
