// AGT-003 — presentación pura de la ficha comercial (no licitatoria).
//
// Todo el cálculo temporal de la ficha vive aquí y arranca del MISMO corte: el inicio del día de
// calendario. `daysSince` en `main.tsx` medía desde el inicio de hoy hasta el INSTANTE del dato,
// mientras que el estado de próxima gestión comparaba días de calendario; la misma fecha fuente
// podía producir 34 en una tarjeta y 35 en otra. Aquí no hay dos referencias posibles.
//
// Ninguna de estas funciones altera fechas fuente, payloads ni objetos recibidos: sólo derivan
// texto y clases visuales.

import { parseDateOnly } from '../dateOnly';
import { followUpInteractionTypeLabel, type FollowUpInteraction } from '../opportunity-followup-presentation.js';

const DAY_MS = 86_400_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TERMINAL_STAGES = ['aprobado', 'perdido', 'descartado'];

export type FichaCardTone = 'ok' | 'neutral' | 'attention' | 'critical';
export type FichaCardState = {
  code: string;
  label: string;
  detail: string;
  tone: FichaCardTone;
  className: string;
};

const TONE_CLASS: Record<FichaCardTone, string> = {
  ok: 'is-ok',
  neutral: 'is-neutral',
  attention: 'is-attention',
  critical: 'is-critical',
};

function state(code: string, label: string, detail: string, tone: FichaCardTone): FichaCardState {
  return { code, label, detail, tone, className: TONE_CLASS[tone] };
}

