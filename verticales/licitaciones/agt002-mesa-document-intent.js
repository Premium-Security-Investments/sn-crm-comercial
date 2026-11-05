// AGT-002 — reconocer en la Mesa que alguien pide un documento (mejora 5).
//
// Katherine no aprieta un botón por documento: escribe en el chat, en sus palabras, "necesito la carta de
// presentación" o "ármame el anexo de experiencia". Esto convierte ese mensaje en un pedido de borrador sobre el
// documento del expediente que nombra. Son reglas, no un modelo, por dos razones: la decisión de producir un
// documento no debe depender de cómo lo interprete el modelo, y cuando hay duda se prefiere contestar normal a
// crear un documento equivocado.
//
// Dos salidas, y nada más:
//   - `match`: el mensaje nombra un documento que ya existe en el expediente → borrador de ese documento.
//   - `create`: nombra un documento que no existe (p. ej. un anexo que el GO no sembró) → se crea con ese nombre.
// Si nombra dos documentos que empatan, o no pide un documento, no se toca nada: la Mesa contesta como siempre.

import { AGT002_WORKBENCH_CAPABILITIES } from './agt002-workbench-contract.js';

const fold = value => String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Verbo de pedido al principio de una frase: no es lo mismo "necesito la carta" que "¿la carta ya está?".
const REQUEST_VERB = /(?:^|[.;!,\n]\s*)(?:por favor\s*,?\s*)?(?:necesito|necesitamos|requiero|me (?:ayudas|puedes) (?:a )?(?:armar|hacer|redactar|preparar)|ayudame (?:a|con) (?:armar|hacer|redactar|preparar)|armame|arma|armalo|hazme|haz|haga|redactame|redacta|redacte|preparame|prepara|prepare|generame|genera|genere|elabora|elaborame|elabore|proyecta|proyectame|sacame|saca|dame|quiero)\b/;
const DOCUMENT_NOUN = /\b(observacion(?:es)?|carta|anexo|formato|formulario|declaracion|certificacion|certificado|compromiso|solicitud|oficio|correo|propuesta|matriz|indice|acta|constancia|manifestacion|poder|checklist|resumen)\b/;
const STOPWORDS = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'para', 'por', 'con', 'en', 'un', 'una', 'y', 'o', 'a', 'al', 'que', 'me', 'nos', 'se', 'su', 'sus', 'este', 'esta', 'proceso', 'licitacion', 'documento', 'favor', 'porfa', 'borrador', 'no', 'numero', 'nro']);
const ANNEX_NUMBER = /\banexo\s*(?:no\.?|n[°º.]|numero|#)?\s*(\d{1,2}[a-z]?)\b/;

const words = value => fold(value).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(word => word.length > 2 && !STOPWORDS.has(word));

/** ¿El mensaje pide un documento? Devuelve lo que nombra, o null. */
export function agt002DocumentRequestIntent(message) {
  // "No." de "Anexo No. 2" no es fin de frase.
  let text = fold(message).trim().replace(/\b(no|nro|n)\.\s*(?=\d)/g, '$1 ');
  // F16: un pedido largo trae primero el texto que se pega («Te paso el texto literal del pliego…») y al final lo que
  // se pide. Se mira el último párrafo; si también es largo, no es un pedido de documento.
  if (text.length > 600) text = text.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean).at(-1) || '';
  if (!text || text.length > 600) return null;
  if (text.startsWith('¿') || /^(?:ya|esta|cual|como|donde|cuando|quien|que)\b/.test(text)) return null;
  const verb = text.match(REQUEST_VERB);
  if (!verb) return null;
  const after = text.slice(verb.index + verb[0].length);
  const noun = after.match(DOCUMENT_NOUN);
  if (!noun) return null;
  // El objeto del pedido: desde el sustantivo hasta el final de la frase.
  const phrase = after.slice(noun.index).split(/[.;!?\n]/)[0].replace(/\s+(?:para|del?)\s+(?:este|esta|el|la)\s+(?:proceso|licitacion|oferta|expediente)\b.*$/, '').trim();
  // F16 (Juan, 2026-11-04): «Observaciones al pliego» es un tipo de documento con nombre fijo, se pida como se pida.
  if (noun[1].startsWith('observacion')) return { phrase: 'observaciones al pliego', annex: null, words: ['observaciones', 'pliego'], observaciones: true };
  const annex = phrase.match(ANNEX_NUMBER)?.[1]?.toUpperCase() || null;
  return { phrase: phrase.slice(0, 120), annex, words: words(phrase).filter(word => word !== 'anexo') };
}

