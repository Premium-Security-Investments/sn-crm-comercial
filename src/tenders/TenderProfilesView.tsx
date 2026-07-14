import type { TendersModuleProps } from './types';

export function TenderProfilesView({ renderLegacy }: TendersModuleProps) {
  return <section className="tender-profiles-view" aria-labelledby="tender-profiles-heading">
    <h2 id="tender-profiles-heading" className="sr-only">Perfiles de búsqueda</h2>
    {renderLegacy()}
  </section>;
}
