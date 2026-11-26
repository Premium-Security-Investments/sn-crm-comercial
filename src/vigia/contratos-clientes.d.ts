export const DIAS_POR_VENCER: number;
export const ESTADOS_CONTRATO: Readonly<{ por_vencer: string; vencido: string; sin_contrato: string; revisar: string; renovado: string; sin_fecha: string; vigente: string }>;
export const ORDEN_ESTADOS: readonly string[];
export function estadoContrato(input: { fecha_fin?: string | null; observacion?: string | null }, hoy: string): { estado: string; dias: number | null };
export function inicioDeComision(input: { fecha_inicio?: string | null; fecha_ultima_renovacion?: string | null }): string | null;
export function contratosDeClientes(archivo: object[], avancys: Record<string, object>, hoy: string): object[];
export function resumenContratos(contratos: object[]): Record<string, number>;
