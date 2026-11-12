// Estudios de Seguridad Física: comparación con el estudio anterior de la sede (migración 212; Juan, 2026-11-12).
// Héctor: quien revisa compara "qué riesgos y cómo se movieron" frente al estudio anterior, y si el cliente aplicó lo
// recomendado. El anterior se toma solo al crear el estudio (el último aprobado del mismo cliente y sede).
import { useState } from 'react';
import { NIVEL_LABELS, updateStudy, type Comparison } from './api';

const CHANGE: Record<string, { text: string; tone: string }> = {
  sube: { text: 'Sube', tone: 'inaceptable' }, nuevo: { text: 'Nuevo', tone: 'tolerable' }, ya_no_esta: { text: 'Ya no está', tone: 'tolerable' },
  igual: { text: 'Igual', tone: 'aceptable' }, baja: { text: 'Baja', tone: 'aceptable' },
};
const STATUS: Record<string, string> = { pendiente: 'Pendiente', en_curso: 'En curso', cumplida: 'Cumplida', descartada: 'Descartada' };
const fmtDate = (value: string | null | undefined) => (value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`)) : '—');

export function ComparisonPanel({ studyId, comparison, editable, onChanged }: { studyId: string; comparison: Comparison; editable: boolean; onChanged: () => void }) {
  const [error, setError] = useState('');
  const r = comparison.resumen;
  const pending = comparison.recomendaciones.filter(item => item.estado === 'pendiente' || item.estado === 'en_curso');
  const level = (item: Comparison['rows'][number]['actual']) => (item ? `${item.magnitud} · ${NIVEL_LABELS[item.nivel]}` : '—');
  const unlink = async () => {
    if (!window.confirm('¿Dejar de comparar con este estudio?')) return;
    try { await updateStudy(studyId, { previous_study_id: null }); onChanged(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo.'); }
  };
  return <section className="es-card es-comparison" aria-label="Comparación con el estudio anterior">
    <div className="es-section-head">
      <h3>Comparación con el estudio anterior</h3>
      {editable ? <button type="button" className="es-link" onClick={() => void unlink()}>No comparar</button> : null}
    </div>
    <p className="es-muted">Frente a {comparison.estudio.codigo} · {comparison.estudio.titulo} (versión {comparison.estudio.version}, aprobado el {fmtDate(comparison.estudio.aprobado)}).{comparison.mismaMetodologia ? '' : ' Usó otra metodología: se compara el nivel, no la magnitud.'}</p>
    <p>{(['sube', 'nuevo', 'ya_no_esta', 'igual', 'baja'] as const).map(state => <span key={state} className={`es-nivel es-nivel-${CHANGE[state].tone}`} style={{ marginRight: 6 }}>{r[state]} {CHANGE[state].text.toLowerCase()}</span>)}</p>
    {comparison.rows.length ? <div className="tablewrap"><table>
      <thead><tr><th>Riesgo</th><th>Antes</th><th>Ahora</th><th>Cambio</th></tr></thead>
      <tbody>{comparison.rows.map((row, index) => <tr key={index}>
        <td>{row.actual ? `R${row.actual.numero} · ${row.actual.titulo}` : `${row.anterior?.titulo} (antes R${row.anterior?.numero})`}</td>
        <td>{level(row.anterior)}</td><td>{level(row.actual)}</td>
        <td><span className={`es-nivel es-nivel-${CHANGE[row.estado].tone}`}>{CHANGE[row.estado].text}</span></td>
      </tr>)}</tbody>
    </table></div> : null}
    {comparison.recomendaciones.length ? <details open={pending.length > 0}>
      <summary>Recomendaciones del estudio anterior ({pending.length} sin cumplir de {comparison.recomendaciones.length})</summary>
      <ul className="es-history">{comparison.recomendaciones.map((item, index) => <li key={index}>
        {item.riesgo} · {item.accion} <small className="es-muted">· a cargo {item.a_cargo === 'cliente' ? 'del cliente' : 'de Seguridad Nacional'}{item.fecha ? ` · para el ${fmtDate(item.fecha)}` : ''} · hoy: {STATUS[item.estado] || item.estado}</small>
      </li>)}</ul>
    </details> : null}
    {error ? <p className="es-error" role="alert">{error}</p> : null}
  </section>;
}
