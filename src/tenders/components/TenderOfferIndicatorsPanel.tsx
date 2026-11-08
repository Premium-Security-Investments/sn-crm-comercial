import { useEffect, useState } from 'react';
import { loadTenderOfferIndicators } from '../api';
import type { TenderOfferIndicators, TenderRequest } from '../types';

/**
 * Indicadores de ofertas (encargo AGT-002 del 2026-11-07): por mes y en lo que va del año, en hora de Colombia, y el
 * avance del valor concursado contra la meta anual. Valor concursado = presupuesto oficial de los procesos presentados.
 */
const pesos = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', notation: 'compact', maximumFractionDigits: 1 }).format(value);
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function TenderOfferIndicatorsPanel({ request }: { request: TenderRequest }) {
  const [data, setData] = useState<TenderOfferIndicators | null>(null);
  const [year, setYear] = useState<number | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void loadTenderOfferIndicators(request, year).then(payload => { if (active) setData(payload); }, () => undefined);
    return () => { active = false; };
  }, [request, year]);
  if (!data) return null;
  const { ytd, goal } = data;
  return <details className="card stack tender-offer-indicators" open>
    <summary><strong>Ofertas {data.year}</strong>{' '}<span className="muted">· {ytd.presentadas} presentadas · {pesos(ytd.valor_concursado)} concursado{goal ? ` · ${goal.progress}% de la meta` : ''}</span></summary>
    <div className="row-actions">
      <label className="muted">Año <select value={data.year} onChange={event => setYear(Number(event.target.value))}>{[data.year - 1, data.year, data.year + 1].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    </div>
    <dl className="tender-offer-indicators-ytd">
      <div><dt>Calificadas</dt><dd>{ytd.calificadas}</dd></div>
      <div><dt>GO</dt><dd>{ytd.go}</dd></div>
      <div><dt>Presentadas</dt><dd>{ytd.presentadas}</dd></div>
      <div><dt>Valor concursado</dt><dd>{pesos(ytd.valor_concursado)}</dd></div>
      <div><dt>Adjudicadas</dt><dd>{ytd.adjudicadas}</dd></div>
      <div><dt>Valor adjudicado</dt><dd>{pesos(ytd.valor_adjudicado)}</dd></div>
      {goal && <div><dt>Meta del año</dt><dd>{pesos(goal.target_value)} · {goal.progress}%</dd></div>}
    </dl>
    {goal && <progress max={100} value={Math.min(100, goal.progress)} aria-label={`Avance contra la meta: ${goal.progress}%`} />}
    <div className="tender-offer-indicators-scroll"><table className="tender-offer-indicators-table">
      <thead><tr><th scope="col">Mes</th><th scope="col">Calificadas</th><th scope="col">GO</th><th scope="col">Presentadas</th><th scope="col">Valor concursado</th><th scope="col">Adjudicadas</th><th scope="col">Valor adjudicado</th></tr></thead>
      <tbody>{data.months.map(row => <tr key={row.month}><th scope="row">{MONTHS[Number(row.month.slice(5, 7)) - 1]}</th><td>{row.calificadas}</td><td>{row.go}</td><td>{row.presentadas}</td><td>{pesos(row.valor_concursado)}</td><td>{row.adjudicadas}</td><td>{pesos(row.valor_adjudicado)}</td></tr>)}</tbody>
    </table></div>
    <small className="muted">Calificadas: licitaciones que pasaron a Oportunidades. Valor concursado: presupuesto oficial de los procesos presentados.</small>
  </details>;
}
