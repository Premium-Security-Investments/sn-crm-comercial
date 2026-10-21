// AGT-001 / Vig-IA Gerencia: horas de servicio por cliente, desde SIIO Programación
// (vista `siio_programacion_horas_cliente`, migración 143).
//
// Programación sigue en construcción: hoy solo hay periodos de Pereira, y Medellín existe como
// ciudad sin periodo. Por eso la lectura no asume ciudades ni periodos: toma lo que venga y dice
// de qué periodo y de qué ciudad está hablando.
//
// Son horas, no pesos. `programacion.empleados.salario_base` está vacío (0 de 1.290), así que
// cualquier costo de hoy saldría de suponer el SMLV para todos. Mientras eso siga así, la Torre
// muestra horas y no finge un costo.

export type SiioProgramacionHoras = {
  periodo_id: number;
  ciudad: string;
  periodo_inicio: string;
  periodo_fin: string;
  periodo_estado: string;
  cliente_id: number;
  cliente: string;
  nit?: string | null;
  puestos: number | string;
  horas_programadas: number | string;
  horas_realizadas: number | string;
  turnos_programados: number | string;
  turnos_realizados: number | string;
  turnos_sin_programado?: number | string;
  guardas: number | string;
};

export type HorasClienteRow = {
  clienteId: number;
  cliente: string;
  nit: string | null;
  puestos: number;
  guardas: number;
  programadas: number;
  realizadas: number;
  turnos: number;
  sinProgramado: number;
  // Realizadas sobre programadas. No es cumplimiento del servicio: en el piloto el cargue trajo
  // más turnos reales que programados, así que una diferencia grande es dato incompleto.
  relacion: number | null;
  share: number | null;
};

export type HorasPorCliente = {
  periodoId: number;
  ciudad: string;
  inicio: string;
  fin: string;
  estado: string;
  abierto: boolean;
  clientes: HorasClienteRow[];
  totalProgramadas: number;
  totalRealizadas: number;
  totalPuestos: number;
  totalTurnos: number;
  totalSinProgramado: number;
  relacion: number | null;
  periodos: { periodoId: number; ciudad: string; inicio: string; fin: string; estado: string }[];
  readings: string[];
};

const num = (value: number | string | null | undefined) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const horas = (value: number) => `${Math.round(value).toLocaleString('es-CO')} h`;
const percent = (value: number) => `${Math.round(value * 100)} %`;

// Manda el último periodo cerrado; si no hay ninguno cerrado, el más reciente.
export function pickPeriodo(rows: SiioProgramacionHoras[]) {
  if (!rows.length) return null;
  const byPeriodo = new Map<number, SiioProgramacionHoras>();
  for (const row of rows) if (!byPeriodo.has(row.periodo_id)) byPeriodo.set(row.periodo_id, row);
  const list = [...byPeriodo.values()].sort((left, right) => left.periodo_inicio.localeCompare(right.periodo_inicio));
  const cerrados = list.filter(item => item.periodo_estado === 'cerrado');
  return (cerrados.length ? cerrados[cerrados.length - 1] : list[list.length - 1]) || null;
}

export function deriveHorasPorCliente(rows: SiioProgramacionHoras[], periodoId?: number | null): HorasPorCliente | null {
  const elegido = periodoId
    ? rows.find(row => row.periodo_id === periodoId) || pickPeriodo(rows)
    : pickPeriodo(rows);
  if (!elegido) return null;
  const delPeriodo = rows.filter(row => row.periodo_id === elegido.periodo_id);
  const totalRealizadas = delPeriodo.reduce((sum, row) => sum + num(row.horas_realizadas), 0);
  const totalProgramadas = delPeriodo.reduce((sum, row) => sum + num(row.horas_programadas), 0);
  const clientes: HorasClienteRow[] = delPeriodo.map(row => {
    const programadas = num(row.horas_programadas);
    const realizadas = num(row.horas_realizadas);
    return {
      clienteId: row.cliente_id,
      cliente: row.cliente,
      nit: row.nit || null,
      puestos: num(row.puestos),
      guardas: num(row.guardas),
      programadas,
      realizadas,
      turnos: num(row.turnos_realizados),
      sinProgramado: num(row.turnos_sin_programado),
      relacion: programadas > 0 ? realizadas / programadas : null,
      share: totalRealizadas > 0 ? realizadas / totalRealizadas : null,
    };
  }).sort((left, right) => right.realizadas - left.realizadas || left.cliente.localeCompare(right.cliente));
  const periodos = [...new Map(rows.map(row => [row.periodo_id, {
    periodoId: row.periodo_id, ciudad: row.ciudad, inicio: row.periodo_inicio, fin: row.periodo_fin, estado: row.periodo_estado,
  }])).values()].sort((left, right) => left.inicio.localeCompare(right.inicio));
  const summary: HorasPorCliente = {
    periodoId: elegido.periodo_id,
    ciudad: elegido.ciudad,
    inicio: elegido.periodo_inicio,
    fin: elegido.periodo_fin,
    estado: elegido.periodo_estado,
    abierto: elegido.periodo_estado !== 'cerrado',
    clientes,
    totalProgramadas,
    totalRealizadas,
    totalPuestos: clientes.reduce((sum, row) => sum + row.puestos, 0),
    totalTurnos: clientes.reduce((sum, row) => sum + row.turnos, 0),
    totalSinProgramado: clientes.reduce((sum, row) => sum + row.sinProgramado, 0),
    relacion: totalProgramadas > 0 ? totalRealizadas / totalProgramadas : null,
    periodos,
    readings: [],
  };
  summary.readings = horasReadings(summary);
  return summary;
}

export function horasReadings(summary: HorasPorCliente) {
  const readings: string[] = [];
  const first = summary.clientes[0];
  if (first && first.share !== null) {
    readings.push(`${first.cliente} concentra el ${percent(first.share)} de las horas del periodo (${horas(first.realizadas)} en ${first.puestos} puesto(s)).`);
  }
  readings.push(`${summary.clientes.length} clientes con servicio en ${summary.ciudad}, ${horas(summary.totalRealizadas)} realizadas sobre ${horas(summary.totalProgramadas)} programadas.`);
  // El plan y lo realizado no cuadran en el piloto: hay que decir cuánto, y que es calidad del dato.
  if (summary.totalTurnos > 0 && summary.totalSinProgramado > 0) {
    readings.push(`${percent(summary.totalSinProgramado / summary.totalTurnos)} de los turnos realizados no tiene un turno programado asociado: el cargue del piloto trajo más turnos reales que planeados, así que la diferencia entre programado y realizado es dato incompleto, no incumplimiento.`);
  }
  const desviados = summary.clientes.filter(row => row.relacion !== null && Math.abs(row.relacion - 1) > 0.1 && row.programadas >= 100);
  if (desviados.length) {
    readings.push(`${desviados.length} cliente(s) con el plan y lo realizado separados más de 10 %: ${desviados.slice(0, 3).map(row => `${row.cliente} (${percent(row.relacion as number)})`).join('; ')}.`);
  }
  if (summary.abierto) readings.push('El periodo está abierto: las horas van a cambiar hasta que Programación lo cierre.');
  return readings;
}
