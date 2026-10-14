// AGT-004 / Vig-IA Operaciones: lectura del bloque de Operaciones de la Torre a partir de la última
// corrida de SecurityOps (vista siio_operations_metrics_current, migración 128).
//
// SecurityOps arrancó en Bogotá y se va extendiendo por regional. Una regional sin visitas de
// supervisor ni aprovisionamientos registrados no está "incumpliendo": todavía no usa la
// herramienta. Por eso los porcentajes solo se calculan sobre las regionales en uso.

export type SiioOperationsMetric = {
  period_month: string;
  client_key: string;
  client_label: string;
  regional: string;
  metric: string;
  value: number | string;
  data_quality?: string | null;
  extracted_at?: string | null;
};

export type OperationsFigures = {
  puestos: number;
  visitados: number;
  visitasSupervisor: number;
  aprovProgramados: number;
  aprovCumplidos: number;
  visitasTecnico: number;
  rondas: number;
  ticketsAbiertos: number;
  ticketsVencidos: number;
};

export type OperationsClientRow = {
  key: string;
  label: string;
  current: OperationsFigures;
  previous: OperationsFigures;
  puestosSinCobertura: number;
};

export type OperationsRegionalRow = {
  regional: string;
  puestos: number;
  status: 'en_uso' | 'parcial' | 'en_implementacion';
};

export type OperationsSummary = {
  extractedAt: string | null;
  currentMonth: string;
  previousMonth: string | null;
  provisionsUntil: string | null;
  regionals: OperationsRegionalRow[];
  coveredRegionals: string[];
  clients: OperationsClientRow[];
  totals: { current: OperationsFigures; previous: OperationsFigures; puestosSinCobertura: number };
  readings: string[];
};

const METRIC_FIELD: Record<string, keyof OperationsFigures> = {
  puestos_activos: 'puestos',
  puestos_visitados: 'visitados',
  visitas_supervisor: 'visitasSupervisor',
  aprovisionamientos_programados: 'aprovProgramados',
  aprovisionamientos_cumplidos: 'aprovCumplidos',
  visitas_tecnico: 'visitasTecnico',
  rondas: 'rondas',
  tickets_abiertos: 'ticketsAbiertos',
  tickets_vencidos_5d: 'ticketsVencidos',
};

const AGGREGATE_KEYS = new Set(['total', 'sin_identificar']);
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const emptyFigures = (): OperationsFigures => ({ puestos: 0, visitados: 0, visitasSupervisor: 0, aprovProgramados: 0, aprovCumplidos: 0, visitasTecnico: 0, rondas: 0, ticketsAbiertos: 0, ticketsVencidos: 0 });

export const monthLabel = (period: string | null) => (period ? MONTHS[Number(period.slice(5, 7)) - 1] || period : '');

function previousMonthOf(period: string) {
  const [year, month] = period.split('-').map(Number);
  return month === 1 ? `${year - 1}-12-01` : `${year}-${String(month - 1).padStart(2, '0')}-01`;
}

// Fecha de Bogotá (UTC−5, sin horario de verano) del día anterior a la extracción: los
// aprovisionamientos del día de la corrida no se cuentan (el extractor los excluye).
function provisionsUntilOf(extractedAt: string | null) {
  if (!extractedAt) return null;
  const at = new Date(extractedAt);
  if (Number.isNaN(at.getTime())) return null;
  return new Date(at.getTime() - 5 * 3600e3 - 24 * 3600e3).toISOString().slice(0, 10);
}

export const provisionRate = (figures: OperationsFigures) => (figures.aprovProgramados ? figures.aprovCumplidos / figures.aprovProgramados : null);

const pct = (value: number) => `${Math.round(value * 100)} %`;
const dayLabel = (iso: string) => `${Number(iso.slice(8, 10))} de ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const joinList = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`);
const REGIONAL_NAMES: Record<string, string> = { BOGOTA: 'Bogotá', QUINDIO: 'Quindío', NARINO: 'Nariño', ATLANTICO: 'Atlántico', 'SIN REGIONAL': 'Sin regional' };
export const regionalName = (regional: string) => REGIONAL_NAMES[regional] || regional.charAt(0) + regional.slice(1).toLowerCase();

