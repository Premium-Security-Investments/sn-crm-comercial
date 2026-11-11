// PGlite registra now() con precisión de milisegundos (medido el 2026-11-11: 128 de 199 consultas seguidas con la misma
// hora). Los trabajos de la Mesa y los intentos de análisis leen su estado por el último evento (created_at, y el id
// —uuid al azar— para desempatar). Dos eventos del mismo trabajo en el mismo milisegundo empatan y a veces se lee como
// último el anterior: agt002-workbench-pglite («El claim AGT-002 no existe…») y agt002-canonical-analysis-pglite
// («retry_wait -> running») fallaban al azar en CI. En Postgres la precisión es de microsegundos y no pasa.
// Este envoltorio deja correr el reloj 2 ms antes de cada consulta.
export function withAdvancingClock(db, { ms = 2 } = {}) {
  for (const method of ['query', 'exec']) {
    const original = db[method].bind(db);
    db[method] = async (...args) => { await new Promise(resolve => setTimeout(resolve, ms)); return original(...args); };
  }
  return db;
}
