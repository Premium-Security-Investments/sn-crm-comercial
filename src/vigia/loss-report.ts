// AGT-003 — pérdidas por motivo y por competidor (F5; Juan, 2026-10-22).
//
// Agrupa lo que ya está en la pantalla: sólo las oportunidades perdidas del listado filtrado, con su motivo y, si se
// sabe, el competidor que ganó. Lo que no se sabe se dice: "Sin registrar" y "No se sabe" son filas legítimas, no
// ceros escondidos, porque de las 403 oportunidades sólo 11 tenían motivo cuando esto se construyó.
//
// Módulo puro: no lee red ni base, y no altera lo que recibe.

export type LossRow = {
  id: string;
  stage_code: string;
  offer_value?: number | null;
  loss_reason_name?: string | null;
  loss_reason_code?: string | null;
  competitor_name?: string | null;
};

export type LossGroup = { label: string; count: number; value: number };
export type LossBreakdown = { total: number; value: number; byReason: LossGroup[]; byCompetitor: LossGroup[] };

const SIN_MOTIVO = 'Sin registrar';
const SIN_COMPETIDOR = 'No se sabe';

function group(rows: LossRow[], label: (row: LossRow) => string): LossGroup[] {
  const byLabel = new Map<string, LossGroup>();
  for (const row of rows) {
    const key = label(row);
    const current = byLabel.get(key) || { label: key, count: 0, value: 0 };
    current.count += 1;
    current.value += Number(row.offer_value) || 0;
    byLabel.set(key, current);
  }
  // Más pérdidas primero; a igual cantidad, el de mayor valor; y a igual valor, alfabético para que no baile.
  return [...byLabel.values()].sort((a, b) => b.count - a.count || b.value - a.value || a.label.localeCompare(b.label, 'es'));
}

/** Resumen de las oportunidades perdidas que hay en `rows` (las demás etapas se ignoran). */
export function lossBreakdown(rows: LossRow[] = []): LossBreakdown {
  const lost = rows.filter(row => row?.stage_code === 'perdido');
  return {
    total: lost.length,
    value: lost.reduce((sum, row) => sum + (Number(row.offer_value) || 0), 0),
    byReason: group(lost, row => String(row.loss_reason_name || '').trim() || SIN_MOTIVO),
    byCompetitor: group(lost, row => String(row.competitor_name || '').trim() || SIN_COMPETIDOR),
  };
}
