// AGT-002 — mejora 6 (encargo desde Terminal, 2026-11-04): un Word que se presenta no puede salir dañado ni llevar
// notas internas.
//
// Lo que pasó en Terminal (TT-SPO-07): once anexos editados por el agente abrían en LibreOffice y Word los daba por
// dañados; y dentro de los anexos iban notas para revisión, una diciendo que la disponibilidad de vehículos no estaba
// confirmada. Este módulo hace las dos revisiones antes de que el Word llegue al expediente:
//
//   1. El paquete, mirado como lo mira Word: contenedor zip sin entradas repetidas, `[Content_Types].xml`, relaciones
//      del paquete, `word/document.xml` con raíz `w:document`, todo XML bien formado, cada relación interna apunta a
//      una parte que existe, cada parte tiene tipo de contenido, todo prefijo de `mc:Ignorable` está declarado y no hay
//      prefijos renombrados `nsN` (el daño exacto de Terminal). LibreOffice perdona lo que Word no.
//   2. Las notas internas: un bloque del borrador que es una nota para el equipo («nota interna», «para revisión», «no
//      radicar»…) no va en el documento; se saca y se dice en lo que falta, que es donde Katherine lo lee. Las marcas
//      [[...]] no son notas: son los espacios en amarillo que se deciden antes de firmar.

import path from 'node:path';
import AdmZip from 'adm-zip';
import { DOMParser } from '@xmldom/xmldom';

const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

const NOTA_INTERNA = /\b(nota\s+(interna|para\s+(el\s+equipo|revisi[oó]n)|de\s+revisi[oó]n|del\s+agente|de\s+vig-?ia)|para\s+revisi[oó]n\s+interna|comentario\s+interno|uso\s+interno|no\s+radicar|no\s+presentar\s+este\s+texto|borrar\s+antes\s+de\s+(radicar|presentar|enviar))\b/i;

/** ¿Este texto es una nota para el equipo y no parte del documento? */
export function agt002EsNotaInterna(value) {
  return typeof value === 'string' && NOTA_INTERNA.test(value);
}

function blockTexts(block) {
  if (!block || typeof block !== 'object') return [];
  return [block.text, ...(Array.isArray(block.items) ? block.items : []), ...(Array.isArray(block.header) ? block.header : []),
    ...(Array.isArray(block.rows) ? block.rows.flat() : [])].filter(value => typeof value === 'string');
}

const corto = value => (value.length > 160 ? `${value.slice(0, 160)}…` : value);

/**
 * Saca del documento los bloques que son notas internas (y los ítems de lista que lo son). Devuelve el documento
 * limpio y la lista de lo que se sacó, para decirlo en «lo que falta». No toca título, destinatario ni firma: si
 * alguno trae una nota, el documento no se arma (se rechaza como inválido) porque no hay cómo quitarla sin romperlo.
 */
export function agt002QuitarNotasInternas(document) {
  const quitadas = [];
  if (!document || typeof document !== 'object' || !Array.isArray(document.blocks)) return { document, quitadas };
  for (const fijo of [document.title, document.subject, document.city_date, document.closing, ...(document.recipient || []), ...(document.signature || [])]) {
    if (agt002EsNotaInterna(fijo)) {
      throw Object.assign(new Error('El encabezado o la firma del borrador traen una nota interna.'), { code: 'AGT002_DOCUMENT_INTERNAL_NOTE' });
    }
  }
  const blocks = [];
  for (const block of document.blocks) {
    if (block?.kind === 'list' && Array.isArray(block.items)) {
      const items = block.items.filter(item => !agt002EsNotaInterna(item) || (quitadas.push(corto(item)), false));
      if (items.length) blocks.push({ ...block, items });
      continue;
    }
    const nota = blockTexts(block).find(agt002EsNotaInterna);
    if (nota) { quitadas.push(corto(nota)); continue; }
    blocks.push(block);
  }
  if (!blocks.length) {
    throw Object.assign(new Error('El borrador sólo traía notas internas.'), { code: 'AGT002_DOCUMENT_INTERNAL_NOTE' });
  }
  return { document: { ...document, blocks }, quitadas };
}

function strictParser() {
  // xmldom 0.8 lee `errorHandler`. También la advertencia corta: xmldom cierra solo una etiqueta sin cerrar y apenas
  // avisa, y Word ese XML lo da por dañado. Un Word armado con la plantilla y LibreOffice no produce ninguna (comprobado
  // el 2026-11-05 con 16 partes).
  const corta = message => { throw new Error(message); };
  return new DOMParser({ errorHandler: { warning: corta, error: corta, fatalError: corta } });
}

