// Cobertura territorial temprana (Juan, 2026-10-13): "no perder tiempo en procesos que no vamos a poder participar o
// dejar claro desde el inicio que solo podemos participar en unión temporal". El cruce de sedes lo hace el análisis
// inicial (no el Radar, a pedido de Juan); aquí sólo se lee el veredicto. Funciones puras, sin red.
export type ParticipationVerdict = { kind: 'sola' | 'union_temporal' | 'no_puede'; title: string; detail: string };

const VERDICTS: Array<{ prefix: RegExp; kind: ParticipationVerdict['kind']; title: string }> = [
  { prefix: /^puede presentarse sola\.?\s*/i, kind: 'sola', title: 'Puede presentarse sola' },
  { prefix: /^solo en uni[oó]n temporal:?\s*/i, kind: 'union_temporal', title: 'Solo en unión temporal' },
  { prefix: /^no puede presentarse:?\s*/i, kind: 'no_puede', title: 'No puede presentarse' },
];

/** Veredicto de participación con el que empieza recommendation.label en los análisis nuevos; null en los viejos. */
export function participationVerdict(label: string | null | undefined): ParticipationVerdict | null {
  const text = String(label || '').trim();
  for (const verdict of VERDICTS) {
    const match = text.match(verdict.prefix);
    if (match) return { kind: verdict.kind, title: verdict.title, detail: text.slice(match[0].length).trim() };
  }
  return null;
}
