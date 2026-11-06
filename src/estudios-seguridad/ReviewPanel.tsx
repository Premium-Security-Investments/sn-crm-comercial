// Estudios de Seguridad Física, tramo 9: lo que el revisor de inconsistencias encontró en el estudio. Reglas fijas que
// sólo leen: no cambian estados, calificaciones ni textos. Lo que "bloquea" es lo mismo que impide enviar a revisión.
import type { Review } from './api';

export function ReviewPanel({ review }: { review: Review }) {
  if (!review.total) return <section className="es-card es-review" aria-label="Revisión automática"><p className="es-muted">Revisión automática: no encontró inconsistencias.</p></section>;
  const blocking = review.findings.filter(item => item.severity === 'bloquea');
  const toCheck = review.findings.filter(item => item.severity === 'revisar');
  return <section className="es-card es-review" aria-label="Revisión automática">
    <h3>Revisión automática</h3>
    <p className="es-muted">El sistema señala; no cambia nada. Quien prepara corrige y quien revisa decide si algo de esto es un error.</p>
    {blocking.length ? <div>
      <span className="es-label">Impide enviar a revisión</span>
      <ul className="es-review-list es-review-block">{blocking.map((item, index) => <li key={`b${index}`}>{item.message}</li>)}</ul>
    </div> : null}
    {toCheck.length ? <div>
      <span className="es-label">Para revisar ({toCheck.length})</span>
      <ul className="es-review-list">{toCheck.map((item, index) => <li key={`r${index}`}>{item.message}</li>)}</ul>
    </div> : null}
  </section>;
}
