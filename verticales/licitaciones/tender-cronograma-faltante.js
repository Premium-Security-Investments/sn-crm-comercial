// F17 (auditoría del piloto Fiscalía; Juan, 2026-11-09, opción A2): cuando la entidad deja el cronograma sólo en el
// formulario electrónico de SECOP II («el cronograma será el asignado en la plataforma»), ningún documento lo trae y el
// análisis no tiene la fecha de observaciones. Pasó en la Rama de Pereira: vencía el 6-nov y se supo el 5-nov. Las
// tareas del expediente sólo existen después del GO y esta fecha vence antes, así que es un aviso: en Mi día y en la
// licitación, hasta que se sube «Información del procedimiento» y el análisis encuentra la fecha.

const OBSERVATION_KINDS = new Set(['OBSERVATIONS', 'PROJECT_OBSERVATIONS']);

/** ¿El análisis listo no trae ninguna fecha de observaciones (al proyecto o al pliego)? Sin análisis, no se afirma nada. */
export function cronogramaFaltante(report) {
  if (!report || !Array.isArray(report.deadlines)) return false;
  return !report.deadlines.some(deadline => OBSERVATION_KINDS.has(String(deadline?.kind || '')));
}

export const CRONOGRAMA_FALTANTE_TEXTO = 'Falta el cronograma: el análisis no encontró la fecha de observaciones. Imprima en PDF la página «Información del procedimiento» de SECOP II y súbala en Documentos como «De la entidad»; Vig-IA la lee y este aviso se va solo.';
