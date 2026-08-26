import assert from 'node:assert/strict';
import { loadReactComponent, renderReactComponent } from './helpers/bundle-react-component.mjs';

const [VigiaCommercialAlerts, VigiaPreflightAnalysis] = await Promise.all([
  loadReactComponent('src/vigia/VigiaOpportunityCopilot.tsx', 'VigiaCommercialAlerts'),
  loadReactComponent('src/vigia/VigiaOpportunityCopilot.tsx', 'VigiaPreflightAnalysis'),
]);
const noop = () => {};

const emptyAlerts = renderReactComponent(VigiaCommercialAlerts, { alerts: [] });
assert.match(emptyAlerts, /<section[^>]*class="notice vigia-preflight-alerts"[^>]*aria-labelledby="vigia-preflight-title"/);
assert.ok(emptyAlerts.includes('<h4 id="vigia-preflight-title">Alertas comerciales</h4>'));
assert.ok(emptyAlerts.includes('Sin alertas comerciales detectadas.'));
assert.equal(emptyAlerts.includes('<ul>'), false);
assert.equal(emptyAlerts.includes('<ol>'), false);

const countOccurrences = (haystack, needle) => haystack.split(needle).length - 1;

const explanationCopy = 'Estos datos requieren actualización en el CRM antes de generar una propuesta.';
const riskText = 'La próxima gestión está vencida hace 4 días.';
const defaultAction = 'Actualice la próxima gestión en el CRM antes de generar la propuesta.';
const contextualDescription = 'Retome la llamada del 14 de agosto con la gerente de compras.';

const preContextualHtml = renderReactComponent(VigiaCommercialAlerts, {
  alerts: [{
    key: 'next_action:overdue',
    category: 'next_action',
    risk_text: riskText,
    action_text: defaultAction,
    contextualAction: null,
  }],
});
assert.ok(preContextualHtml.includes(explanationCopy), 'usa la explicación coherente antes del análisis contextual');
assert.equal(countOccurrences(preContextualHtml, riskText), 1, 'cada riesgo se renderiza una sola vez');
assert.equal(preContextualHtml.includes(defaultAction), false, 'sin análisis contextual, el action_text genérico no se renderiza');
assert.equal(preContextualHtml.includes('Acciones para mejorar la propuesta'), false, 'no existe un encabezado de acciones genérico');
assert.equal(preContextualHtml.includes('<ol>'), false, 'no existe una lista genérica de acciones');

const contextualHtml = renderReactComponent(VigiaCommercialAlerts, {
  alerts: [{
    key: 'next_action:overdue',
    category: 'next_action',
    risk_text: riskText,
    action_text: defaultAction,
    contextualAction: {
      issue_code: 'next_action', title: 'Retomar conversación', description: contextualDescription,
      evidence_refs: ['evidence:interaction:1'],
    },
  }],
});
assert.ok(contextualHtml.includes(explanationCopy), 'usa la explicación coherente tras el análisis contextual');
assert.equal(countOccurrences(contextualHtml, riskText), 1, 'cada riesgo se renderiza una sola vez');
assert.equal(countOccurrences(contextualHtml, contextualDescription), 1, 'la descripción contextual se renderiza una sola vez, como apoyo bajo la alerta correspondiente');
assert.equal(contextualHtml.includes(defaultAction), false, 'la acción contextual reemplaza la genérica, no la duplica');
assert.equal(contextualHtml.includes('Acciones para mejorar la propuesta'), false, 'no existe un encabezado de acciones genérico');
assert.equal(contextualHtml.includes('<ol>'), false, 'no existe una lista genérica de acciones');
assert.equal(contextualHtml.includes('evidence:interaction:1'), false, 'evidence_refs nunca se renderiza');

const idle = renderReactComponent(VigiaPreflightAnalysis, {
  phase: 'idle', standaloneActions: [], onAnalyze: noop, onRetry: noop, errorMessage: null,
});
assert.match(idle, /<section[^>]*class="vigia-preflight-analysis"[^>]*aria-labelledby="vigia-preflight-analysis-title"/);
assert.ok(idle.includes('<h4 id="vigia-preflight-analysis-title">Análisis inteligente del seguimiento</h4>'));
assert.ok(idle.includes('>Analizar cómo fortalecer el seguimiento</button>'));

const loading = renderReactComponent(VigiaPreflightAnalysis, {
  phase: 'loading', standaloneActions: [], onAnalyze: noop, onRetry: noop, errorMessage: null,
});
assert.match(loading, /role="status"/);
assert.ok(loading.includes('Vig-IA Comercial está revisando el historial de la oportunidad…'));
assert.equal(loading.includes('>Analizar cómo fortalecer el seguimiento</button>'), false);

const error = renderReactComponent(VigiaPreflightAnalysis, {
  phase: 'error', standaloneActions: [], onAnalyze: noop, onRetry: noop, errorMessage: 'Puente temporalmente ocupado',
});
assert.match(error, /role="alert"/);
assert.ok(error.includes('No fue posible analizar el historial.'));
assert.ok(error.includes('Puente temporalmente ocupado'));
assert.ok(error.includes('>Reintentar</button>'));

const internalError = renderReactComponent(VigiaPreflightAnalysis, {
  phase: 'error', standaloneActions: [], onAnalyze: noop, onRetry: noop,
  errorMessage: 'getAgt003PreflightRuntimeConfig is not defined',
});
assert.match(internalError, /role="alert"/);
assert.ok(
  internalError.includes('El análisis no está disponible temporalmente. Puede reintentar.'),
  'los errores internos se traducen a un mensaje seguro en español',
);
assert.equal(
  internalError.includes('getAgt003PreflightRuntimeConfig is not defined'),
  false,
  'el identificador interno o el mensaje crudo nunca se renderiza',
);
assert.ok(internalError.includes('>Reintentar</button>'));

const readyEmpty = renderReactComponent(VigiaPreflightAnalysis, {
  phase: 'ready', standaloneActions: [], onAnalyze: noop, onRetry: noop, errorMessage: null,
});
assert.ok(readyEmpty.includes('Vig-IA no encontró acciones adicionales fuera de las alertas comerciales.'));
assert.ok(readyEmpty.includes('>Actualizar análisis</button>'));

const ready = renderReactComponent(VigiaPreflightAnalysis, {
  phase: 'ready',
  standaloneActions: [{
    issue_code: 'pending_terms', title: 'Aclarar términos', description: 'Valide el plazo de pago pendiente.',
    evidence_refs: ['evidence:interaction:2'],
  }],
  onAnalyze: noop,
  onRetry: noop,
  errorMessage: null,
});
assert.match(ready, /<ul class="vigia-preflight-standalone">/);
assert.ok(ready.includes('<strong>Aclarar términos</strong>'));
assert.ok(ready.includes('Valide el plazo de pago pendiente.'));
assert.equal(ready.includes('evidence:interaction:2'), false);
assert.ok(ready.includes('>Actualizar análisis</button>'));

console.log('AGT-003 preflight alert and analysis render checks passed');
