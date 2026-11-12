export type CorbatinControl = {
  tipo: 'existente' | 'propuesto'; texto: string; momento: 'antes' | 'despues' | null; causa: number | null; verificado: boolean | null;
  depende_de: string | null; puede_fallar: string | null; lo_sostiene: string | null;
};

export type Corbatin = {
  evento: string;
  causas: { numero: number; texto: string; controles: CorbatinControl[] }[];
  antes_todas: CorbatinControl[];
  despues: CorbatinControl[];
  sin_clasificar: CorbatinControl[];
  consecuencias: string[];
  detallado: boolean;
  sin_defensa_hoy: number[];
  sin_ningun_control: number[];
};

export function itemsOf(text: string | null | undefined): string[];
export function cleanControlDetails(input: unknown, row: Record<string, unknown>): CorbatinControl[];
export function bowTie(risk: Record<string, unknown>): Corbatin;
export function controlNote(control: CorbatinControl): string;
