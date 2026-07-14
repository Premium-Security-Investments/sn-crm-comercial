import type { SiioRouteFiltersByView, SiioRouteState, SiioView } from './types';

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
