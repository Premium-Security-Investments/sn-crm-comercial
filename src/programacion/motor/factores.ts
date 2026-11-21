// Cada ciudad nombra los factores del domingo o festivo como los nombra su Excel: Pereira los separa por el
// compensatorio (dof_con_compensatorio, dof_sin_compensatorio) y Medellín por la jornada (rdf diurno, rnf
// nocturno, que es rdf + rn). El mismo alias del recargo dominical diurno ya se usa en reglas-legales.ts.
// Si la ciudad no define un concepto, esta función devuelve null: quien la use debe mostrar "—" y dejarlo
// fuera del total, nunca $0, porque $0 se lee como "no cuesta nada".
const ALIAS: Record<string, string[]> = {
  dof_con_compensatorio: ['rdf'],
};

export function factorDe(factores: Record<string, number> | null | undefined, clave: string | null): number | null {
  if (!clave || !factores) return null;
  for (const k of [clave, ...(ALIAS[clave] ?? [])]) {
    const v = Number(factores[k]);
    if (factores[k] !== undefined && factores[k] !== null && Number.isFinite(v)) return v;
  }
  return null;
}
