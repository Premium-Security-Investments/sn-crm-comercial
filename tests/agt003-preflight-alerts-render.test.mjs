import assert from 'node:assert/strict';
import { loadReactComponent, renderReactComponent } from './helpers/bundle-react-component.mjs';

const VigiaCommercialAlerts = await loadReactComponent('src/vigia/VigiaOpportunityCopilot.tsx', 'VigiaCommercialAlerts');

const emptyAlerts = renderReactComponent(VigiaCommercialAlerts, { alerts: [] });
assert.match(emptyAlerts, /<section[^>]*class="notice vigia-preflight-alerts"[^>]*aria-labelledby="vigia-preflight-title"/);
assert.ok(emptyAlerts.includes('<h4 id="vigia-preflight-title">Alertas comerciales</h4>'));
assert.ok(emptyAlerts.includes('Sin alertas comerciales detectadas.'));
assert.equal(emptyAlerts.includes('<ul>'), false);
assert.equal(emptyAlerts.includes('<ol>'), false);

const countOccurrences = (haystack, needle) => haystack.split(needle).length - 1;

const explanationCopy = 'Señales para tener en cuenta durante el seguimiento. No impiden continuar.';
const riskText = 'La próxima gestión está vencida hace 4 días.';

const alertsHtml = renderReactComponent(VigiaCommercialAlerts, {
  alerts: [{ key: 'next_action:overdue', category: 'next_action', risk_text: riskText }],
});
assert.ok(alertsHtml.includes(explanationCopy), 'usa la explicación coherente de las alertas');
assert.equal(countOccurrences(alertsHtml, riskText), 1, 'cada riesgo se renderiza una sola vez');
assert.equal(alertsHtml.includes('Acciones para mejorar la propuesta'), false, 'no existe un encabezado de acciones genérico');
assert.equal(alertsHtml.includes('<ol>'), false, 'no existe una lista genérica de acciones');
assert.equal(alertsHtml.includes('requieren actualización'), false, 'las alertas no se presentan como instrucciones obligatorias');
assert.equal(alertsHtml.includes('antes de generar'), false, 'las alertas no se presentan como prerrequisitos para generar la propuesta');
assert.equal(alertsHtml.includes('Sugerencia contextual:'), false, 'no existe sugerencia contextual: la etapa de preanálisis se retiró');

console.log('AGT-003 preflight alert render checks passed');