/** Puntaje entre lo pedido y un documento del expediente. El número de anexo, si se dio, manda. */
function score(intent, artifact) {
  const title = fold(artifact.title);
  if (intent.annex) {
    const own = title.match(ANNEX_NUMBER)?.[1]?.toUpperCase() || null;
    if (own) return own === intent.annex ? 100 + intent.words.filter(word => title.includes(word)).length : -1;
  }
  const titleWords = new Set(words(artifact.title).filter(word => word !== 'anexo'));
  const hit = own => intent.words.some(word => own === word || (word.length >= 6 && own.startsWith(word.slice(0, 6))));
  const matched = [...titleWords].filter(hit).length;
  // Entre dos que nombran lo pedido, el que menos agrega: "el anexo de experiencia" es el 7 (certificaciones de
  // experiencia), no el 7A (experiencia adicional ponderable).
  return matched ? matched - 0.1 * (titleWords.size - matched) : 0;
}

/**
 * Decide sobre qué documento escribir. `artifacts` son los del expediente ({ id, title, artifact_key }).
 * Devuelve { action: 'match', artifact } | { action: 'create', title, key } | null.
 */
export function agt002ResolveRequestedDocument(intent, artifacts = []) {
  if (!intent) return null;
  const scored = artifacts.map(artifact => ({ artifact, value: score(intent, artifact) })).filter(item => item.value > 0).sort((a, b) => b.value - a.value);
  if (scored.length && (scored.length === 1 || scored[0].value > scored[1].value)) return { action: 'match', artifact: scored[0].artifact };
  if (scored.length) return null; // dos documentos empatan: mejor preguntar que escribir el equivocado
  if (!intent.words.length && !intent.annex) return null; // "necesito un anexo": no dice cuál
  if (intent.observaciones) return { action: 'create', title: 'Observaciones al pliego', key: 'observaciones_pliego' };
  const title = intent.phrase.replace(/^\w/, letter => letter.toUpperCase());
  const key = `vigia_${fold(intent.phrase).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)}`;
  return { action: 'create', title, key };
}

// F7 (auditoría del piloto Fiscalía, 2026-11-05): «Con eso, redacta las observaciones para radicar en SECOP… Texto
// formal, listo para pegar» se cortó a los 30 s (`AGT002_RESPONDER_TIMEOUT`), porque antes del GO todo es respuesta y
// sólo el borrador tiene 90 s. Esto NO crea documentos —para eso está `agt002DocumentRequestIntent`, que es estricto
// a propósito—: sólo reconoce que el mensaje pide redactar un texto, para darle el tope del borrador. Equivocarse aquí
// cuesta, a lo sumo, esperar más.
const DRAFTING_VERB = /\b(redact[aeo]\w*|elabor[aeo]\w*|proyect[aeo]\w*|escrib[ae]\w*|prepar[aeo]\w*|arm[aeo]\w*|hazme|haz|haga|genera\w*|dame)\b/;
const DRAFTING_OBJECT = /\b(observacion(es)?|carta|anexo|formato|oficio|comunicacion|solicitud|respuesta formal|texto (formal|listo)|derecho de peticion|subsanacion|aclaracion(es)?|declaracion|certificacion|compromiso|correo|documento|borrador|propuesta|manifestacion|poder)\b/;

/** ¿El mensaje pide redactar un texto? Sólo decide el tope de tiempo de la respuesta. */
export function agt002PideRedaccion(message) {
  const text = fold(message);
  if (!text.trim()) return false;
  const verb = DRAFTING_VERB.exec(text);
  return Boolean(verb && DRAFTING_OBJECT.test(text.slice(verb.index)));
}

/** El tope del borrador vale para un borrador y para una respuesta que pide redactar (F7). */
export function agt002UsaTopeDeBorrador(input) {
  if (input?.capability_id === AGT002_WORKBENCH_CAPABILITIES.draft) return true;
  return input?.capability_id === AGT002_WORKBENCH_CAPABILITIES.reply && agt002PideRedaccion(input.message);
}
