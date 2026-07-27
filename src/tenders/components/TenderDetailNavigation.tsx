import { useEffect, useMemo, useState } from 'react';
import { TENDER_DETAIL_SECTIONS, resolveTenderDetailIndicators } from '../detailNavigationState';
import type { TenderDetailSectionId, TenderDetailStatusSnapshot } from '../detailNavigationState';
import { safePublicTenderSourceUrl } from '../tenderUiState';

type TenderDetailNavigationProps = {
  entity: string;
  sourceUrl?: string | null;
  observations?: string | null;
  statusSnapshot: TenderDetailStatusSnapshot;
  onBack: () => void;
};

export function resolveTenderSourceUrl(sourceUrl?: string | null, observations?: string | null) {
  const structured = safePublicTenderSourceUrl(sourceUrl);
  if (structured) return structured;
  const historical = String(observations || '').match(/Link fuente:\s*(https?:\/\/\S+)/i)?.[1] || null;
  return safePublicTenderSourceUrl(historical);
}

export function TenderDetailNavigation({ entity, sourceUrl, observations, statusSnapshot, onBack }: TenderDetailNavigationProps) {
  const officialUrl = resolveTenderSourceUrl(sourceUrl, observations);
  const [activeSection, setActiveSection] = useState<TenderDetailSectionId>('tender-summary');
  const indicators = useMemo(() => resolveTenderDetailIndicators(statusSnapshot), [statusSnapshot]);

  useEffect(() => {
    const sections = TENDER_DETAIL_SECTIONS
      .map(section => document.getElementById(section.id))
      .filter((section): section is HTMLElement => Boolean(section));
    if (!sections.length || typeof IntersectionObserver === 'undefined') return;
    const visibility = new Map<HTMLElement, number>(sections.map(section => [section, 0]));
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) visibility.set(entry.target as HTMLElement, entry.isIntersecting ? entry.intersectionRatio : 0);
      const visible = sections
        .map(section => ({ section, ratio: visibility.get(section) || 0 }))
        .filter(item => item.ratio > 0)
        .sort((a, b) => b.ratio - a.ratio || Math.abs(a.section.getBoundingClientRect().top) - Math.abs(b.section.getBoundingClientRect().top));
      const id = visible[0]?.section.id as TenderDetailSectionId | undefined;
      if (id) setActiveSection(id);
    }, { rootMargin: '-20% 0px -65% 0px', threshold: [0, 0.1, 0.5] });
    sections.forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id: TenderDetailSectionId) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return <div className="tender-detail-navigation">
    <button type="button" className="link-button tender-detail-back" onClick={onBack}>← Oportunidades</button>
    <strong className="tender-detail-entity" title={entity || 'Expediente'}>{entity || 'Expediente'}</strong>
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
          onClick={() => scrollTo(id)}
        >
          {indicator && <span className={`tender-detail-indicator tone-${indicator.tone}`} aria-hidden="true" />}
          <span>{label}</span>
        </button>;
      })}
    </nav>
    {officialUrl && <a className="tender-detail-source" aria-label="Abrir fuente oficial en una pestaña nueva" href={officialUrl} target="_blank" rel="noreferrer">Fuente oficial <span aria-hidden="true">↗</span></a>}
  </div>;
}
