// AGT-002 — F1/F2 de la auditoría del piloto Fiscalía (2026-11-05): la Mesa lee el numeral completo.
//
// Lo que pasó: con numeral y página exactos («numeral 5.3.2, páginas 37 y 38»), la Mesa recibió 5.3.2 cortado en «Se
// entenderá por la Entidad que la licencia se encuentr…», porque cada fuente le llega como fragmento de 1.000
// caracteres; el párrafo de uniones temporales estaba 3.067 caracteres después del título (F1). Y una pregunta que
// citaba textual «infraestructura física… Pereira, Manizales, Armenia y Quibdó» recibió el cronograma y las
// definiciones (F2). Lo mismo que #504 hizo para los formatos (`agt002-formato-oficial.js`), aquí para los numerales:
//
//   - si el pedido cita un numeral, va la sección completa del pliego vigente, de su título al siguiente numeral
//     hermano o superior (los «1. Licencia…» de adentro no la cortan);
//   - si no cita numeral, va la sección numerada que más palabras del pedido trae, literal, y sólo si la coincidencia
//     es clara. Si no la hay, no se manda nada: la Mesa sigue con sus fragmentos y lo dice.
//
// Módulo puro. No adivina: sin pliego vigente, o sin la sección, devuelve null.

import { agt002PliegoVigente } from './agt002-formato-oficial.js';

export const AGT002_SECCION_MAX_CHARS = 10_000;

const fold = value => String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// «numeral 5.3.2», «5.3.2.», «sección 4.1»: dos niveles o más, cada uno de 1-2 cifras (1.500 no es un numeral).
const NUMERAL_CITADO = /(?:^|[^\d.])(\d{1,2}(?:\.\d{1,2}){1,4})(?![\d])/g;
// Un título numerado al principio de un renglón: «5.3.2. REQUISITO…», «5.4 Garantías», «6. CAPÍTULO».
const TITULO = /(?:^|\n)[ \t]*(\d{1,2}(?:\.\d{1,2}){0,4})\.?[ \t]+(?=\S)([^\n]*)/g;
const INDICE = /\.{5,}|\t\s*\d+\s*$|\s{2,}\d{1,3}\s*$/;

const partes = numeral => numeral.split('.').map(Number);
function despues(a, b) {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const x = a[index] ?? -1;
    const y = b[index] ?? -1;
    if (x !== y) return x > y;
  }
  return false;
}
const desciende = (hijo, padre) => hijo.length > padre.length && padre.every((value, index) => hijo[index] === value);

/** El numeral que cita el pedido (el primero con «numeral» delante; si no, el primero con dos niveles o más). */
export function agt002NumeralCitado(message) {
  const text = String(message || '');
  const explicito = /\b(?:numeral|num\.|secci[oó]n|cap[ií]tulo|apartado)\s+(\d{1,2}(?:\.\d{1,2}){1,4})/i.exec(text);
  if (explicito) return explicito[1];
  for (const match of text.matchAll(NUMERAL_CITADO)) return match[1];
  return null;
}

function titulos(text) {
  const found = [];
  for (const match of text.matchAll(TITULO)) {
    const linea = match[0].replace(/^\n/, '');
    if (INDICE.test(linea)) continue;
    found.push({ start: match.index + (match[0].startsWith('\n') ? 1 : 0), numeral: match[1], titulo: match[2].trim().slice(0, 160) });
  }
  return found;
}

function seccion(text, todos, entry) {
  const propio = partes(entry.numeral);
  const fin = todos.find(other => other.start > entry.start && !desciende(partes(other.numeral), propio) && despues(partes(other.numeral), propio)
    && partes(other.numeral).length <= propio.length);
  const bruto = text.slice(entry.start, fin ? fin.start : text.length);
  const limpio = bruto.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  return { numeral: entry.numeral, titulo: entry.titulo, recortado: limpio.length > AGT002_SECCION_MAX_CHARS, texto: limpio.slice(0, AGT002_SECCION_MAX_CHARS) };
}

