// AGT-003 — reglas puras del Dashboard comercial. Cada cifra que el tablero repite en varias tarjetas se calcula aquí
// una sola vez, para que la misma pregunta no tenga dos respuestas distintas en la misma pantalla.

export type DashboardOpportunity = {
  owner_id?: string | null;
  regional_nombre?: string | null;
  offer_value?: number | string | null;
  customer_segment?: string | null;
  next_action_at?: string | null;
  stage_code?: string | null;
};

export type DashboardGoal = { user_id?: string | null; regional_nombre?: string | null };

type Normalize = (value?: string | null) => string;

const NO_REGIONAL = 'Regional pendiente';

/**
 * Una sola regional por comercial, la misma en todas las tablas: la de su meta cuando la tiene; si no, la regional
 * más frecuente (ya normalizada) entre sus oportunidades. Empates: orden alfabético, para que no cambie entre cargas.
 */
export function ownerRegionalMap<T extends DashboardOpportunity>(rows: T[], goals: DashboardGoal[], normalize: Normalize, ownerKey: (row: T) => string): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const regional = normalize(row.regional_nombre);
    if (!regional) continue;
    const key = ownerKey(row);
    const byRegional = counts.get(key) || new Map<string, number>();
    byRegional.set(regional, (byRegional.get(regional) || 0) + 1);
    counts.set(key, byRegional);
  }
  const result = new Map<string, string>();
  for (const [owner, byRegional] of counts) {
    const [top] = [...byRegional.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
    result.set(owner, top[0]);
  }
  for (const goal of goals) {
    const regional = normalize(goal.regional_nombre);
    if (goal.user_id && regional && regional.toLowerCase() !== 'todas') result.set(goal.user_id, regional);
  }
  return result;
}

export function regionalOf(map: Map<string, string>, ownerId: string): string {
  return map.get(ownerId) || NO_REGIONAL;
}

/** Cumplimiento individual: sólo existe si el comercial tiene meta propia. Sin meta no hay porcentaje (null). */
export function compliancePct(approved: number, budget: number): number | null {
  return budget > 0 ? Math.round((approved / budget) * 100) : null;
}

/**
 * Salud comercial 0–100, explicable en una frase: 60% agenda al día (oportunidades activas con próxima gestión
 * vigente) + 40% cumplimiento de su meta (tope 100%). Sin meta, la salud es sólo la agenda al día.
 */
export function commercialHealthScore({ active, managed, compliance }: { active: number; managed: number; compliance: number | null }): number {
  const agenda = active > 0 ? (managed / active) * 100 : 100;
  const score = compliance === null ? agenda : agenda * 0.6 + Math.min(Math.max(compliance, 0), 100) * 0.4;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export const HEALTH_SCORE_EXPLANATION = 'Salud = 60% agenda al día + 40% cumplimiento de la meta propia. Sin meta cargada, sólo cuenta la agenda al día.';

/** Qué le falta a las oportunidades activas para que las cifras del tablero sean completas. */
export function dataQualitySummary(activeRows: DashboardOpportunity[], normalize: Normalize) {
  const missingValue = activeRows.filter(row => !(Number(row.offer_value || 0) > 0)).length;
  const missingSegment = activeRows.filter(row => !row.customer_segment).length;
  const missingRegional = activeRows.filter(row => !normalize(row.regional_nombre)).length;
  const issues = [
    missingValue ? `${missingValue} sin valor` : '',
    missingSegment ? `${missingSegment} sin tipo de cliente` : '',
    missingRegional ? `${missingRegional} sin regional` : '',
  ].filter(Boolean);
  return { missingValue, missingSegment, missingRegional, total: activeRows.length, complete: issues.length === 0, summary: issues.length ? issues.join(' · ') : 'Datos completos' };
}

/**
 * Los trimestres del año en curso hasta el actual (0 = T1). Cuatro columnas como máximo: la tabla de ventas cabe en
 * pantalla durante todo el año en vez de crecer mes a mes y cortarse a la derecha.
 */
export function elapsedQuarters(now: Date): number[] {
  return Array.from({ length: Math.floor(now.getMonth() / 3) + 1 }, (_, index) => index);
}

/** Lista legible de nombres: todos si son pocos; si no, los primeros y "y N más". Nunca un número que no cuadre. */
export function namesSummary(names: string[], max = 3): string {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} y ${names.length - max} más`;
}
