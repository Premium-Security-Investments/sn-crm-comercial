import type { TendersModuleProps } from './types';

export function TenderDossiersView({ renderLegacy }: TendersModuleProps) {
  return <section className="tender-dossiers-view" aria-labelledby="tender-dossiers-heading">
    <h2 id="tender-dossiers-heading" className="sr-only">Expedientes</h2>
    {renderLegacy()}
  </section>;
}