function parseXml(entry) {
  return strictParser().parseFromString(entry.getData().toString('utf8'), 'application/xml');
}

function relsSourceDir(relsName) {
  // `word/_rels/document.xml.rels` describe `word/document.xml`; `_rels/.rels`, la raíz del paquete.
  const dir = path.posix.dirname(path.posix.dirname(relsName));
  return dir === '.' ? '' : dir;
}

/**
 * Revisa el .docx como lo abriría Word. Devuelve `{ ok, problemas }`; `problemas` son textos cortos sin contenido
 * del documento. No modifica nada.
 */
export function agt002ValidarDocx(bytes) {
  const problemas = [];
  let entries;
  try {
    entries = new AdmZip(Buffer.from(bytes)).getEntries();
  } catch (error) {
    return { ok: false, problemas: [String(error?.message || '').startsWith('ADM-ZIP: Duplicate entry name') ? 'entradas repetidas en el paquete' : 'no es un paquete zip válido'] };
  }
  const byName = new Map(entries.filter(entry => !entry.isDirectory).map(entry => [entry.entryName, entry]));
  for (const requerida of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']) {
    if (!byName.has(requerida)) problemas.push(`falta ${requerida}`);
  }
  if (problemas.length) return { ok: false, problemas };

  const xml = new Map();
  for (const [name, entry] of byName) {
    if (!/\.(xml|rels)$/i.test(name)) continue;
    try { xml.set(name, parseXml(entry)); } catch { problemas.push(`XML mal formado en ${name}`); }
  }
  if (problemas.length) return { ok: false, problemas };

  const root = xml.get('word/document.xml').documentElement;
  if (root?.localName !== 'document') problemas.push('word/document.xml no tiene raíz w:document');

  // El daño real de Terminal (4-nov, memoria `editar-docx-sin-danarlo`): ElementTree renombró los prefijos a `nsN` y
  // borró las declaraciones de `w14`, `wp14`, `w15`, que seguían nombradas en `mc:Ignorable`. El XML queda bien
  // formado y LibreOffice lo abre; Word lo da por dañado.
  for (const [name, doc] of xml) {
    const element = doc.documentElement;
    if (!element) continue;
    const declarados = new Set(Array.from(element.attributes || [])
      .filter(attr => attr.name.startsWith('xmlns:')).map(attr => attr.name.slice('xmlns:'.length)));
    const ignorable = Array.from(element.attributes || []).find(attr => attr.localName === 'Ignorable' && attr.namespaceURI === MC_NS);
    for (const prefijo of String(ignorable?.value || '').split(/\s+/).filter(Boolean)) {
      if (!declarados.has(prefijo)) problemas.push(`mc:Ignorable nombra un prefijo sin declarar en ${name}: ${prefijo}`);
    }
    const texto = byName.get(name).getData().toString('utf8');
    if (/<\/?ns\d+:|\sxmlns:ns\d+=/.test(texto)) problemas.push(`prefijos renombrados (nsN) en ${name}`);
  }

  const types = xml.get('[Content_Types].xml').documentElement;
  const defaults = new Set(Array.from(types.getElementsByTagName('Default')).map(node => String(node.getAttribute('Extension')).toLowerCase()));
  const overrides = new Set(Array.from(types.getElementsByTagName('Override')).map(node => String(node.getAttribute('PartName')).replace(/^\//, '')));
  for (const name of byName.keys()) {
    if (name === '[Content_Types].xml') continue;
    // `.rels` no tiene extensión para path.extname (lo toma por archivo oculto): se lee lo que va después del último punto.
    const base = path.posix.basename(name);
    const extension = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : '';
    if (!overrides.has(name) && !defaults.has(extension)) problemas.push(`sin tipo de contenido: ${name}`);
  }
  for (const override of overrides) {
    if (!byName.has(override)) problemas.push(`tipo de contenido para una parte que no existe: ${override}`);
  }

  for (const [name, doc] of xml) {
    if (!name.endsWith('.rels')) continue;
    const base = relsSourceDir(name);
    for (const rel of Array.from(doc.getElementsByTagName('Relationship'))) {
      if (String(rel.getAttribute('TargetMode')).toLowerCase() === 'external') continue;
      const target = String(rel.getAttribute('Target') || '');
      const resolved = target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(base, target));
      if (!byName.has(resolved)) problemas.push(`relación rota en ${name}: ${target}`);
    }
  }
  return { ok: problemas.length === 0, problemas };
}
