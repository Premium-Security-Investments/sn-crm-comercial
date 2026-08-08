import type { SiioManagementInsight } from '../siioExecutive';
import type {
  SiioDecision,
  SiioRecord,
  SiioRecommendation,
  SiioRouteFiltersByView,
  SiioRouteState,
  SiioSource,
  SiioTrackingItem,
  SiioView,
} from './types';

const SIIO_VIEWS: readonly SiioView[] = ['resumen', 'seguimiento', 'inteligencia', 'agentes'];

function isSiioView(value: string | null): value is SiioView {
  return SIIO_VIEWS.includes(value as SiioView);
}

export function emptyFiltersForView<View extends SiioView>(view: View): SiioRouteFiltersByView[View] {
  if (view === 'resumen') return { period: '', area: '' } as SiioRouteFiltersByView[View];
  if (view === 'seguimiento') return { kind: 'todos', status: '', semaphore: '', owner: '' } as SiioRouteFiltersByView[View];
  if (view === 'inteligencia') return { period: '', freshness: '', trust: '', sourceType: '' } as SiioRouteFiltersByView[View];
  return { status: '', owner: '' } as SiioRouteFiltersByView[View];
}

export function navigateSiioView<View extends SiioView>(view: View, filters: Partial<SiioRouteFiltersByView[View]> = {}): Extract<SiioRouteState, { view: View }> {
  return { view, filters: { ...emptyFiltersForView(view), ...filters } } as unknown as Extract<SiioRouteState, { view: View }>;
}

export function parseSiioRouteState(hash: string): SiioRouteState {
  const params = new URLSearchParams(hash.split('?')[1] || '');
  const requestedView = params.get('view');
  const view: SiioView = isSiioView(requestedView) ? requestedView : 'resumen';

  if (view === 'resumen') return navigateSiioView(view, { period: params.get('period') || '', area: params.get('area') || '' });
  if (view === 'seguimiento') {
    const kind = params.get('kind');
    const validKind = ['todos', 'decisiones', 'bloqueos', 'riesgos', 'compromisos'].includes(kind || '') ? kind as SiioRouteFiltersByView['seguimiento']['kind'] : 'todos';
    return navigateSiioView(view, { kind: validKind, status: params.get('status') || '', semaphore: params.get('semaphore') || '', owner: params.get('owner') || '' });
  }
  if (view === 'inteligencia') return navigateSiioView(view, { period: params.get('period') || '', freshness: params.get('freshness') || '', trust: params.get('trust') || '', sourceType: params.get('sourceType') || '' });
  return navigateSiioView(view, { status: params.get('status') || '', owner: params.get('owner') || '' });
}

export function toSiioHash(state: SiioRouteState): string {
  const params = new URLSearchParams({ view: state.view });
  for (const [key, value] of Object.entries(state.filters)) {
    if (value) params.set(key, value);
  }
  return `#/siio?${params.toString()}`;
}

function normalizedSubject(value: string | null | undefined): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const TERMINAL_STATUSES = new Set(['cerrado', 'cerrada', 'completado', 'completada', 'resuelto', 'resuelta', 'cancelado', 'cancelada', 'done', 'closed']);

export function isTerminalSiioStatus(status?: string | null): boolean {
  return TERMINAL_STATUSES.has(normalizedSubject(status));
}

const NEGATED_BLOCKER_PREFIXES = ['sin bloqueo', 'sin bloqueos', 'no hay bloqueo', 'no hay bloqueos', 'ningun bloqueo', 'ninguna obstruccion'];

