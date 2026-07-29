// Respondedor sintético exclusivo de pruebas para el worker de la Mesa Vig-IA.
// No debe ser importado por ningún archivo fuera de tests/: no hay red ni modelo aquí.
export function createSyntheticAgt002Responder(fixtures) {
  return Object.freeze({
    async respond(input) {
      const fixture = fixtures[input.origin_message_id];
      if (!fixture) throw Object.assign(new Error('Synthetic fixture missing'), { code: 'SYNTHETIC_FIXTURE_MISSING' });
      return structuredClone(fixture);
    },
  });
}
