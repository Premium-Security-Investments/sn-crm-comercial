import { useEffect, useMemo, useRef, useState } from 'react';
import { TENDER_DETAIL_SECTIONS, resolveTenderDetailIndicators } from '../detailNavigationState';
import type { TenderDetailSectionId, TenderDetailStatusSnapshot } from '../detailNavigationState';
import { safePublicTenderSourceUrl } from '../tenderUiState';

type TenderDetailNavigationProps = {
  entity: string;
  sourceUrl?: string | null;
  observations?: string | null;
  expectedCloseDate?: string | null;
  statusSnapshot: TenderDetailStatusSnapshot;
  onBack: () => void;
};

export type TenderDetailValidity = { label: 'Vigente' | 'Vencida'; tone: 'success' | 'danger' };

type FocusableScrollTarget = { scrollIntoView(options?: unknown): void; focus(options?: unknown): void };

/** Lo mínimo que el observer necesita de un contenedor de sección: poder medir su borde superior. */
type MeasurableSectionContainer = { getBoundingClientRect(): { top: number } };

export type TenderDetailSectionObserverEntry<TElement> = {
  target: TElement;
  isIntersecting: boolean;
  intersectionRatio: number;
};

export type TenderDetailSectionObserverHandle<TElement> = {
  observe(target: TElement): void;
  disconnect(): void;
};

export type TenderDetailSectionObserverOptions<TElement extends MeasurableSectionContainer> = {
  resolveElement(id: TenderDetailSectionId): TElement | null;
  onVisibleSection(id: TenderDetailSectionId): void;
  createObserver(
    callback: (entries: ReadonlyArray<TenderDetailSectionObserverEntry<TElement>>) => void,
  ): TenderDetailSectionObserverHandle<TElement>;
};

export type TenderDetailNavigationTargets = {
  resolveElement(id: TenderDetailSectionId): FocusableScrollTarget | null;
  setActiveSection(id: TenderDetailSectionId): void;
};

export type TenderDetailNavigationIntentDependencies = TenderDetailNavigationTargets & {
  focusSection?: (element: FocusableScrollTarget | null) => void;
  realignSection?: (element: FocusableScrollTarget | null) => void;
};

export type TenderDetailNavigationIntent = {
  navigate(id: TenderDetailSectionId): void;
  onObservedSection(id: TenderDetailSectionId): void;
  onLayoutChanged(): void;
  releaseForExplicitUserInteraction(): void;
  dispose(): void;
};

export function resolveTenderSourceUrl(sourceUrl?: string | null, observations?: string | null) {
  const structured = safePublicTenderSourceUrl(sourceUrl);
  if (structured) return structured;
  const historical = String(observations || '').match(/Link fuente:\s*(https?:\/\/\S+)/i)?.[1] || null;
  return safePublicTenderSourceUrl(historical);
}

export function resolveTenderValidity(expectedCloseDate?: string | null): TenderDetailValidity {
  const [year, month, day] = String(expectedCloseDate || '').slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return { label: 'Vigente', tone: 'success' };
  const today = new Date();
  const remaining = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86_400_000);
  return remaining < 0 ? { label: 'Vencida', tone: 'danger' } : { label: 'Vigente', tone: 'success' };
}

export function resolveInitialTenderDetailSection(hash: string): TenderDetailSectionId {
  const requested = new URLSearchParams(hash.split('?')[1] || '').get('section');
  return TENDER_DETAIL_SECTIONS.find(section => section.id === requested)?.id || 'tender-summary';
}

export function resolveMostVisibleTenderSection(
  sectionIds: readonly TenderDetailSectionId[],
  ratios: Map<TenderDetailSectionId, number>,
  tops: Map<TenderDetailSectionId, number>,
): TenderDetailSectionId | undefined {
  return sectionIds
    .map(id => ({ id, ratio: ratios.get(id) || 0, top: tops.get(id) ?? Number.POSITIVE_INFINITY }))
    .filter(item => item.ratio > 0)
    .sort((a, b) => b.ratio - a.ratio || Math.abs(a.top) - Math.abs(b.top))[0]?.id;
}