export function isNegatedBlocker(text?: string | null): boolean {
  const normalized = normalizedSubject(text);
  return normalized.length > 0 && NEGATED_BLOCKER_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

type ActivityTimestamps = { dueDate?: string | null; updatedAt?: string | null; createdAt?: string | null };

function isMaterialTimestampChange(updatedAt: string, createdAt: string): boolean {
  const updated = new Date(updatedAt);
  const created = new Date(createdAt);
  if (Number.isNaN(updated.getTime()) || Number.isNaN(created.getTime())) return updatedAt !== createdAt;
  return updated.getTime() !== created.getTime();
}

function activityStateFor(status: string | null | undefined, timestamps: ActivityTimestamps): SiioTrackingItem['activityState'] {
  if (isTerminalSiioStatus(status)) return 'history';
  if (timestamps.dueDate) return 'active';
  if (timestamps.updatedAt) {
    if (!timestamps.createdAt) return 'active';
    if (isMaterialTimestampChange(timestamps.updatedAt, timestamps.createdAt)) return 'active';
    return 'unconfirmed';
  }
  return 'unconfirmed';
}

function trackingKind(value: string | null | undefined): Exclude<SiioTrackingItem['kind'], 'todos'> {
  const normalized = normalizedSubject(value);
  if (normalized === 'compromiso') return 'compromisos';
  if (normalized === 'bloqueo' || normalized === 'bloqueado') return 'bloqueos';
  if (normalized === 'riesgo' || normalized === 'riesgos') return 'riesgos';
  return 'decisiones';
}

export function deriveTrackingItems(records: SiioRecord[], decisions: SiioDecision[]): SiioTrackingItem[] {
  type TrackingCandidate = { item: SiioTrackingItem; source: 'record' | 'decision' };
  const compareText = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;
  const compareCandidates = (left: TrackingCandidate, right: TrackingCandidate) => {
    // Records carry the richer tracking semantics, so they win over equivalent decision rows.
    const sourceOrder = (left.source === 'record' ? 0 : 1) - (right.source === 'record' ? 0 : 1);
    if (sourceOrder) return sourceOrder;
    return compareText(left.item.id, right.item.id)
      || compareText(normalizedSubject(left.item.kind), normalizedSubject(right.item.kind))
      || compareText(normalizedSubject(left.item.title), normalizedSubject(right.item.title))
      || compareText(normalizedSubject(left.item.owner), normalizedSubject(right.item.owner));
  };
  // Canonical identity is the display kind plus normalized subject and owner. A blank subject is not
  // an honest match, so it remains source-specific rather than collapsing unrelated empty rows.
  const identityFor = (candidate: TrackingCandidate) => {
    const title = normalizedSubject(candidate.item.title);
    if (!title) return `${candidate.item.kind}\u0000unidentified\u0000${candidate.source}\u0000${candidate.item.id}`;
    return `${candidate.item.kind}\u0000${title}\u0000${normalizedSubject(candidate.item.owner)}`;
  };
  const recordCandidates = records
    .map((record): TrackingCandidate | null => {
      const title = record.blockers || record.risks || record.decision_required || record.title;
      const kind = record.blockers
        ? 'bloqueos'
        : record.risks
          ? 'riesgos'
          : record.decision_required
            ? 'decisiones'
            : trackingKind(record.record_type);
      if (kind === 'bloqueos' && isNegatedBlocker(record.blockers)) return null;
      const status = record.status || 'Pendiente';
      return {
        source: 'record',
        item: {
          id: `${record.id}:${kind === 'decisiones' ? 'decision' : kind}`,
          kind,
          title,
          owner: record.decision_owner || record.owner || null,
          status,
          semaphore: record.semaforo || '',
          nextAction: record.next_action || null,
          frontId: record.front_id || null,
          sourceIds: record.source_ids || [],
          dueDate: record.due_date || null,
          activityState: activityStateFor(status, { dueDate: record.due_date, updatedAt: record.updated_at, createdAt: record.created_at }),
        },
      };
    })
    .filter((candidate): candidate is TrackingCandidate => candidate !== null);
  const decisionCandidates = decisions.map((decision): TrackingCandidate => {
    const status = decision.status || 'Pendiente';
    return {
      source: 'decision',
      item: {
        id: decision.id,
        kind: trackingKind(decision.item_type),
        title: decision.description,
        owner: decision.owner || null,
        status,
        semaphore: '',
        nextAction: null,
        frontId: null,
        sourceIds: [],
        dueDate: decision.due_date || null,
        activityState: activityStateFor(status, { dueDate: decision.due_date, updatedAt: decision.updated_at, createdAt: decision.created_at }),
      },
    };
  });
  const canonical = new Map<string, TrackingCandidate>();
  for (const candidate of [...recordCandidates, ...decisionCandidates].sort(compareCandidates)) {
    const identity = identityFor(candidate);
    if (!canonical.has(identity)) canonical.set(identity, candidate);
  }
  return [...canonical.values()].sort(compareCandidates).map(candidate => candidate.item);
}

export function filterTrackingItems(items: SiioTrackingItem[], filters: SiioRouteFiltersByView['seguimiento']): SiioTrackingItem[] {
  return items.filter(item => (
    (filters.kind === 'todos' || item.kind === filters.kind)
    && (filters.status ? normalizedSubject(item.status) === normalizedSubject(filters.status) : item.activityState === 'active')
    && (!filters.semaphore || normalizedSubject(item.semaphore) === normalizedSubject(filters.semaphore))
    && (!filters.owner || normalizedSubject(item.owner) === normalizedSubject(filters.owner))
  ));
}

type ExecutiveSnapshot = {
  managementInsights: SiioManagementInsight[];
  financialPeriod: string | null;
  payrollPeriod: string | null;
};

export function deriveRecommendations(snapshot: ExecutiveSnapshot): SiioRecommendation[] {
  return snapshot.managementInsights.map(insight => ({
    ...insight,
    sourceIds: insight.sourceIds?.length ? insight.sourceIds : ['Pendiente de evidencia'],
    period: insight.period ?? snapshot.financialPeriod ?? snapshot.payrollPeriod,
  }));
}

export function sourceFreshness(source: SiioSource, today = new Date()): 'vigente' | 'próxima_a_vencer' | 'vencida' | 'sin_fecha' {
  if (!source.next_review_at) return 'sin_fecha';
  const reviewDate = new Date(source.next_review_at);
  if (Number.isNaN(reviewDate.getTime())) return 'sin_fecha';
  reviewDate.setHours(0, 0, 0, 0);
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);
  if (reviewDate < startOfToday) return 'vencida';
  if (reviewDate.getTime() === startOfToday.getTime()) return 'próxima_a_vencer';
  return 'vigente';
}

