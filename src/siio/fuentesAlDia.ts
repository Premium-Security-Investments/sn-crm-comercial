// AGT-001 / Vig-IA Gerencia: ¿las fuentes están al día?
//
// La Torre muestra lo que el sistema tiene. Cuando un dato falta o llega tarde, aquí se dice qué, quién responde y
// hace cuánto (Juan, 2026-11-14: «si alguien no está haciendo su trabajo, acá nos daremos cuenta»). Cada fila sale de
// un dato que la Torre ya leyó; si la fuente no respondió, la fila no se afirma.

export type FuenteAlDia = {
  clave: string;
  prioridad: 'alta' | 'media';
  ficha: { valor: string; unidad: string };
  que: string;
  detalle: string;
  responsable: string;
  efecto: string;
  dias: number | null;
};

export type EntradaFuentes = {
  hoy: Date;
  torre: {
    meses?: { mes: string }[];
    bloqueo_contable?: string | null;
    pyg?: { mes: string; estado: 'cerrado' | 'parcial'; motivo: string | null; totales: { impuestos: number } }[];
    programaciones_avancys?: number | null;
    cartera?: { consignaciones_sin_identificar?: { saldo: number; partidas: number } } | null;
  } | null;
  // Último mes del Excel de Finanzas (AAAA-MM): hasta ahí el cierre es el oficial de Finanzas, no el de Avancys.
  excelHasta: string | null;
  forecast: { abiertas: number; sin_gestion: number; dias: number } | null;
  historico: { falta: string | null; hasta?: string } | null;
};

// Lo mismo que usa Avancys para dar un mes por cerrado sin bloqueo (avancys-torre.js).
export const DIAS_PARA_CERRAR = 30;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (mes: string) => MESES[Number(mes.slice(5, 7)) - 1];
const ultimoDia = (mes: string) => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).toISOString().slice(0, 10);
const diasDesde = (fecha: string, hoy: Date) => Math.max(0, Math.floor((Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()) - Date.parse(`${fecha}T00:00:00Z`)) / 86400000));
// Días desde el último día del mes: «septiembre lleva 45 días» el 14 de noviembre. Un solo cálculo para la Portada,
// Resultados y Fuentes, para que el mismo atraso no diga dos números distintos.
export const diasDesdeFinDeMes = (mes: string, hoy: Date) => diasDesde(ultimoDia(mes), hoy);
const millones = (valor: number) => `$${Math.round(Math.abs(valor) / 1e6).toLocaleString('es-CO')} M`;

