// Decidir más fácil de leer (Juan, 2026-11-11: «son muy saturadas de texto… que tenga espacios entre frases y
// párrafos»). Sólo presentación: no cambia lo que dice Vig-IA, sólo cómo se parte para leerlo.

const ABBREVIATIONS = /\b(?:N|No|Nº|núm|art|Art|arts|pág|págs|p|S\.A|Ltda|Dr|Dra|Sr|Sra|aprox|etc)\.$/;

/** Las frases de un texto, partiendo en «. » y «; » sin cortar abreviaturas ni números («Nº 1», «1.500»). */
export function sentences(text: string | null | undefined): string[] {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const out: string[] = [];
  let start = 0;
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if ((char !== '.' && char !== ';') || clean[index + 1] !== ' ') continue;
    const piece = clean.slice(start, index + 1);
    const next = clean[index + 2] || '';
    if (char === '.' && (ABBREVIATIONS.test(piece) || !/[A-ZÁÉÍÓÚÑ¿¡«"(0-9]/.test(next))) continue;
    out.push(piece.trim());
    start = index + 2;
  }
  out.push(clean.slice(start).trim());
  return out.filter(Boolean).map(item => item.replace(/;$/, '').trim());
}

/** Una frase suelta como oración: mayúscula inicial y punto final. */
function asSentence(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?…»)"]$/.test(capital) ? capital : `${capital}.`;
}

/**
 * La recomendación en partes: el titular («Solo en unión temporal») y los puntos que lo explican. Si el texto no
 * empieza con un titular corto seguido de «:», el titular es la primera frase.
 */
export function recommendationParts(text: string | null | undefined): { lead: string; points: string[] } {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const colon = clean.indexOf(':');
  if (colon > 0 && colon <= 60) {
    const rest = sentences(clean.slice(colon + 1)).map(asSentence);
    return { lead: clean.slice(0, colon).trim(), points: rest };
  }
  const [lead = '', ...points] = sentences(clean);
  return { lead, points: points.map(asSentence) };
}

/** Un párrafo largo en frases sueltas; uno corto queda igual. */
export function paragraphs(text: string | null | undefined, { maxChars = 220 } = {}): string[] {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  return clean.length <= maxChars ? [clean] : sentences(clean).map(asSentence);
}
