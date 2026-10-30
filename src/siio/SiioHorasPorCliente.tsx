import { Badge } from './SiioUi';
import type { HorasPorCliente, HorasClienteRow } from './horasPorCliente';

const fecha = (value: string) => new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  .format(new Date(`${value}T12:00:00Z`)).replace('.', '');
const horas = (value: number) => `${Math.round(value).toLocaleString('es-CO')} h`;
const porcentaje = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)} %`);

// Se marca la separación entre el plan y lo realizado, en cualquier dirección: en el piloto hay
// clientes con más horas reales que programadas, y pintarlo de verde o rojo sería mentir.
const relacionTono = (row: HorasClienteRow) => {
  if (row.relacion === null || row.programadas < 100) return undefined;
  return Math.abs(row.relacion - 1) > 0.1 ? 'amber' as const : undefined;
};

export function SiioHorasPorCliente({ summary }: { summary: HorasPorCliente | null }) {
  if (!summary) {
    return <div className="siio-pulse-block">
      <h4>Horas de servicio por cliente</h4>
      <p className="siio-secondary siio-quiet-empty">
        <strong>Pendiente:</strong> SIIO Programación todavía no tiene un periodo con turnos cargados que la Torre pueda leer.
      </p>
    </div>;
  }
  return <div className="siio-pulse-block">
    <h4>Horas de servicio por cliente · {summary.ciudad}</h4>
    <p className="siio-pulse-footnote">
      Periodo del {fecha(summary.inicio)} al {fecha(summary.fin)}, {summary.estado}. Fuente: SIIO Programación, que es la única que sabe de qué cliente es cada puesto.
      Son horas, no pesos: el salario base de los guardas todavía no está cargado, así que la Torre no publica un costo supuesto.
      La columna del plan es de referencia: el cargue del piloto todavía trae turnos realizados sin plan asociado.
      {summary.periodos.length > 1 ? ` Hay ${summary.periodos.length} periodos cargados; se muestra el último cerrado.` : ''}
    </p>
    {summary.readings.length ? <div className="siio-pulse-readings"><ul>{summary.readings.map(note => <li key={note}>{note}</li>)}</ul></div> : null}
    <div className="siio-table-wrap"><table>
      <thead><tr>
        <th>Cliente</th><th>NIT</th><th>Puestos</th><th>Guardas</th>
        <th>Horas realizadas</th><th>Horas programadas</th><th>Realizadas / plan</th><th>Sin plan</th><th>Participación</th>
      </tr></thead>
      <tbody>{summary.clientes.map(row => <tr key={row.clienteId}>
        <td><strong>{row.cliente}</strong></td>
        <td>{row.nit || '—'}</td>
        <td>{row.puestos.toLocaleString('es-CO')}</td>
        <td>{row.guardas.toLocaleString('es-CO')}</td>
        <td><strong>{horas(row.realizadas)}</strong></td>
        <td>{horas(row.programadas)}</td>
        <td>{relacionTono(row) ? <Badge tone="amber">{porcentaje(row.relacion)}</Badge> : porcentaje(row.relacion)}</td>
        <td>{row.turnos ? `${row.sinProgramado.toLocaleString('es-CO')} de ${row.turnos.toLocaleString('es-CO')}` : '—'}</td>
        <td>{porcentaje(row.share)}</td>
      </tr>)}</tbody>
      <tfoot><tr>
        <th>Total</th><th>{summary.clientes.length} clientes</th><th>{summary.totalPuestos.toLocaleString('es-CO')}</th><th></th>
        <th>{horas(summary.totalRealizadas)}</th><th>{horas(summary.totalProgramadas)}</th><th>{porcentaje(summary.relacion)}</th>
        <th>{summary.totalSinProgramado.toLocaleString('es-CO')} de {summary.totalTurnos.toLocaleString('es-CO')}</th><th>100 %</th>
      </tr></tfoot>
    </table></div>
  </div>;
}
