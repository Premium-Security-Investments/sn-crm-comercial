export const PUBLIC_ACTUATION_TYPES = [
  'requirement_pending',
  'information_requested',
  'addendum_reviewed',
  'observation_recorded',
  'internal_meeting',
  'case_note',
];

export function assertPublicActuationType(type) {
  if (!PUBLIC_ACTUATION_TYPES.includes(type)) {
    const error = new Error('Tipo de actuación no permitido para el expediente público de la licitación.');
    error.status = 400;
    throw error;
  }
}
