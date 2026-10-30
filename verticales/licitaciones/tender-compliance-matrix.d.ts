// Sólo lo que el navegador importa de este módulo: el serializador de la matriz a CSV. El resto del módulo lo usa el
// servidor, donde no hace falta declaración.
export function tenderComplianceMatrixCsv(
  headers: readonly string[],
  table: readonly (readonly string[])[],
  options?: { separator?: string; bom?: boolean },
): string;