export function focusTenderDetailSection(element?: FocusableScrollTarget | null) {
  if (!element) return;
  element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  element.focus({ preventScroll: true });
}

export function realignTenderDetailSection(element?: FocusableScrollTarget | null) {
  element?.scrollIntoView({ behavior: 'auto', block: 'start' });
}

/**
 * Conserva una selección explícita mientras el DOM del expediente se estabiliza. El observer
 * sigue actualizando la navegación durante lectura normal, pero no puede reemplazar una intención
 * de botón hasta que la persona vuelve a interactuar fuera de la barra de navegación.
 */
export function createTenderDetailNavigationIntent({
  resolveElement,
  setActiveSection,
  focusSection = focusTenderDetailSection,
  realignSection = realignTenderDetailSection,
}: TenderDetailNavigationIntentDependencies): TenderDetailNavigationIntent {
  let intendedSection: TenderDetailSectionId | null = null;

  return {
    navigate(id) {
      intendedSection = id;
      setActiveSection(id);
      focusSection(resolveElement(id));
    },
    onObservedSection(id) {
      if (!intendedSection) setActiveSection(id);
    },
    onLayoutChanged() {
      if (intendedSection) realignSection(resolveElement(intendedSection));
    },
    releaseForExplicitUserInteraction() {
      intendedSection = null;
    },
    dispose() {
      intendedSection = null;
    },
  };
}

/**
 * Observa los contenedores hermanos reales de las seis secciones canónicas y sincroniza la sección
 * visible. El navegador entrega sólo los contenedores cuya intersección cambió, por eso la
 * visibilidad se acumula por contenedor: un lote parcial no puede borrar la sección visible.
 * Las dependencias se inyectan para poder probar el comportamiento sin DOM.
 */
export function createTenderDetailSectionObserver<TElement extends MeasurableSectionContainer>(
  { resolveElement, onVisibleSection, createObserver }: TenderDetailSectionObserverOptions<TElement>,
): (() => void) | undefined {
  const sections = TENDER_DETAIL_SECTIONS
    .map(section => ({ id: section.id, element: resolveElement(section.id) }))
    .filter((section): section is { id: TenderDetailSectionId; element: TElement } => Boolean(section.element));
  if (!sections.length) return undefined;
  const visibility = new Map<TElement, number>(sections.map(section => [section.element, 0]));
  const observer = createObserver(entries => {
    for (const entry of entries) visibility.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
    const ratios = new Map<TenderDetailSectionId, number>();
    const tops = new Map<TenderDetailSectionId, number>();
    for (const section of sections) {
      ratios.set(section.id, visibility.get(section.element) || 0);
      tops.set(section.id, section.element.getBoundingClientRect().top);
    }
    const visible = resolveMostVisibleTenderSection(sections.map(section => section.id), ratios, tops);
    if (visible) onVisibleSection(visible);
  });
  sections.forEach(section => observer.observe(section.element));
  return () => observer.disconnect();
}

/**
 * Navegar a una sección: sincroniza el estado (y con él `aria-current`), desplaza y enfoca el
 * contenedor con `tabIndex=-1`. Nunca preselecciona un control interno de la sección.
 */
export function openTenderDetailSection(
  id: TenderDetailSectionId,
  { resolveElement, setActiveSection }: TenderDetailNavigationTargets,
) {
  setActiveSection(id);
  focusTenderDetailSection(resolveElement(id));
}

