// AGT-001 / Vig-IA Gerencia: la vigencia de una fuente se calcula, no se escribe a mano.
//
// El registro traía un campo de "próxima revisión" que el código solo leía y nadie llenaba: las 17
// fuentes lo tenían vacío, así que el semáforo decía "sin fecha" para todas desde que existe. Las
// fechas que hay que mantener a mano no se mantienen.
//
// Aquí la vigencia sale de dos cosas que ya sabemos sin preguntarle a nadie: la frecuencia que la
// propia fuente declara, y el corte real del último dato que esa fuente puso en la Torre.
//
// Y una fuente cuyo dato ya no aparece en las cifras vigentes no es una fuente activa: es un
// antecedente. Cada archivo contable cargado crea su propia entrada, así que sin esto la lista
// crece con copias del mismo libro.

import type { SiioFinancialMetric, SiioPayrollAggregate } from '../siioExecutive';
import type { SiioOperationsMetric } from './operationsSummary';
import type { SiioProgramacionHoras } from './horasPorCliente';
import type { SiioSource } from './types';

export type EstadoFuente = 'al_dia' | 'atrasada' | 'sin_cadencia' | 'historica' | 'antecedente' | 'sin_dato';

export type CalidadFuente = {
  id: string;
  fuente: SiioSource;
  estado: EstadoFuente;
  ultimoDato: string | null;
  antiguedadDias: number | null;
  cadenciaDias: number | null;
  alimentaLoMostrado: boolean;
  lectura: string;
};

const DIA_MS = 86_400_000;

// La frecuencia está escrita en texto libre; se interpreta lo que hay y lo demás no inventa cadencia.
export function cadenciaEnDias(frecuencia: string | null | undefined): number | null {
  const texto = String(frecuencia || '').toLowerCase();
  if (!texto || texto.includes('demanda')) return null;
  if (texto.includes('diari')) return 1;
  if (texto.includes('semanal')) return 7;
  if (texto.includes('quincenal')) return 15;
  if (texto.includes('mensual')) return 31;
  if (texto.includes('trimestral')) return 92;
  if (texto.includes('anual')) return 365;
  return null;
}

const dias = (desde: string, hasta: Date) => Math.floor((hasta.getTime() - Date.parse(desde)) / DIA_MS);

const masReciente = (valores: Array<string | null | undefined>) => {
  const limpios = valores.filter((valor): valor is string => Boolean(valor) && !Number.isNaN(Date.parse(valor as string)));
  return limpios.length ? limpios.sort().slice(-1)[0] : null;
};

// Un periodo mensual se fecha cuando termina, no cuando empieza: septiembre está completo el 30.
function finDelPeriodo(periodo: string | null | undefined) {
  if (!periodo) return null;
  const match = /^(\d{4})-(\d{2})-01$/.exec(periodo);
  if (!match) return periodo;
  const fin = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0));
  return fin.toISOString().slice(0, 10);
}

const fecha = (valor: string) =>
  new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(valor));

const hace = (cantidad: number) => (cantidad === 0 ? 'hoy' : cantidad === 1 ? 'hace 1 día' : `hace ${cantidad} días`);

export type EntradaCalidad = {
  sources: SiioSource[];
  financialMetrics?: SiioFinancialMetric[];
  payrollAggregates?: SiioPayrollAggregate[];
  operationsMetrics?: SiioOperationsMetric[];
  programacionHoras?: SiioProgramacionHoras[];
  evidenceSourceIds?: string[];
};

// El último corte real que cada fuente puso en la Torre. Si no puso nada, no hay dato que fechar.
function ultimoDatoPorFuente(entrada: EntradaCalidad) {
  const porFuente = new Map<string, string>();
  const anotar = (id: string | null | undefined, valor: string | null | undefined) => {
    if (!id || !valor) return;
    const previo = porFuente.get(id);
    if (!previo || previo < valor) porFuente.set(id, valor);
  };
  for (const metric of entrada.financialMetrics || []) anotar(metric.source_id, finDelPeriodo(metric.period_month));
  for (const row of entrada.payrollAggregates || []) anotar(row.source_id, finDelPeriodo(row.period_month));
  const operaciones = masReciente((entrada.operationsMetrics || []).map(row => row.extracted_at));
  if (operaciones) anotar('SRC-OPS-SECURITYOPS', operaciones.slice(0, 10));
  // Un periodo abierto todavía puede cambiar: el corte es el último que Programación cerró.
  const programacion = masReciente((entrada.programacionHoras || [])
    .filter(row => row.periodo_estado === 'cerrado')
    .map(row => row.periodo_fin));
  if (programacion) anotar('SRC-PROG-PROGRAMACION', programacion.slice(0, 10));
  return porFuente;
}

