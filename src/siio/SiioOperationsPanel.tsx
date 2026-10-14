import { Badge } from './SiioUi';
import { monthLabel, provisionRate, regionalName, type OperationsFigures, type OperationsSummary } from './operationsSummary';

const count = (value: number) => value.toLocaleString('es-CO');
const rate = (figures: OperationsFigures) => {
  const value = provisionRate(figures);
  return value === null ? '—' : `${Math.round(value * 100)} %`;
};

function extractedLabel(summary: OperationsSummary) {
  if (!summary.extractedAt) return 'fecha de corte por confirmar';
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' }).format(new Date(summary.extractedAt));
}

const STATUS_LABEL = { en_uso: 'En uso', parcial: 'Solo servicio técnico o rondas', en_implementacion: 'En implementación' } as const;
const STATUS_TONE = { en_uso: 'green', parcial: 'amber', en_implementacion: 'blue' } as const;

export function SiioOperationsAttention({ summary }: { summary: OperationsSummary | null }) {
  return <section className="siio-attention-section" aria-label="Operaciones">
    <h3>Operaciones</h3>
    {summary
      ? <div className="siio-pulse-readings"><ul>{summary.readings.map(note => <li key={note}>{note}</li>)}</ul></div>
      : <p className="siio-secondary siio-quiet-empty"><strong>Pendiente:</strong> primera carga de cifras desde SecurityOps.</p>}
  </section>;
}

export function SiioOperationsDetail({ summary }: { summary: OperationsSummary | null }) {
  if (!summary) return <p className="siio-secondary siio-quiet-empty"><strong>Sin cifras de Operaciones cargadas.</strong> Vig-IA Operaciones las trae de SecurityOps.</p>;
  const current = monthLabel(summary.currentMonth);
  const previous = summary.previousMonth ? monthLabel(summary.previousMonth) : null;
  return <>
    <p className="siio-pulse-footnote">
      Fuente: SecurityOps, corte del {extractedLabel(summary)}. {current.charAt(0).toUpperCase() + current.slice(1)} va en curso.
      Cifras solo de las regionales que ya usan SecurityOps; el cliente de cada puesto se deduce de la marca de sus informes y del nombre del puesto (aproximado).
    </p>

    <div className="siio-pulse-block">
      <h4>Por cliente · regionales en uso</h4>
      <div className="siio-table-wrap"><table>
        <thead><tr>
          <th>Cliente</th><th>Puestos</th><th>Visitados en {current}</th><th>Visitas de supervisor</th>
          <th>Aprovisionamiento cumplido</th><th>Visitas técnicas</th><th>Rondas</th><th>Tickets abiertos</th>
          {previous ? <th>Visitas de supervisor en {previous}</th> : null}
          <th>Puestos en regionales en implementación</th>
        </tr></thead>
        <tbody>{summary.clients.map(client => <tr key={client.key}>
          <td><strong>{client.label}</strong></td>
          <td>{count(client.current.puestos)}</td>
          <td>{count(client.current.visitados)}</td>
          <td>{count(client.current.visitasSupervisor)}</td>
          <td>{client.current.aprovProgramados ? `${rate(client.current)} (${count(client.current.aprovCumplidos)} de ${count(client.current.aprovProgramados)})` : '—'}</td>
          <td>{count(client.current.visitasTecnico)}</td>
          <td>{count(client.current.rondas)}</td>
          <td>{client.current.ticketsAbiertos ? <>{count(client.current.ticketsAbiertos)}{client.current.ticketsVencidos ? <> · <span className="siio-alert-text">{count(client.current.ticketsVencidos)} con más de 5 días</span></> : null}</> : '0'}</td>
          {previous ? <td>{count(client.previous.visitasSupervisor)}</td> : null}
          <td>{client.puestosSinCobertura ? count(client.puestosSinCobertura) : '—'}</td>
        </tr>)}</tbody>
        <tfoot><tr>
          <th>Total</th><th>{count(summary.totals.current.puestos)}</th><th>{count(summary.totals.current.visitados)}</th><th>{count(summary.totals.current.visitasSupervisor)}</th>
          <th>{rate(summary.totals.current)}</th><th>{count(summary.totals.current.visitasTecnico)}</th><th>{count(summary.totals.current.rondas)}</th><th>{count(summary.totals.current.ticketsAbiertos)}</th>
          {previous ? <th>{count(summary.totals.previous.visitasSupervisor)}</th> : null}
          <th>{count(summary.totals.puestosSinCobertura)}</th>
        </tr></tfoot>
      </table></div>
      {summary.provisionsUntil ? <p className="siio-pulse-footnote">Aprovisionamiento nocturno: días cerrados hasta el {Number(summary.provisionsUntil.slice(8, 10))} de {monthLabel(summary.provisionsUntil.slice(0, 7) + '-01')}. Las "novedades" no se muestran como incidentes: SecurityOps crea una dentro de cada visita.</p> : null}
    </div>

    <div className="siio-pulse-block">
      <h4>Uso de SecurityOps por regional</h4>
      <div className="siio-table-wrap"><table>
        <thead><tr><th>Regional</th><th>Puestos</th><th>Estado</th></tr></thead>
        <tbody>{summary.regionals.map(row => <tr key={row.regional}>
          <td><strong>{regionalName(row.regional)}</strong></td><td>{count(row.puestos)}</td>
          <td><Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge></td>
        </tr>)}</tbody>
      </table></div>
    </div>

    <div className="siio-pulse-block">
      <h4>En construcción</h4>
      <div className="siio-commercial-pending-grid">
        <div className="siio-commercial-pending"><strong>Rentabilidad por cliente (empieza por ARA)</strong><span>Pendiente: cruzar los ingresos por cliente del estado de resultados con el costo de su operación.</span></div>
        <div className="siio-commercial-pending"><strong>Cumplimiento contra contrato</strong><span>Pendiente: frecuencias exigidas por cliente (visitas, tiempos de tickets, aprovisionamientos).</span></div>
        <div className="siio-commercial-pending"><strong>Servicio técnico y cotizaciones</strong><span>Pendiente: cotizaciones abiertas y tiempos de atención por cliente.</span></div>
        <div className="siio-commercial-pending"><strong>Alertas de video</strong><span>Pendiente: fuente de monitoreo.</span></div>
      </div>
    </div>
  </>;
}