export function TenderDetailNavigation({ entity, sourceUrl, observations, expectedCloseDate, statusSnapshot, onBack }: TenderDetailNavigationProps) {
  const officialUrl = resolveTenderSourceUrl(sourceUrl, observations);
  const validity = resolveTenderValidity(expectedCloseDate);
  const [activeSection, setActiveSection] = useState<TenderDetailSectionId>(() => typeof window === 'undefined' ? 'tender-summary' : resolveInitialTenderDetailSection(window.location.hash));
  const indicators = useMemo(() => resolveTenderDetailIndicators(statusSnapshot), [statusSnapshot]);
  const navigationRootRef = useRef<HTMLDivElement | null>(null);
  const navigationIntentRef = useRef<TenderDetailNavigationIntent | null>(null);
  if (!navigationIntentRef.current) {
    navigationIntentRef.current = createTenderDetailNavigationIntent({
      resolveElement: id => document.getElementById(id),
      setActiveSection,
    });
  }
  const navigationIntent = navigationIntentRef.current;

  useEffect(() => {
    if (activeSection !== 'tender-summary') focusTenderDetailSection(document.getElementById(activeSection));
    // Only the mount-time hash/anchor deep link should steal focus; later section changes are user-driven via scrollTo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    return createTenderDetailSectionObserver<Element>({
      resolveElement: id => document.getElementById(id),
      onVisibleSection: navigationIntent.onObservedSection,
      createObserver: callback => new IntersectionObserver(
        entries => callback(entries),
        { rootMargin: '-20% 0px -65% 0px', threshold: [0, 0.1, 0.5] },
      ),
    });
  }, [navigationIntent]);

  useEffect(() => {
    const onLayoutChanged = () => navigationIntent.onLayoutChanged();
    const detailRoot = document.getElementById('tender-summary')?.closest('.stack') || document.getElementById('tender-summary')?.parentElement;
    let resizeObserver: ResizeObserver | undefined;
    if (detailRoot && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(onLayoutChanged);
      resizeObserver.observe(detailRoot);
    }
    window.addEventListener('resize', onLayoutChanged);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', onLayoutChanged);
    };
  }, [navigationIntent]);

  useEffect(() => {
    const releaseOutsideNavigation = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node) || !navigationRootRef.current?.contains(target)) {
        navigationIntent.releaseForExplicitUserInteraction();
      }
    };
    const releaseForNavigationKey = (event: KeyboardEvent) => {
      if (['Tab', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) {
        navigationIntent.releaseForExplicitUserInteraction();
      }
    };
    window.addEventListener('wheel', releaseOutsideNavigation, { passive: true });
    window.addEventListener('touchstart', releaseOutsideNavigation, { passive: true });
    window.addEventListener('pointerdown', releaseOutsideNavigation, { passive: true });
    window.addEventListener('keydown', releaseForNavigationKey);
    return () => {
      window.removeEventListener('wheel', releaseOutsideNavigation);
      window.removeEventListener('touchstart', releaseOutsideNavigation);
      window.removeEventListener('pointerdown', releaseOutsideNavigation);
      window.removeEventListener('keydown', releaseForNavigationKey);
      navigationIntent.dispose();
    };
  }, [navigationIntent]);

  return <div ref={navigationRootRef} className="tender-detail-navigation">
    <button type="button" className="link-button tender-detail-back" onClick={onBack}>← Oportunidades</button>
    <div className="tender-detail-entity-group">
      <strong className="tender-detail-entity" title={entity || 'Expediente'}>{entity || 'Expediente'}</strong>
      <span className={`badge badge-${validity.tone} tender-detail-validity`}>{validity.label}</span>
    </div>
    <nav className="tender-detail-sections" aria-label="Secciones del expediente">
      {TENDER_DETAIL_SECTIONS.map(({ id, label, accessibleLabel }) => {
        const indicator = indicators[id];
        const accessibleState = indicator ? ` Estado: ${indicator.label}.` : '';
        return <button
          type="button"
          key={id}
          className="tender-detail-section"
          aria-current={activeSection === id ? 'location' : undefined}
          aria-label={`${accessibleLabel}.${accessibleState}`}
          title={indicator?.label}
          onClick={() => navigationIntent.navigate(id)}
        >
          {indicator && <span className={`tender-detail-indicator tone-${indicator.tone}`} aria-hidden="true" />}
          <span>{label}</span>
        </button>;
      })}
    </nav>
    {officialUrl && <a className="tender-detail-source" aria-label="Abrir fuente oficial en una pestaña nueva" href={officialUrl} target="_blank" rel="noreferrer">Fuente oficial <span aria-hidden="true">↗</span></a>}
  </div>;
}
