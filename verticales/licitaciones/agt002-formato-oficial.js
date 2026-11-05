// AGT-002 — el texto oficial del formato o anexo que se pide redactar (mejora 5, regla de Juan del 2026-11-04).
//
// La primera carta de presentación de Supersalud salió sin el texto del Formato No. 1 y Vig-IA dijo que "las fuentes
// solo traen el numeral 4.1.1". No era cierto que no estuviera: el formato completo vive dentro de `pliego de
// condiciones definitivo.pdf`, desde el carácter 427.173. Lo que pasó es que el contexto de la Mesa se llenó con trece
// tareas del expediente de 1.000 caracteres y el formato nunca entró. La regla de Juan:
//
//   cuando el pedido nombra un formato o anexo, la Mesa localiza su texto completo —primero un archivo propio con ese
//   nombre (como `Formato No. 8 - Jefe de Seguridad.xlsx`); si no hay, la sección del pliego vigente que empieza en
//   ese título y termina en el siguiente— y ese texto va como base de la redacción, por encima de las tareas.
//
// Módulo puro: recibe los documentos vigentes del proceso y el pedido, y devuelve el texto o null. No adivina: si no
// sabe qué formato es, o el pliego no lo trae, devuelve null y la Mesa lo dice.

const fold = value => String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const AGT002_FORMATO_MAX_CHARS = 10_000;

// "Formato No. 1", "FORMATO No.7", "Anexo N° 12A", "anexo 7".
const REFERENCE = /\b(formato|anexo)\s*(?:no\.?|n[°º.]|nro\.?|numero|#)?\s*(\d{1,2}[a-z]?)\b/;
// Un título de sección: la palabra al principio de una línea, con su número.
const HEADING = /(?:^|\n)[ \t]*((?:FORMATO|ANEXO|Formato|Anexo)[ \t]+(?:No\.?|N[°º.]|Nro\.?)?[ \t]*(\d{1,2}[A-Za-z]?))\b[^\n]*/g;
const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'o', 'a', 'en', 'para', 'por', 'con', 'documento', 'oferta', 'propuesta']);

/** ¿El texto nombra un formato o anexo con número? → { word: 'formato'|'anexo', number: '1' }. */
export function agt002FormatoReference(text) {
  const match = fold(text).match(REFERENCE);
  return match ? { word: match[1], number: match[2].toUpperCase() } : null;
}

const titleWords = title => fold(title).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
  .filter(word => word.length > 3 && !STOPWORDS.has(word) && word !== 'formato' && word !== 'anexo' && !/^\d/.test(word));

/**
 * Quita lo que el extractor repite en cada página: encabezado, pie y "Página N de M". Una línea que aparece en más
 * del 60 % de las páginas (y al menos 20 veces) es del diseño, no del documento. "SUPERINTENDENCIA NACIONAL DE SALUD"
 * aparece 21 veces en el pliego de Supersalud, contra 198 del pie: se queda.
 */
export function agt002CleanExtractedText(section, fullText = section) {
  const counts = new Map();
  for (const raw of String(fullText).split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (line.length > 2) counts.set(line, (counts.get(line) || 0) + 1);
  }
  const top = Math.max(0, ...counts.values());
  const threshold = Math.max(20, Math.ceil(top * 0.6));
  const kept = [];
  for (const raw of String(section).split('\n')) {
    const line = raw.replace(/[ \t]+/g, ' ').trim();
    if (/^p[aá]gina\s+\d+\s+de\s+\d+$/i.test(line)) continue;
    if (line.length > 2 && (counts.get(line) || 0) >= threshold) continue;
    if (!line && (!kept.length || !kept[kept.length - 1])) continue;
    kept.push(line);
  }
  return kept.join('\n').trim();
}

function sections(text) {
  const found = [];
  for (const match of String(text).matchAll(HEADING)) {
    const start = match.index + (match[0].startsWith('\n') ? 1 : 0);
    found.push({ start, word: fold(match[1]).startsWith('formato') ? 'formato' : 'anexo', number: match[2].toUpperCase(), head: match[0].trim() });
  }
  return found.map((entry, index) => {
    // La sección termina en el siguiente título de la MISMA palabra: "de conformidad con el Anexo No. 1" dentro de una
    // carta no corta el formato.
    const next = found.slice(index + 1).find(other => other.word === entry.word);
    return { ...entry, end: next ? next.start : String(text).length };
  });
}

/** El pliego vigente: el definitivo más reciente; si no hay definitivo, el pliego más largo. */
function currentPliego(documents) {
  const pliegos = documents.filter(document => document.document_type === 'pliego' && typeof document.extracted_text === 'string');
  const definitivos = pliegos.filter(document => /definitivo/i.test(document.name || '') && !/respuesta|observaci|acta|informe/i.test(document.name || ''));
  const pool = definitivos.length ? definitivos : pliegos.filter(document => !/respuesta|observaci|acta|informe/i.test(document.name || ''));
  return pool.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || b.extracted_text.length - a.extracted_text.length)[0] || null;
}

function result({ document, title, text, origin, cleaned }) {
  return {
    titulo: title.replace(/\s+/g, ' ').trim().slice(0, 200),
    documento: document.name,
    document_id: document.id,
    origen: origin,
    recortado: cleaned.length > AGT002_FORMATO_MAX_CHARS,
    texto: cleaned.slice(0, AGT002_FORMATO_MAX_CHARS),
    caracteres: text.length,
  };
}