/** La sección del numeral citado, del pliego vigente. Si aparece más de una vez como título, la última (el cuerpo). */
export function agt002SeccionPorNumeral({ documents = [], numeral }) {
  if (!numeral) return null;
  const pliego = agt002PliegoVigente(documents.filter(document => typeof document?.extracted_text === 'string' && document.extracted_text.trim()));
  if (!pliego) return null;
  const todos = titulos(pliego.extracted_text);
  const candidatos = todos.filter(entry => entry.numeral === numeral);
  const elegido = candidatos[candidatos.length - 1];
  if (!elegido) return null;
  return { ...seccion(pliego.extracted_text, todos, elegido), documento: pliego.name, document_id: pliego.id, origen: 'numeral' };
}

const VACIAS = new Set(['sobre', 'entre', 'desde', 'hasta', 'donde', 'cuando', 'porque', 'pliego', 'definitivo', 'numeral', 'pagina', 'paginas',
  'texto', 'literal', 'dice', 'busca', 'dime', 'tiene', 'tienen', 'puede', 'pueden', 'debe', 'deben', 'esta', 'estas', 'estos', 'manana',
  'plazo', 'vence', 'analisis', 'requisito', 'proceso', 'oferta', 'oferente', 'entidad', 'favor', 'gracias']);

/**
 * F2: sin numeral citado, la sección numerada (de dos niveles o más) que trae más palabras del pedido, literal. Sólo
 * si trae al menos 4 de ellas y al menos el 60 %: una coincidencia floja no se manda.
 */
export function agt002SeccionPorFrase({ documents = [], message }) {
  const palabras = [...new Set(fold(message).replace(/[^a-z0-9ñ ]+/g, ' ').split(/\s+/).filter(word => word.length >= 5 && !VACIAS.has(word)))];
  if (palabras.length < 4) return null;
  const pliego = agt002PliegoVigente(documents.filter(document => typeof document?.extracted_text === 'string' && document.extracted_text.trim()));
  if (!pliego) return null;
  const text = pliego.extracted_text;
  const todos = titulos(text);
  let mejor = null;
  for (const entry of todos) {
    if (partes(entry.numeral).length < 2) continue;
    const candidata = seccion(text, todos, entry);
    const cuerpo = fold(candidata.texto);
    const encontradas = palabras.filter(word => cuerpo.includes(word)).length;
    // A igual puntaje gana la sección más corta: es la más precisa.
    if (!mejor || encontradas > mejor.encontradas || (encontradas === mejor.encontradas && candidata.texto.length < mejor.candidata.texto.length)) {
      mejor = { entry, candidata, encontradas };
    }
  }
  if (!mejor || mejor.encontradas < 4 || mejor.encontradas / palabras.length < 0.6) return null;
  return { ...mejor.candidata, documento: pliego.name, document_id: pliego.id, origen: 'frase' };
}

/** Lo que va a la Mesa: el numeral citado; si no hay, la sección por frase; si nada, null. */
export function agt002SeccionDelPedido({ documents = [], message }) {
  const numeral = agt002NumeralCitado(message);
  return numeral ? agt002SeccionPorNumeral({ documents, numeral }) : agt002SeccionPorFrase({ documents, message });
}

/**
 * F12: la sección de un numeral en un documento dado (el que citó el análisis), no sólo en el pliego vigente. Si el
 * numeral aparece varias veces como título, la última (el cuerpo, no el índice). Sin título, null.
 */
export function agt002SeccionDeDocumento({ document, numeral }) {
  if (!numeral || typeof document?.extracted_text !== 'string' || !document.extracted_text.trim()) return null;
  const todos = titulos(document.extracted_text);
  const candidatos = todos.filter(entry => entry.numeral === numeral);
  const elegido = candidatos[candidatos.length - 1];
  if (!elegido) return null;
  return { ...seccion(document.extracted_text, todos, elegido), documento: document.name, document_id: document.id, origen: 'numeral' };
}
