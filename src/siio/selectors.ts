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
  if (view === 'inteligencia') return { freshness: '', trust: '', sourceType: '' } as SiioRouteFiltersByView[View];
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
  if (view === 'inteligencia') return navigateSiioView(view, { freshness: params.get('freshness') || '', trust: params.get('trust') || '', sourceType: params.get('sourceType') || '' });
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

function trackingKind(value: string | null | undefined): Exclude<SiioTrackingItem['kind'], 'todos'> {
  const normalized = normalizedSubject(value);
  if (normalized === 'compromiso') return 'compromisos';
  if (normalized === 'bloqueo' || normalized === 'bloqueado') return 'bloqueos';
  if (normalized === 'riesgo' || normalized === 'riesgos') return 'riesgos';
  return 'decisiones';
}

export function deriveTrackingItems(records: SiioRecord[], decisions: SiioDecision[]): SiioTrackingItem[] {
  const emittedSubjects = new Map<string, string>();
  const recordRows = records.map((record): SiioTrackingItem => {
    const title = record.blockers || record.risks || record.decision_required || record.title;
    const kind = record.blockers
      ? 'bloqueos'
      : record.risks
        ? 'riesgos'
        : record.decision_required
          ? 'decisiones'
          : trackingKind(record.record_type);
    emittedSubjects.set(record.id, normalizedSubject(title));
    return {
      id: `${record.id}:${kind === 'decisiones' ? 'decision' : kind}`,
      kind,
      title,
      owner: record.decision_owner || record.owner || null,
      status: record.status || 'Pendiente',
      semaphore: record.semaforo || '',
      nextAction: record.next_action || null,
      frontId: record.front_id || null,
      sourceIds: record.source_ids || [],
      dueDate: null,
    };
  });

  const decisionRows = decisions.flatMap((decision): SiioTrackingItem[] => {
    if (decision.related_record_id && emittedSubjects.get(decision.related_record_id) === normalizedSubject(decision.description)) return [];
    return [{
      id: decision.id,
      kind: trackingKind(decision.item_type),
      title: decision.description,
      owner: decision.owner || null,
      status: decision.status || 'Pendiente',
      semaphore: '',
      nextAction: null,
      frontId: null,
      sourceIds: [],
      dueDate: decision.due_date || null,
    }];
  });

  return [...recordRows, ...decisionRows];
}

export function filterTrackingItems(items: SiioTrackingItem[], filters: SiioRouteFiltersByView['seguimiento']): SiioTrackingItem[] {
  return items.filter(item => (
    (filters.kind === 'todos' || item.kind === filters.kind)
    && (!filters.status || normalizedSubject(item.status) === normalizedSubject(filters.status))
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
  return snapshot.managementInsights.map(insight => {
    const evidence = normalizedSubject(insight.evidence);
    const financial = evidence.includes('financier');
    const payroll = evidence.includes('nomina');
    return {
      ...insight,
      sourceIds: financial ? ['SRC-011'] : payroll ? ['SRC-012'] : ['Pendiente de evidencia'],
      period: financial ? snapshot.financialPeriod : payroll ? snapshot.payrollPeriod : snapshot.financialPeriod ?? snapshot.payrollPeriod,
    };
  });
}

export function sourceFreshness(source: SiioSource, today = new Date()): 'vigente' | 'próxima_a_vencer' | 'vencida' | 'sin_fecha' {
  if (!source.next_review_at) return 'sin_fecha';
  const reviewDate = new Date(source.next_review_at);
  if (Number.isNaN(reviewDate.getTime())) return 'sin_fecha';
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);
  if (reviewDate < startOfToday) return 'vencida';
  if (reviewDate.getTime() === startOfToday.getTime()) return 'próxima_a_vencer';
  return 'vigente';
}

export function filterSources(sources: SiioSource[], filters: SiioRouteFiltersByView['inteligencia']): SiioSource[] {
  return sources.filter(source => (
    (!filters.freshness || sourceFreshness(source) === filters.freshness)
    && (!filters.trust || normalizedSubject(source.trust_level) === normalizedSubject(filters.trust))
    && (!filters.sourceType || normalizedSubject(source.source_type) === normalizedSubject(filters.sourceType))
  ));
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
