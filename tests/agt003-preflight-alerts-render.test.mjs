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

const contextualDescription = 'Retome la llamada del 14 de agosto con la gerente de compras.';
const defaultAction = 'Actualice la próxima gestión en el CRM antes de generar la propuesta.';
const alertsHtml = renderReactComponent(VigiaCommercialAlerts, {
  alerts: [{
    key: 'next_action:overdue',
    category: 'next_action',
    risk_text: 'La próxima gestión está vencida hace 4 días.',
    action_text: defaultAction,
    contextualAction: {
      issue_code: 'next_action', title: 'Retomar conversación', description: contextualDescription,
      evidence_refs: ['evidence:interaction:1'],
    },
  }],
});
assert.ok(alertsHtml.includes('Actualizar estos datos en el CRM antes de continuar mejora la propuesta que Vig-IA Comercial genera.'));
assert.match(alertsHtml, /<ul>[\s\S]*La próxima gestión está vencida hace 4 días\.[\s\S]*<\/ul>/);
assert.match(alertsHtml, /<h5>Acciones para mejorar la propuesta<\/h5><ol>/);
assert.ok(alertsHtml.includes(contextualDescription));
assert.equal(alertsHtml.includes(defaultAction), false, 'la acción contextual reemplaza la genérica, no la duplica');
assert.equal(alertsHtml.includes('evidence:interaction:1'), false, 'evidence_refs nunca se renderiza');

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