const BOGOTA_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
});
function bogotaDayUtcMs(date: Date): number {
  const [y, m, d] = BOGOTA_DAY.format(date).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// Una columna `date` de Postgres (expected_close_date) es un día de calendario literal; un
// `timestamptz` es un instante y su día de calendario se ancla a America/Bogota (ver `bogotaDayUtcMs`).
function startOfCalendarDay(value?: string | null): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  if (DATE_ONLY.test(trimmed)) {
    const parts = parseDateOnly(trimmed);
    return parts ? Date.UTC(parts.year, parts.month - 1, parts.day) : null;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : bogotaDayUtcMs(parsed);
}

/** Días de calendario transcurridos desde `value` hasta `now`, en America/Bogota. Positivo = pasado. */
export function calendarDaysBetween(value?: string | null, now: Date = new Date()): number | null {
  const from = startOfCalendarDay(value);
  if (from === null) return null;
  return Math.round((bogotaDayUtcMs(now) - from) / DAY_MS);
}

/** `1 día` / `N días`. Nunca `día(s)`. */
export function humanDayCount(days: number): string {
  const count = Math.abs(days);
  return count === 1 ? '1 día' : `${count} días`;
}

export function followUpAgeLabel(value?: string | null, now: Date = new Date()): string {
  const days = calendarDaysBetween(value, now);
  if (days === null) return 'Sin registro';
  if (days <= 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  return `Hace ${humanDayCount(days)}`;
}

type NextActionInput = { stage_code?: string | null; next_action_at?: string | null };

export function nextActionCardState(opportunity: NextActionInput, now: Date = new Date()): FichaCardState {
  if (TERMINAL_STAGES.includes(opportunity.stage_code || '')) {
    return state('closed', 'Cerrada', 'No requiere próxima gestión', 'ok');
  }
  const days = calendarDaysBetween(opportunity.next_action_at, now);
  if (days === null) return state('missing', 'Sin agenda', 'Programe la próxima gestión', 'critical');
  if (days > 0) return state('overdue', 'Vencida', `Vencida hace ${humanDayCount(days)}`, 'critical');
  if (days === 0) return state('today', 'Hoy', 'Gestionar hoy', 'attention');
  const remaining = Math.abs(days);
  if (remaining <= 3) return state('soon', 'Próxima', `En ${humanDayCount(remaining)}`, 'attention');
  return state('scheduled', 'Agendada', `En ${humanDayCount(remaining)}`, 'ok');
}

export function expectedCloseCardState(value?: string | null, now: Date = new Date()): FichaCardState {
  const days = calendarDaysBetween(value, now);
  if (days === null) return state('missing', 'Sin fecha', 'Sin fecha de cierre', 'attention');
  if (days > 0) return state('overdue', 'Vencido', `Vencido hace ${humanDayCount(days)}`, 'critical');
  if (days === 0) return state('today', 'Hoy', 'Cierra hoy', 'attention');
  return state('scheduled', 'Vigente', `En ${humanDayCount(days)}`, 'ok');
}

type DecisionMakerInput = { name?: string | null; email?: string | null; phone?: string | null };

export function decisionMakerCardState({ name, email, phone }: DecisionMakerInput): FichaCardState {
  const filled = (value?: string | null) => String(value ?? '').trim().length > 0;
  if (!filled(name) && !filled(email) && !filled(phone)) {
    return state('pending', 'Por completar', 'Complete el contacto decisor', 'attention');
  }
  const missing = [!filled(email) ? 'correo' : '', !filled(phone) ? 'teléfono' : '', !filled(name) ? 'nombre' : '']
    .filter(Boolean);
  if (!missing.length) return state('complete', 'Verificado', 'Contacto verificado', 'ok');
  const detail = missing.length === 1 ? `Falta ${missing[0]}` : `Falta ${missing.slice(0, -1).join(', ')} y ${missing[missing.length - 1]}`;
  return state('partial', 'Incompleto', detail, 'attention');
}

// --- historial de seguimiento -------------------------------------------------------------------
//
// Los registros migrados llegan con el prefijo técnico `Seguimiento migrado:` y con el tipo real
// escrito dentro del propio texto. La ficha muestra el tipo inferido, el autor `Migrado / sistema`
// y el contenido original útil. El objeto fuente (texto y fecha) no se toca en ningún caso.

const MIGRATED_PREFIX = /^\s*seguimiento\s+migrado\s*[:\-–—]?\s*/i;
const MIGRATED_AUTHOR = 'Migrado / sistema';
const INFERRED_TYPES: Array<[RegExp, string]> = [
  [/^correos?(\s+electr[óo]nicos?)?\b/i, 'Correo'],
  [/^llamadas?\b/i, 'Llamada'],
  [/^reuni[óo]n(es)?\b/i, 'Reunión'],
  [/^visitas?\b/i, 'Reunión'],
  [/^whats\s?app\b/i, 'WhatsApp'],
  [/^notas?\b/i, 'Nota'],
];
const LEADING_SEPARATOR = /^[\s:.\-–—·]+/;

export type FollowUpEntryPresentation = {
  typeLabel: string;
  authorLabel: string;
  content: string;
  occurredAt: string | null;
  migrated: boolean;
};

export function presentFollowUpEntry(entry: FollowUpInteraction): FollowUpEntryPresentation {
  const notes = String(entry?.notes ?? '');
  const authorLabel = String(entry?.actor_label || entry?.psi_sales_profiles?.full_name || '').trim() || MIGRATED_AUTHOR;
  const occurredAt = entry?.occurred_at ?? entry?.created_at ?? null;
  const migrated = MIGRATED_PREFIX.test(notes);
  if (!migrated) {
    return {
      typeLabel: followUpInteractionTypeLabel(entry?.interaction_type),
      authorLabel,
      content: notes.trim(),
      occurredAt,
      migrated: false,
    };
  }
  const stripped = notes.replace(MIGRATED_PREFIX, '').trim();
  const inferred = INFERRED_TYPES.find(([pattern]) => pattern.test(stripped));
  const remainder = inferred ? stripped.replace(inferred[0], '').replace(LEADING_SEPARATOR, '').trim() : '';
  return {
    typeLabel: inferred ? inferred[1] : followUpInteractionTypeLabel(entry?.interaction_type),
    authorLabel,
    content: remainder || stripped,
    occurredAt,
    migrated: true,
  };
}
