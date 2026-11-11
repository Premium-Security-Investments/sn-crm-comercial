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
//   * pondera: los indicadores se ponderan por el porcentaje de participación de cada integrante.
//   * cada_uno: «cada uno de los integrantes deberá…». Lo cumple cada integrante por separado (piloto Fiscalía,
//     2026-11-11: la Mesa no podía decir qué le toca al socio porque estas frases caían en «otra» y se perdían).
//   * otra: habla de plurales pero no de cómo cumplir (constitución, porcentajes de participación…).
// Cada frase lleva el numeral donde está («5.3.2, punto 8»), sacado de los títulos del texto.
// Módulo puro: lo usan «Posibles socios» (tender-plural-reading.js), la síntesis del análisis y la Mesa.

import { agt002UbicacionEnTexto } from './agt002-seccion-del-pliego.js';

const PLURAL = /consorci|uni[oó]n(?:es)? temporal|(?:proponentes?|oferentes?) plural|estructuras? plural/i;
export const PRESENCE = /domicilio|sede|sucursal|agencia|oficina|infraestructura|presencia/i;
// «cada uno de sus miembros deberá cumplir» no es «basta con uno» (Fiscalía 5.3.2, punto 3).
export const ONE = /(?<!\bcada\s)\b(?:uno|una|alguno|cualquiera)\s+de\s+(?:los|sus)\s+(?:integrantes|miembros)\b[^.]{0,200}\bcumpl|\bal\s+menos\s+uno\s+de\s+(?:los|sus)\s+(?:integrantes|miembros)\b|acredit\w*\s+con\s+(?:la|el|los|las)\s+de\s+(?:uno|cualquiera)\s+de\s+(?:los|sus)\s+(?:integrantes|miembros)\b/i;
export const SUM = /\bsuma(?:r|ndo|toria|r[aá])?\b|\ben\s+conjunto\b|\bentre\s+(?:los|sus|todos\s+los)\s+(?:integrantes|miembros)\b|\bcada\s+uno\s+de\s+(?:los|sus)\s+integrantes\s+aport/i;
export const WEIGHTED = /\bpondera(?:do|da|dos|das|r[aá]n?|ci[oó]n)?\b[^.]{0,200}\bparticipaci[oó]n\b/i;
export const EACH = /\bcada\s+uno\s+de\s+(?:los|sus)\s+(?:integrantes|miembros|participantes)\b|\bcada\s+integrante\b|\btodos\s+los\s+integrantes\b|\blos\s+otros,?\s+deber[aá]n\b/i;

/** Las frases del texto que hablan de consorcios o uniones temporales. Pura. */
export function pluralSentences(text) {
  const out = [];
  for (const sentence of String(text || '').replace(/\s+/g, ' ').split(/(?<=[.;:])\s+(?=[A-ZÁÉÍÓÚÑ0-9«"(])/)) {
    if (PLURAL.test(sentence) && sentence.length <= 1500) out.push(sentence.trim());
  }
  return out;
}

/** La lectura de una frase: basta_uno, pondera, se_suma, cada_uno u otra. Pura. */
export function pluralReadingOf(sentence) {
  if (ONE.test(sentence)) return 'basta_uno';
  if (WEIGHTED.test(sentence)) return 'pondera';
  if (SUM.test(sentence)) return 'se_suma';
  if (EACH.test(sentence)) return 'cada_uno';
  return 'otra';
}

// La posición de una frase (con los espacios normalizados) en el texto original, desde `desde`: los primeros 80
// caracteres, con cualquier espacio en blanco donde la frase tiene un espacio. Las frases van en orden, así que la
// búsqueda avanza y dos frases iguales caen cada una en su lugar.
function posicionEn(text, frase, desde = 0) {
  const cabeza = frase.slice(0, 80).split(' ').map(parte => parte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  const expresion = new RegExp(cabeza, 'g');
  expresion.lastIndex = desde;
  const match = expresion.exec(text);
  return match ? match.index : -1;
}

/**
 * Las reglas para plurales de los documentos, para la síntesis del análisis: primero las que dicen cómo cumplir la
 * presencia, luego las que dicen cómo cumplir otra cosa; sin «otra» y sin repetir. `documents`: [{ id, name, extracted_text }].
 */
export function agt002ReglasParaPlurales(documents, { max = 12 } = {}) {
  const seen = new Set();
  const fromDocument = new Map();
  const found = [];
  for (const document of Array.isArray(documents) ? documents : []) {
    let desde = 0;
    for (const frase of pluralSentences(document?.extracted_text)) {
      const lectura = pluralReadingOf(frase);
      if (lectura === 'otra') continue;
      const posicion = posicionEn(String(document?.extracted_text || ''), frase, desde);
      if (posicion >= 0) desde = posicion + 1;
      const numeral = posicion >= 0 ? agt002UbicacionEnTexto(document.extracted_text, posicion) : null;
      // La misma frase en dos puntos distintos (Fiscalía 5.3.2, puntos 8 y 9) son dos reglas; repetida en el mismo, una.
      // La misma frase en OTRO documento (el pliego en .docx y en .pdf) es una copia: vale la del primero, salvo que la
      // copia la ubique mejor —sin numeral contra «5.3.2», o «5.3.2» contra «5.3.2, punto 8»—: el .docx suele perder los
      // saltos de línea de los títulos.
      const texto = frase.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, '');
      const key = `${numeral}|${texto}`;
      if (seen.has(key)) continue;
      const copia = fromDocument.get(texto);
      if (copia && copia.document_id !== document.id) {
        const mejor = numeral && (!copia.numeral || (numeral.startsWith(copia.numeral) && numeral.length > copia.numeral.length));
        if (mejor) Object.assign(copia, { document_id: document.id, documento: document.name || null, numeral });
        continue;
      }
      seen.add(key);
      const regla = { document_id: document.id, documento: document.name || null, numeral, frase, lectura, sobre_presencia: PRESENCE.test(frase) };
      if (!copia) fromDocument.set(texto, regla);
      found.push(regla);
    }
  }
  return found.sort((a, b) => Number(b.sobre_presencia) - Number(a.sobre_presencia)).slice(0, max);
}

export const AGT002_PLURALES_POLICY = ' Reglas para consorcios y uniones temporales (reglas_para_plurales): son frases LITERALES del pliego, sacadas del texto sin interpretar. Si un requisito depende de cómo lo cumple un proponente plural y hay una regla que lo dice, cítela literal (documento y numeral) en el requisito y no concluya que «no consta» ni que «no se sabe». lectura «basta_uno» significa que basta con que un integrante cumpla; no dice que esté prohibido sumar: dígalo así, sin afirmar más. lectura «se_suma» significa que se puede sumar entre integrantes. lectura «pondera» significa que se calcula con el porcentaje de participación de cada integrante. lectura «cada_uno» significa que cada integrante debe cumplirlo por separado. Cite el numeral que trae la regla cuando lo traiga.';