export function fuentesAlDia({ hoy, torre, excelHasta, forecast, historico }: EntradaFuentes): FuenteAlDia[] {
  const filas: FuenteAlDia[] = [];
  const mesActual = hoy.toISOString().slice(0, 7);

  if (torre?.meses?.length) {
    // Meses de Avancys ya terminados, posteriores al Excel de Finanzas, que Contabilidad no ha bloqueado.
    const bloqueo = torre.bloqueo_contable || null;
    const sinBloqueo = torre.meses.map(fila => fila.mes)
      .filter(mes => mes < mesActual && (!excelHasta || mes > excelHasta) && !(bloqueo && bloqueo >= ultimoDia(mes)));
    if (sinBloqueo.length) {
      const dias = sinBloqueo.map(mes => diasDesde(ultimoDia(mes), hoy));
      const lista = sinBloqueo.map((mes, i) => (i === 0 ? `${nombreMes(mes)} lleva ${dias[i]} días` : `${nombreMes(mes)}, ${dias[i]}`)).join('; ');
      filas.push({
        clave: 'bloqueo', prioridad: dias[0] > DIAS_PARA_CERRAR ? 'alta' : 'media', dias: dias[0],
        ficha: { valor: `${dias[0]} días`, unidad: 'sin cierre' },
        que: 'Bloqueo contable del periodo en Avancys',
        detalle: bloqueo ? `bloqueado hasta el ${bloqueo}; ${lista}` : `ningún mes está bloqueado: ${lista}`,
        responsable: 'Contabilidad',
        efecto: 'Los meses «cerrados» lo son por regla de la Torre, no por Contabilidad',
      });
    }
  }

  for (const fila of torre?.pyg || []) {
    if (fila.estado !== 'parcial' || !/nómina/i.test(fila.motivo || '')) continue;
    const dias = diasDesde(ultimoDia(fila.mes), hoy);
    filas.push({
      clave: `nomina:${fila.mes}`, prioridad: 'alta', dias,
      ficha: { valor: `${dias} días`, unidad: 'incompleta' },
      que: `Nómina de ${nombreMes(fila.mes)}`,
      detalle: 'causada completa en la contabilidad',
      responsable: 'Nómina',
      efecto: `Los costos de ${nombreMes(fila.mes)} están incompletos y el mes no se da por cerrado`,
    });
  }

  if (forecast && forecast.abiertas > 0 && forecast.sin_gestion > 0) {
    const pct = Math.round((forecast.sin_gestion / forecast.abiertas) * 100);
    filas.push({
      clave: 'forecast', prioridad: pct >= 50 ? 'alta' : 'media', dias: null,
      ficha: { valor: `${pct} %`, unidad: 'sin gestión' },
      que: 'Forecast de leads al día en el CRM',
      detalle: `${forecast.sin_gestion} de ${forecast.abiertas} sin gestión en ${forecast.dias} días`,
      responsable: 'Comercial (por persona, en su pestaña)',
      efecto: 'El pipeline y el potencial de venta no son confiables',
    });
  }

  // El impuesto de renta solo se afirma «no causado» si hay meses cerrados y todos lo tienen en cero.
  const cerrados = (torre?.pyg || []).filter(fila => fila.estado === 'cerrado');
  if (cerrados.length && cerrados.every(fila => !fila.totales?.impuestos)) {
    filas.push({
      clave: 'renta', prioridad: 'media', dias: null,
      ficha: { valor: 'mensual', unidad: 'no se causa' },
      que: 'Impuesto de renta en Avancys',
      detalle: `ningún mes cerrado lo registra (${cerrados.map(fila => nombreMes(fila.mes)).join(', ')})`,
      responsable: 'Contabilidad',
      efecto: 'Sin utilidad neta por mes',
    });
  }

  const consignaciones = torre?.cartera?.consignaciones_sin_identificar;
  if (consignaciones?.saldo) {
    filas.push({
      clave: 'consignaciones', prioridad: 'media', dias: null,
      ficha: { valor: millones(consignaciones.saldo), unidad: 'sin aplicar' },
      que: 'Consignaciones sin identificar',
      detalle: `${consignaciones.partidas.toLocaleString('es-CO')} pagos recibidos sin aplicar a ningún cliente`,
      responsable: 'Tesorería y Cartera',
      efecto: 'La cartera de cada cliente puede estar inflada en esa plata',
    });
  }

  if (torre?.programaciones_avancys === 0) {
    filas.push({
      clave: 'programacion', prioridad: 'media', dias: null,
      ficha: { valor: '0', unidad: 'programaciones' },
      que: 'Turnos programados en Avancys',
      detalle: 'el módulo de turnos está instalado y sin operar',
      responsable: 'Operaciones · Programación',
      efecto: 'Sin costo real por puesto ni por cliente: sigue aproximado por sede',
    });
  }

  if (historico?.falta) {
    const hasta = historico.hasta ? Number(historico.hasta.slice(5, 7)) : null;
    filas.push({
      clave: 'historico', prioridad: 'media', dias: null,
      ficha: hasta ? { valor: `${12 - hasta} ${12 - hasta === 1 ? 'mes' : 'meses'}`, unidad: 'por cargar' } : { valor: 'todo', unidad: 'por cargar' },
      que: 'Histórico del año pasado (Excel de cierre)',
      detalle: `falta ${historico.falta}`,
      responsable: 'Finanzas',
      efecto: 'Sin comparativo contra el año pasado en esos meses',
    });
  }

  return filas.sort((a, b) => (a.prioridad === b.prioridad ? (b.dias ?? -1) - (a.dias ?? -1) : a.prioridad === 'alta' ? -1 : 1));
}
