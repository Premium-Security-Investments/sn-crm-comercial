import type { TendersModuleProps } from './types';

export function TenderTrackingView({ renderLegacy }: TendersModuleProps) {
  return <section className="tender-tracking-view" aria-labelledby="tender-tracking-heading">
    <h2 id="tender-tracking-heading" className="sr-only">Seguimiento</h2>
    {renderLegacy()}
  </section>;
}
