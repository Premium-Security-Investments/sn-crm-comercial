import type { TendersModuleProps } from './types';

export function TenderRadarView({ renderLegacy }: TendersModuleProps) {
  return <section className="tender-radar-view" aria-labelledby="tender-radar-heading">
    <h2 id="tender-radar-heading" className="sr-only">Radar de oportunidades</h2>
    {renderLegacy()}
  </section>;
}