export function deriveOperationsSummary(rows: SiioOperationsMetric[]): OperationsSummary | null {
  const snapshotRows = rows.filter(row => row.metric === 'puestos_activos');
  if (!snapshotRows.length) return null;
  const currentMonth = snapshotRows.reduce((latest, row) => (row.period_month > latest ? row.period_month : latest), snapshotRows[0].period_month);
  const previousCandidate = previousMonthOf(currentMonth);
  const previousMonth = rows.some(row => row.period_month === previousCandidate) ? previousCandidate : null;
  const extractedAt = rows.find(row => row.extracted_at)?.extracted_at || null;
  const value = (row: SiioOperationsMetric) => Number(row.value) || 0;

  // Regionales: puestos actuales y si hay control operativo registrado (este mes o el anterior).
  const byRegional = new Map<string, { puestos: number; control: number; other: number }>();
  for (const row of rows) {
    if (row.client_key !== 'total' || row.regional === 'TODAS') continue;
    if (row.period_month !== currentMonth && row.period_month !== previousMonth) continue;
    const entry = byRegional.get(row.regional) || { puestos: 0, control: 0, other: 0 };
    if (row.metric === 'puestos_activos' && row.period_month === currentMonth) entry.puestos += value(row);
    else if (row.metric === 'visitas_supervisor' || row.metric === 'aprovisionamientos_programados') entry.control += value(row);
    else if (row.metric === 'visitas_tecnico' || row.metric === 'rondas') entry.other += value(row);
    byRegional.set(row.regional, entry);
  }
  const regionals: OperationsRegionalRow[] = [...byRegional.entries()]
    .map(([regional, entry]) => ({ regional, puestos: entry.puestos, status: entry.control ? 'en_uso' as const : entry.other ? 'parcial' as const : 'en_implementacion' as const }))
    .filter(row => row.puestos || row.status !== 'en_implementacion')
    .sort((a, b) => Number(b.status === 'en_uso') - Number(a.status === 'en_uso') || b.puestos - a.puestos);
  const covered = new Set(regionals.filter(row => row.status === 'en_uso').map(row => row.regional));

  // Clientes: cifras solo de las regionales en uso; los puestos de las demás se cuentan aparte.
  const clients = new Map<string, OperationsClientRow>();
  const totals = { current: emptyFigures(), previous: emptyFigures(), puestosSinCobertura: 0 };
  for (const row of rows) {
    if (row.regional === 'TODAS' || AGGREGATE_KEYS.has(row.client_key)) continue;
    const field = METRIC_FIELD[row.metric];
    if (!field) continue;
    const client = clients.get(row.client_key) || { key: row.client_key, label: row.client_label, current: emptyFigures(), previous: emptyFigures(), puestosSinCobertura: 0 };
    clients.set(row.client_key, client);
    if (!covered.has(row.regional)) {
      if (field === 'puestos' && row.period_month === currentMonth) {
        client.puestosSinCobertura += value(row);
        totals.puestosSinCobertura += value(row);
      }
      continue;
    }
    const bucket = row.period_month === currentMonth ? 'current' : row.period_month === previousMonth ? 'previous' : null;
    if (!bucket) continue;
    client[bucket][field] += value(row);
    totals[bucket][field] += value(row);
  }
  const clientRows = [...clients.values()]
    .filter(client => client.current.puestos || client.current.visitasSupervisor || client.previous.visitasSupervisor || client.puestosSinCobertura)
    .sort((a, b) => Number(b.key === 'ara') - Number(a.key === 'ara') || Number(a.key === 'otros') - Number(b.key === 'otros') || b.current.puestos - a.current.puestos);

  const provisionsUntil = provisionsUntilOf(extractedAt);
  const coveredRegionals = [...covered];
  const readings: string[] = [];
  const ara = clientRows.find(client => client.key === 'ara');
  // "Sin regional" entra en las cifras si tiene control registrado, pero no se nombra como regional.
  const namedCovered = coveredRegionals.filter(regional => regional !== 'SIN REGIONAL');
  const where = namedCovered.length ? ` en ${joinList(namedCovered.map(regionalName))}` : '';
  if (ara) {
    const rate = provisionRate(ara.current);
    const previousRate = provisionRate(ara.previous);
    if (rate !== null) {
      const until = provisionsUntil && provisionsUntil.slice(0, 7) === currentMonth.slice(0, 7) ? `, hasta el ${dayLabel(provisionsUntil)}` : '';
      const before = previousRate !== null ? `; en ${monthLabel(previousMonth)} fue ${pct(previousRate)}` : '';
      readings.push(`ARA${where}: aprovisionamiento nocturno ${pct(rate)} cumplido en ${monthLabel(currentMonth)} (${ara.current.aprovCumplidos.toLocaleString('es-CO')} de ${ara.current.aprovProgramados.toLocaleString('es-CO')}${until})${before}.`);
    }
    if (ara.current.puestos) readings.push(`Tiendas ARA${where} con visita de supervisor en ${monthLabel(currentMonth)}: ${ara.current.visitados} de ${ara.current.puestos}.`);
  }
  if (totals.current.ticketsVencidos) readings.push(`${totals.current.ticketsVencidos} ${totals.current.ticketsVencidos === 1 ? 'ticket técnico lleva' : 'tickets técnicos llevan'} más de 5 días sin respuesta.`);
  const pending = regionals.filter(row => row.status !== 'en_uso');
  if (pending.length) {
    const puestos = pending.reduce((sum, row) => sum + row.puestos, 0);
    readings.push(`SecurityOps se usa hoy${where || ' en ninguna regional'}; ${puestos.toLocaleString('es-CO')} puestos en ${pending.length} ${pending.length === 1 ? 'regional siguen' : 'regionales siguen'} en implementación, sin cifras de cumplimiento.`);
  }

  return { extractedAt, currentMonth, previousMonth, provisionsUntil, regionals, coveredRegionals, clients: clientRows, totals, readings };
}