export function deriveCalidadFuentes(entrada: EntradaCalidad, hoy: Date = new Date()): CalidadFuente[] {
  const ultimoDato = ultimoDatoPorFuente(entrada);
  const evidencia = new Set(entrada.evidenceSourceIds || []);
  // Cada archivo cargado crea su propia entrada, así que un mismo sistema aparece varias veces.
  // Dentro de cada tipo manda el corte más reciente: esa es la que se juzga contra su frecuencia.
  // Las otras no están atrasadas —el libro de abril nunca va a traer mayo—, son el histórico.
  const vigentePorTipo = new Map<string, { id: string; corte: string }>();
  for (const source of entrada.sources) {
    const corte = ultimoDato.get(source.id);
    if (!corte) continue;
    const tipo = String(source.source_type || source.id);
    const actual = vigentePorTipo.get(tipo);
    if (!actual || actual.corte < corte) vigentePorTipo.set(tipo, { id: source.id, corte });
  }

  return entrada.sources.map(source => {
    const corte = ultimoDato.get(source.id) || null;
    const cadenciaDias = cadenciaEnDias(source.update_frequency);
    const antiguedadDias = corte ? Math.max(0, dias(corte, hoy)) : null;
    const alimentaLoMostrado = evidencia.has(source.id);

    const tipo = String(source.source_type || source.id);
    const vigenteDelTipo = vigentePorTipo.get(tipo);
    const esLaVigente = vigenteDelTipo?.id === source.id;

    let estado: EstadoFuente;
    let lectura: string;
    if (!corte) {
      estado = vigenteDelTipo ? 'antecedente' : 'sin_dato';
      lectura = vigenteDelTipo
        ? 'Ninguna cifra vigente de la Torre viene de aquí; otra versión de la misma fuente la reemplazó.'
        : 'Registrada, pero todavía no alimenta ninguna cifra de la Torre.';
    } else if (!esLaVigente) {
      estado = 'historica';
      lectura = `Trae el corte de ${fecha(corte)} y sigue siendo válido para ese periodo. La versión vigente de esta fuente es la de ${fecha(vigenteDelTipo!.corte)}.`;
    } else if (cadenciaDias === null) {
      estado = 'sin_cadencia';
      lectura = `Último dato: ${fecha(corte)} (${hace(antiguedadDias as number)}). Sin frecuencia comprometida, así que no se juzga su atraso.`;
    } else {
      const limite = cadenciaDias + Math.ceil(cadenciaDias / 2);
      const atrasada = (antiguedadDias as number) > limite;
      estado = atrasada ? 'atrasada' : 'al_dia';
      lectura = atrasada
        ? `Último dato: ${fecha(corte)} (${hace(antiguedadDias as number)}). Se declara ${source.update_frequency}: el siguiente se esperaba ${hace((antiguedadDias as number) - limite)}.`
        : `Último dato: ${fecha(corte)} (${hace(antiguedadDias as number)}), dentro de lo que promete su frecuencia ${source.update_frequency}.`;
    }
    return { id: source.id, fuente: source, estado, ultimoDato: corte, antiguedadDias, cadenciaDias, alimentaLoMostrado, lectura };
  }).sort((izq, der) => {
    const orden: EstadoFuente[] = ['atrasada', 'al_dia', 'sin_cadencia', 'sin_dato', 'historica', 'antecedente'];
    const diferencia = orden.indexOf(izq.estado) - orden.indexOf(der.estado);
    return diferencia || izq.id.localeCompare(der.id);
  });
}

export const ETIQUETAS_ESTADO: Record<EstadoFuente, string> = {
  al_dia: 'Al día',
  atrasada: 'Atrasada',
  sin_cadencia: 'Sin frecuencia comprometida',
  sin_dato: 'Sin alimentar la Torre',
  historica: 'Corte histórico',
  antecedente: 'Antecedente',
};

export function resumenCalidad(filas: CalidadFuente[]) {
  const cuenta = (estado: EstadoFuente) => filas.filter(fila => fila.estado === estado).length;
  return { total: filas.length, atrasadas: cuenta('atrasada'), alDia: cuenta('al_dia'), sinDato: cuenta('sin_dato'), antecedentes: cuenta('antecedente') };
}