export function filterSources(sources: SiioSource[], filters: SiioRouteFiltersByView['inteligencia'], evidenceSourceIds?: string[]): SiioSource[] {
  const evidenceSourceSet = evidenceSourceIds ? new Set(evidenceSourceIds) : null;
  return sources.filter(source => (
    (!evidenceSourceSet || evidenceSourceSet.has(source.id))
    && (!filters.freshness || sourceFreshness(source) === filters.freshness)
    && (!filters.trust || normalizedSubject(source.trust_level) === normalizedSubject(filters.trust))
    && (!filters.sourceType || normalizedSubject(source.source_type) === normalizedSubject(filters.sourceType))
  ));
}

const AVAILABILITY_LABELS: Record<string, string> = {
  activa: 'Disponible',
  activo: 'Disponible',
  inactiva: 'No disponible',
  inactivo: 'No disponible',
};

const VALIDATION_LABELS: Record<string, string> = {
  confiable: 'Validada',
  oficial_requiere_validacion: 'Requiere validación',
  restringida: 'Restringida',
};

const FRESHNESS_ASSESSMENT_LABELS: Record<ReturnType<typeof sourceFreshness>, string> = {
  vigente: 'Vigente',
  próxima_a_vencer: 'Próxima a vencer',
  vencida: 'Revisión vencida',
  sin_fecha: 'Sin fecha de revisión',
};

function formatSiioAssessmentDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

export type SourceAssessment = {
  availability: string;
  review: string;
  freshness: string;
  validation: string;
  applicability: string;
  compliance: string;
};

export function deriveSourceAssessment(source: SiioSource, asOf: Date = new Date()): SourceAssessment {
  const availabilityKey = normalizedSubject(source.status);
  const validationKey = normalizedSubject(source.trust_level);
  return {
    availability: AVAILABILITY_LABELS[availabilityKey] || (source.status ? 'Estado no reconocido' : 'Sin estado registrado'),
    review: source.last_reviewed_at ? `Revisada el ${formatSiioAssessmentDate(source.last_reviewed_at)}` : 'Sin revisión registrada',
    freshness: FRESHNESS_ASSESSMENT_LABELS[sourceFreshness(source, asOf)],
    validation: VALIDATION_LABELS[validationKey] || (source.trust_level ? 'Nivel de confianza no reconocido' : 'Sin nivel de confianza registrado'),
    applicability: 'No registrada',
    compliance: 'No evaluado',
  };
}

export function uniqueOptions(values: Array<string | null | undefined>): string[] {
  const options = new Map<string, string>();
  for (const value of values) {
    const label = String(value || '').trim();
    const normalized = normalizedSubject(label);
    if (normalized && !options.has(normalized)) options.set(normalized, label);
  }
  return [...options.values()].sort((left, right) => left.localeCompare(right, 'es'));
}
