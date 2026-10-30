import { Badge } from './SiioUi';
import { millions } from './SiioCommercialPanel';
import type { RevenueByClient, RevenueRow } from './revenueByClient';

const periodLabel = (period: string) => {
  const label = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${period}T12:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
};

const shareLabel = (row: RevenueRow) => (row.share === null ? '—' : `${Math.round(row.share * 100)} %`);

function RevenueRows({ rows }: { rows: RevenueRow[] }) {
  return <>{rows.map(row => <tr key={`${row.label}:${row.amount}`} className={row.excluded ? 'siio-row-muted' : undefined}>
    <td><strong>{row.label}</strong>{row.excluded ? <> <Badge tone="amber">Fuera del total</Badge></> : null}</td>
    <td>{millions(row.amount)}</td>
    <td>{shareLabel(row)}</td>
  </tr>)}</>;
}

export function SiioRevenueByClient({ summary, period }: { summary: RevenueByClient | null; period: string }) {
  if (!summary) {
    return <div className="siio-pulse-block">
      <h4>Por facturar por cliente</h4>
      <p className="siio-secondary siio-quiet-empty">
        <strong>Pendiente:</strong> el archivo contable publicado de {period ? periodLabel(period).toLowerCase() : 'el periodo'} no trae la hoja <em>Ingresos</em> con el detalle por tercero.
      </p>
    </div>;
  }
  return <div className="siio-pulse-block">
    <h4>Por facturar por cliente · {periodLabel(summary.period).toLowerCase()}</h4>
    <p className="siio-pulse-footnote">
      Es la provisión de ingresos del mes detallada por tercero en la hoja <em>Ingresos</em> del archivo contable, antes de IVA.
      No es la facturación total de la empresa: los contratos ya facturados en el mes no están en esa hoja.
      El total cuadra contra la provisión declarada en el balance del mes del corte.
    </p>
    {summary.readings.length ? <div className="siio-pulse-readings"><ul>{summary.readings.map(note => <li key={note}>{note}</li>)}</ul></div> : null}
    <div className="siio-table-wrap"><table>
      <thead><tr><th>Tercero</th><th>Valor antes de IVA</th><th>Participación</th></tr></thead>
      <tbody>
        <RevenueRows rows={summary.services} />
        {summary.adjustments.length ? <>
          <tr className="siio-row-section"><td colSpan={3}>Ajustes de meses anteriores</td></tr>
          <RevenueRows rows={summary.adjustments} />
        </> : null}
      </tbody>
      <tfoot><tr><th>Total provisionado</th><th>{millions(summary.total)}</th><th>100 %</th></tr></tfoot>
    </table></div>
  </div>;
}
