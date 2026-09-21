export const REGIONAL_OPTIONS = Object.freeze([
  'Nariño', 'Cauca', 'Valle del cauca', 'Caldas', 'Risaralda', 'Quindio',
  'Cundinamarca', 'Antioquia', 'Magdalena', 'Bolívar', 'Cesar', 'Sucre',
  'Atlántico', 'Guajira',
]);

export function isValidRegionalOption(value) {
  return REGIONAL_OPTIONS.includes(value);
}

export function regionalForOpportunityWrite(value, existingRegional = null) {
  if (
    typeof value === 'string' &&
    typeof existingRegional === 'string' &&
    value === existingRegional &&
    value.trim()
  ) {
    return value;
  }

  const trimmed = typeof value === 'string' ? value.trim() : value;
  if (!trimmed) {
    throw new Error('La regional es obligatoria.');
  }

  const catalogMatch = REGIONAL_OPTIONS.find((option) => option === trimmed);
  if (catalogMatch) {
    return catalogMatch;
  }

  throw new Error('Seleccione una regional válida.');
}
