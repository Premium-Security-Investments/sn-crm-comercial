// AGT-002 · Fecha de trabajo de Vig-IA: la de Colombia, no la del reloj del servidor.

const ZONA_DE_TRABAJO = 'America/Bogota';

// F3 (auditoría del piloto Fiscalía, 2026-11-05): a las 20:35 del 4-nov en Colombia la Mesa dijo «hoy es 5 de
// noviembre, el plazo vence hoy», porque sin fecha estampada el modelo toma la de su entorno, que corre en UTC. El
// servidor estampa la fecha de trabajo en hora de Colombia, como estampa las fuentes.
export function agt002FechaDeTrabajo(at = new Date()) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_DE_TRABAJO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at).map(parte => [parte.type, parte.value]));
  return Object.freeze({
    fecha: `${partes.year}-${partes.month}-${partes.day}`,
    hora: `${partes.hour}:${partes.minute}`,
    dia: new Intl.DateTimeFormat('es-CO', { timeZone: ZONA_DE_TRABAJO, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(at),
    zona: `${ZONA_DE_TRABAJO} (UTC-5)`,
  });
}