/**
 * Localiza el texto del formato pedido. `request` es lo que pidió la persona (el mensaje) y el título del documento
 * del expediente; `documents` son los documentos vigentes del proceso ({ id, name, document_type, created_at,
 * extracted_text }). Devuelve { titulo, documento, document_id, origen: 'archivo'|'pliego', texto, recortado } o null.
 */
export function agt002LocateFormato({ documents = [], message = '', title = '' } = {}) {
  const usable = documents.filter(document => typeof document?.extracted_text === 'string' && document.extracted_text.trim());
  const reference = agt002FormatoReference(message) || agt002FormatoReference(title);
  if (reference) {
    // 1. Un archivo propio con ese nombre.
    const own = usable.find(document => {
      const named = agt002FormatoReference(document.name);
      return named && named.word === reference.word && named.number === reference.number && document.document_type !== 'pliego';
    });
    if (own) {
      const cleaned = agt002CleanExtractedText(own.extracted_text);
      return result({ document: own, title: own.name.replace(/\.[a-z0-9]+$/i, ''), text: own.extracted_text, origin: 'archivo', cleaned });
    }
  }
  // 2. La sección del pliego vigente.
  const pliego = currentPliego(usable);
  if (!pliego) return null;
  const all = sections(pliego.extracted_text).filter(entry => !/\.{5,}/.test(entry.head));
  const wanted = titleWords(title);
  const candidates = reference
    ? all.filter(entry => entry.word === reference.word && entry.number === reference.number)
    // Sin número ("Carta de presentación"): el título cuya cabecera nombra lo pedido.
    : wanted.length
      ? all.filter(entry => {
        // El título es el renglón del número y el siguiente que no esté vacío; no los 300 caracteres que siguen, que
        // en un formato corto ya traen el comienzo de otro.
        const head = fold(pliego.extracted_text.slice(entry.start, entry.end).split('\n').map(line => line.trim()).filter(Boolean).slice(0, 2).join(' ').slice(0, 200));
        return wanted.every(word => head.includes(word.slice(0, 6)));
      })
      : [];
  // Si aparece más de una vez, manda el renglón que es un TÍTULO ("FORMATO No. 1." o "FORMATO No. 1 CARTA DE…") sobre
  // una frase que lo menciona ("Formato No. 1 establecido en el pliego…", página 80 del de Supersalud); entre títulos,
  // el último, que es el cuerpo y no una cita.
  const isTitle = entry => {
    const rest = entry.head.replace(/^\S+\s+(?:No\.?|N[°º.]|Nro\.?)?\s*\d{1,2}[A-Za-z]?/, '').replace(/^[\s.:–-]+/, '').trim();
    return !rest || (rest.length <= 80 && rest === rest.toUpperCase());
  };
  const titled = candidates.filter(isTitle);
  const chosen = (titled.length ? titled : candidates)[(titled.length ? titled : candidates).length - 1];
  if (!chosen) return null;
  const text = pliego.extracted_text.slice(chosen.start, chosen.end);
  const cleaned = agt002CleanExtractedText(text, pliego.extracted_text);
  const firstLines = cleaned.split('\n').filter(Boolean).slice(0, 2).join(' — ');
  return result({ document: pliego, title: firstLines || chosen.head, text, origin: 'pliego', cleaned });
}

/**
 * Mejora 6 (encargo desde Terminal): la «relación de anexos que se presentan» de la carta de presentación se arma con
 * los formatos y anexos que el proceso de verdad pide, no de memoria. Devuelve la lista de títulos numerados del pliego
 * vigente (sin índice ni citas: sólo renglones que son título) y de los archivos propios con número, sin repetir, en
 * orden de número. Cada uno lleva su título corto (el renglón del número y el siguiente) y de dónde salió.
 */
export function agt002ListarFormatos(documents = []) {
  const usable = documents.filter(document => typeof document?.extracted_text === 'string' && document.extracted_text.trim());
  const porClave = new Map();
  const clave = (word, number) => `${word}:${number}`;
  const pliego = currentPliego(usable);
  if (pliego) {
    const text = pliego.extracted_text;
    for (const entry of sections(text)) {
      if (/\.{5,}/.test(entry.head)) continue; // renglón del índice
      const rest = entry.head.replace(/^\S+\s+(?:No\.?|N[°º.]|Nro\.?)?\s*\d{1,2}[A-Za-z]?/, '').replace(/^[\s.:–-]+/, '').trim();
      if (rest && !(rest.length <= 80 && rest === rest.toUpperCase())) continue; // una frase que lo cita, no su título
      const titulo = text.slice(entry.start, entry.end).split('\n').map(line => line.trim()).filter(Boolean).slice(0, 2).join(' — ')
        .replace(/\s+/g, ' ').slice(0, 160);
      porClave.set(clave(entry.word, entry.number), { palabra: entry.word, numero: entry.number, titulo, origen: 'pliego' });
    }
  }
  for (const document of usable) {
    if (document.document_type === 'pliego') continue;
    const named = agt002FormatoReference(document.name);
    if (!named) continue;
    const key = clave(named.word, named.number.toUpperCase());
    if (!porClave.has(key)) {
      porClave.set(key, { palabra: named.word, numero: named.number.toUpperCase(), titulo: String(document.name).replace(/\.[a-z0-9]+$/i, '').slice(0, 160), origen: 'archivo' });
    }
  }
  const orden = value => { const match = /^(\d+)([A-Z]?)$/.exec(value); return match ? Number(match[1]) * 100 + (match[2] ? match[2].charCodeAt(0) : 0) : 9999; };
  return [...porClave.values()].sort((a, b) => a.palabra.localeCompare(b.palabra) || orden(a.numero) - orden(b.numero));
}
