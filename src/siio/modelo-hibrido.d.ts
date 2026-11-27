export type Nivel = 'A' | 'B' | 'C';
export type TiendaModelo = { zona: string; nivel: Nivel | string; puestos: number; valor: number; merma: number };
export type Turno = { dia: number; noche: number };
export type SupuestosModelo = {
  zonas: Record<string, { enModelo: boolean; margen: number; supervisoresHoy: number }>;
  precioUnidad: number;
  analitica: number;
  proporciones: Record<Nivel, Turno>;
  personasPorTurno: number;
  costoPersona: number;
  costoAnalitica: number;
  valorGuardaNuevo: number;
  reduccionMerma: number;
  opcionE: { analitica: number; parteMerma: number; meses?: number };
  central?: { puestosHoy: number; puestosModelo: number; personasPorPuesto: number; costoPersona: number };
  opciones: { codigo: string; etiqueta?: string; analitica?: number }[];
};
export type ZonaModelo = {
  zona: string; tiendas: number; A: number; B: number; C: number; sinGuarda: number; puestos: number; puestosA: number;
  tiendasASinGuarda: number; valor: number; valorA: number; merma: number; enModelo: boolean; margen: number;
  supervisoresHoy: number; unidadesDia: number; unidadesNoche: number; unidades: number; proporcionInvalida: boolean;
  guardasModelo: number; valorGuardasModelo: number; valorUnidades: number; valorAnalitica: number;
  personalModelo: number; totalModelo: number; frenteAHoy: number; costoHoy: number; margenHoy: number;
  personasUnidades: number; costoModelo: number; margenModelo: number;
};
export type ResultadoModelo = {
  zonas: ZonaModelo[];
  total: Record<string, number>;
  opciones: { codigo: string; etiqueta: string; analiticaPorTienda: number; valorAnalitica: number; parteMerma: number; paga: number; frenteAHoy: number; margen: number; margenPct: number }[];
  escenariosMerma: { reduccion: number; evitada: number; ahorroModelo: number; beneficio: number }[];
  unidad: { costo: number; precio: number; margenPct: number; pierde: boolean };
};
export const NIVELES: readonly Nivel[];
export function unidadesDeTurno(conteo: Record<string, number>, proporciones: Record<string, Turno> | undefined, turno: 'dia' | 'noche'): number | null;
export function resumirZonas(tiendas: TiendaModelo[]): Omit<ZonaModelo, 'enModelo' | 'margen' | 'supervisoresHoy' | 'unidadesDia' | 'unidadesNoche' | 'unidades' | 'proporcionInvalida' | 'guardasModelo' | 'valorGuardasModelo' | 'valorUnidades' | 'valorAnalitica' | 'personalModelo' | 'totalModelo' | 'frenteAHoy' | 'costoHoy' | 'margenHoy' | 'personasUnidades' | 'costoModelo' | 'margenModelo'>[];
export function calcularModelo(tiendas: TiendaModelo[], supuestos: SupuestosModelo): ResultadoModelo;
