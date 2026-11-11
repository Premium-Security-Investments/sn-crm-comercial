// Punto 6 del encargo «Aliados según la regla del pliego» (AGT-002, 2026-11-10; Juan: «vamos con la 2 de una vez»).
//
// En el reanálisis de Fiscalía `22f4bec0` (2026-11-10) Vig-IA tuvo en sus secciones el 5.3.2 del complemento —«En cuanto
// a los consorcios o uniones temporales, si uno de los integrantes cumple con el requisito de tener domicilio principal,
// sucursal o agencia en la ciudad capital de cada seccional… se entenderá cumplido el requisito»— y concluyó «No consta si
// la presencia… puede acreditarla un solo integrante». La frase estaba a 3.267 caracteres del título y se perdió.
//
// Aquí se sacan del texto, sin modelo, las frases literales sobre proponentes plurales, con la lectura que dan:
//   * basta_uno: «si uno de los integrantes cumple…». Basta con uno; NO dice que esté prohibido sumar (Juan, 2026-11-10:
//     no afirmar más de lo que dice el pliego).
//   * se_suma: «se sumará…», «en conjunto», «entre los integrantes».
//   * otra: habla de plurales pero no de cómo cumplir (constitución, porcentajes de participación…).
// Módulo puro: lo usan «Posibles socios» (tender-plural-reading.js) y la síntesis del análisis.

const PLURAL = /consorci|uni[oó]n(?:es)? temporal|proponentes? plural|estructuras? plural/i;
export const PRESENCE = /domicilio|sede|sucursal|agencia|oficina|infraestructura|presencia/i;
export const ONE = /\b(?:uno|una|alguno|cualquiera)\s+de\s+(?:los|sus)\s+(?:integrantes|miembros)\b[^.]{0,200}\bcumpl|\bal\s+menos\s+uno\s+de\s+(?:los|sus)\s+(?:integrantes|miembros)\b|acredit\w*\s+con\s+(?:la|el|los|las)\s+de\s+(?:uno|cualquiera)\s+de\s+(?:los|sus)\s+(?:integrantes|miembros)\b/i;
export const SUM = /\bsuma(?:r|ndo|toria|r[aá])?\b|\ben\s+conjunto\b|\bentre\s+(?:los|sus|todos\s+los)\s+(?:integrantes|miembros)\b|\bcada\s+uno\s+de\s+(?:los|sus)\s+integrantes\s+aport/i;

/** Las frases del texto que hablan de consorcios o uniones temporales. Pura. */
export function pluralSentences(text) {
  const out = [];
  for (const sentence of String(text || '').replace(/\s+/g, ' ').split(/(?<=[.;:])\s+(?=[A-ZÁÉÍÓÚÑ0-9«"(])/)) {
    if (PLURAL.test(sentence) && sentence.length <= 1500) out.push(sentence.trim());
  }
  return out;
}

/** La lectura de una frase: basta_uno, se_suma u otra. Pura. */
export function pluralReadingOf(sentence) {
  if (ONE.test(sentence)) return 'basta_uno';
  if (SUM.test(sentence)) return 'se_suma';
  return 'otra';
}

/**
 * Las reglas para plurales de los documentos, para la síntesis del análisis: primero las que dicen cómo cumplir la
 * presencia, luego las que dicen cómo cumplir otra cosa; sin «otra» y sin repetir. `documents`: [{ id, name, extracted_text }].
 */
export function agt002ReglasParaPlurales(documents, { max = 12 } = {}) {
  const seen = new Set();
  const found = [];
  for (const document of Array.isArray(documents) ? documents : []) {
    for (const frase of pluralSentences(document?.extracted_text)) {
      const lectura = pluralReadingOf(frase);
      const key = frase.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, '');
      if (lectura === 'otra' || seen.has(key)) continue;
      seen.add(key);
      found.push({ document_id: document.id, documento: document.name || null, frase, lectura, sobre_presencia: PRESENCE.test(frase) });
    }
  }
  return found.sort((a, b) => Number(b.sobre_presencia) - Number(a.sobre_presencia)).slice(0, max);
}

export const AGT002_PLURALES_POLICY = ' Reglas para consorcios y uniones temporales (reglas_para_plurales): son frases LITERALES del pliego, sacadas del texto sin interpretar. Si un requisito depende de cómo lo cumple un proponente plural y hay una regla que lo dice, cítela literal (documento y numeral) en el requisito y no concluya que «no consta» ni que «no se sabe». lectura «basta_uno» significa que basta con que un integrante cumpla; no dice que esté prohibido sumar: dígalo así, sin afirmar más. lectura «se_suma» significa que se puede sumar entre integrantes.';
