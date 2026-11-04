// AGT-003 — de dónde viene la venta: cliente nuevo, renovación o servicio nuevo (Juan, 2026-11-03).
//
// Tablero de gerencia, pregunta 1: renovar lo que ya tenemos y vender algo nuevo a un cliente actual son esfuerzos
// distintos, y sumarlos juntos esconde si el crecimiento viene de clientes nuevos o de no perder los que hay.
// Ventas = ganadas en el año (por la fecha de aprobación; si falta, la de registro); pipeline = abiertas. Sin licitaciones.
import { isAgt003CommercialOpportunity } from './commercial-scope.js';
import { isTerminalStage } from './opportunity-decision-rules.js';

export const DEAL_MIX_ROWS = Object.freeze([
  ['cliente_nuevo', 'Cliente nuevo'],
  ['renovacion', 'Cliente actual · Renovación'],
  ['servicio_nuevo', 'Cliente actual · Servicio nuevo'],
  ['actual_sin_clasificar', 'Cliente actual · Sin clasificar'],
  ['sin_tipo', 'Sin tipo de cliente'],
]);

export function dealMixKey(o) {
  if (o?.customer_segment === 'cliente_nuevo') return 'cliente_nuevo';
  if (o?.customer_segment === 'cliente_actual') {
    return o.client_deal_type === 'renovacion' || o.client_deal_type === 'servicio_nuevo' ? o.client_deal_type : 'actual_sin_clasificar';
  }
  return 'sin_tipo';
}

/** `[{ key, label, sales, salesCount, pipeline, pipelineCount }]` en el orden de DEAL_MIX_ROWS, sin filas vacías. */
export function dealMix(opportunities = [], year) {
  const rows = new Map(DEAL_MIX_ROWS.map(([key, label]) => [key, { key, label, sales: 0, salesCount: 0, pipeline: 0, pipelineCount: 0 }]));
  for (const o of opportunities) {
    if (!o || !isAgt003CommercialOpportunity(o) || o.deleted_at) continue;
    const row = rows.get(dealMixKey(o));
    const value = Number(o.offer_value || 0) || 0;
    if (o.stage_code === 'aprobado' && String(o.approved_at || o.created_at || '').slice(0, 4) === String(year)) {
      row.sales += value; row.salesCount += 1;
    } else if (!isTerminalStage(o.stage_code)) {
      row.pipeline += value; row.pipelineCount += 1;
    }
  }
  return [...rows.values()].filter(row => row.salesCount || row.pipelineCount);
}
