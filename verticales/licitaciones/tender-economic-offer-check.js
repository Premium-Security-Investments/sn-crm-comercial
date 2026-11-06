// Mejora 5 (encargo desde Terminal, 2026-11-04): revisar la propuesta económica antes de radicar.
//
// En TT-SPO-07 (Anexo 9) la casilla del valor unitario se llena SIN IVA y el techo está CON IVA: escribir el techo tal
// cual era rechazo, y escribir 92.026 en el botón de pánico también (con IVA da 109.511 y el techo era 93.382). Además
// las once casillas venían en cero de fábrica, y un cero es rechazo.
//
// Lo que hace, sin adivinar (criterio §8.5: el validador es genérico; el tope exacto lo propone Vig-IA y lo confirma
// Katherine):
//   1. Encuentra las casillas que se llenan: las desbloqueadas que tienen un número, o que están vacías y alguna
//      fórmula las usa.
//   2. Cada una debe ser mayor que cero y entera.
//   3. Si el Excel de la entidad trae su propia verificación (una fórmula que da «CUMPLE» / «NO CUMPLE»), la calcula con
//      los valores escritos —ahí está la regla real del IVA y del techo— y dice cuál no cumple, con los números.
// Las fórmulas se calculan con un evaluador pequeño (operaciones, comparaciones, SUM, ROUND, ROUNDUP, ROUNDDOWN, IF, AND,
// OR, MIN, MAX, ABS). Una función que no conoce deja el resultado «por confirmar». No modifica el archivo.

import AdmZip from 'adm-zip';
import { DOMParser } from '@xmldom/xmldom';

// Vercel recibe hasta 4,5 MB por pedido y el archivo viaja en base64 (un tercio más): 3 MB de Excel caben.
export const ECONOMIC_OFFER_MAX_BYTES = 3 * 1024 * 1024;
const parser = () => new DOMParser({ errorHandler: { warning() {}, error() {}, fatalError(message) { throw new Error(message); } } });
const children = (node, name) => Array.from(node?.getElementsByTagName(name) || []);
const fail = message => { throw Object.assign(new Error(message), { code: 'ECONOMIC_OFFER_INVALID' }); };

// ---------- referencias ----------
const colToNumber = col => col.split('').reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
const numberToCol = number => { let text = ''; while (number > 0) { const rest = (number - 1) % 26; text = String.fromCharCode(65 + rest) + text; number = Math.floor((number - 1) / 26); } return text; };
const parseRef = ref => { const match = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(ref); return match ? { col: colToNumber(match[1]), row: Number(match[2]) } : null; };
const REF = /(?<![A-Za-z0-9_.!])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g;

/** Una fórmula compartida se escribe una vez: las demás celdas la usan corrida por filas y columnas. */
function shiftFormula(formula, dr, dc) {
  return formula.replace(/"[^"]*"|('[^']*'|[A-Za-z0-9_]+)!|(\$?)([A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g, (match, _q, colAbs, col, rowAbs, row, offset, all) => {
    if (match.startsWith('"') || match.endsWith('!')) return match;
    const before = all[offset - 1];
    if (before && /[A-Za-z0-9_.]/.test(before)) return match;
    const newCol = colAbs ? col : numberToCol(colToNumber(col) + dc);
    const newRow = rowAbs ? row : String(Number(row) + dr);
    return `${colAbs}${newCol}${rowAbs}${newRow}`;
  });
}

// ---------- lectura del libro ----------
export function readWorkbook(bytes) {
  if (!bytes || bytes.length > ECONOMIC_OFFER_MAX_BYTES) fail('El archivo es demasiado grande o está vacío.');
  let zip;
  try { zip = new AdmZip(Buffer.from(bytes)); } catch { fail('No es un archivo de Excel (.xlsx) válido.'); }
  const text = name => { const entry = zip.getEntry(name); return entry ? entry.getData().toString('utf8') : null; };
  const workbookXml = text('xl/workbook.xml');
  if (!workbookXml) fail('No es un archivo de Excel (.xlsx) válido.');
  const workbook = parser().parseFromString(workbookXml, 'application/xml');
  const rels = parser().parseFromString(text('xl/_rels/workbook.xml.rels') || '<Relationships/>', 'application/xml');
  const target = new Map(children(rels, 'Relationship').map(rel => [rel.getAttribute('Id'), rel.getAttribute('Target')]));
  const shared = children(parser().parseFromString(text('xl/sharedStrings.xml') || '<sst/>', 'application/xml'), 'si')
    .map(si => children(si, 't').map(t => t.textContent || '').join(''));
  const styles = parser().parseFromString(text('xl/styles.xml') || '<styleSheet/>', 'application/xml');
  const cellXfs = styles.getElementsByTagName('cellXfs')[0];
  // Por defecto toda celda está bloqueada; sólo `<protection locked="0"/>` la deja para llenar.
  const unlockedStyle = children(cellXfs, 'xf').map(xf => children(xf, 'protection').some(p => p.getAttribute('locked') === '0'));

  return children(workbook, 'sheet').map(sheetNode => {
    const relId = sheetNode.getAttribute('r:id') || sheetNode.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const path = `xl/${String(target.get(relId) || '').replace(/^\/?xl\//, '').replace(/^\//, '')}`;
    const xml = text(path);
    const cells = new Map();
    const masters = new Map();
    if (xml) {
      const doc = parser().parseFromString(xml, 'application/xml');
      for (const c of children(doc, 'c')) {
        const ref = c.getAttribute('r');
        const type = c.getAttribute('t');
        const raw = children(c, 'v')[0]?.textContent ?? null;
        const fNode = children(c, 'f')[0] || null;
        let formula = fNode ? (fNode.textContent || '') : null;
        if (fNode && fNode.getAttribute('t') === 'shared') {
          const si = fNode.getAttribute('si');
          if (formula) masters.set(si, { ref, formula });
          else if (masters.has(si)) {
            const master = masters.get(si); const a = parseRef(master.ref); const b = parseRef(ref);
            formula = shiftFormula(master.formula, b.row - a.row, b.col - a.col);
          }
        }
        let value = null;
        if (type === 's') value = raw === null ? null : shared[Number(raw)] ?? '';
        else if (type === 'inlineStr') value = children(c, 't').map(t => t.textContent || '').join('');
        else if (type === 'str') value = raw;
        else if (type === 'b') value = raw === '1';
        else if (raw !== null && raw !== '') value = Number(raw);
        cells.set(ref, { ref, value, formula: formula || null, unlocked: Boolean(unlockedStyle[Number(c.getAttribute('s') || 0)]) });
      }
    }
    return { name: sheetNode.getAttribute('name'), cells };
  });
}

// ---------- evaluador ----------
class Unsupported extends Error {}
function tokenize(formula) {
  const tokens = []; let i = 0;
  const src = formula.replace(/^=/, '');
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === '"') { const end = src.indexOf('"', i + 1); tokens.push({ t: 'str', v: src.slice(i + 1, end) }); i = end + 1; continue; }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '<>'].includes(two)) { tokens.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/^&=<>(),:%'.includes(ch)) { tokens.push({ t: 'op', v: ch }); i += 1; continue; }
    const number = /^\d+(\.\d+)?(E[+-]?\d+)?/i.exec(src.slice(i));
    if (number) { tokens.push({ t: 'num', v: Number(number[0]) }); i += number[0].length; continue; }
    const word = /^(?:'[^']+'|[A-Za-z_][A-Za-z0-9_.]*)!?\$?[A-Z]*\$?\d*/.exec(src.slice(i));
    if (word && word[0]) { tokens.push({ t: 'word', v: word[0] }); i += word[0].length; continue; }
    throw new Unsupported(`símbolo ${ch}`);
  }
  return tokens;
}

function makeEvaluator(sheet) {
  const cache = new Map();
  const visiting = new Set();
  const cellValue = ref => {
    const key = ref.replace(/\$/g, '');
    if (cache.has(key)) return cache.get(key);
    const cell = sheet.cells.get(key);
    if (!cell) return 0;
    if (!cell.formula) return cell.value ?? 0;
    if (visiting.has(key)) throw new Unsupported('referencia circular');
    visiting.add(key);
    try { const result = evaluate(cell.formula); cache.set(key, result); return result; } finally { visiting.delete(key); }
  };
  const range = (a, b) => {
    const from = parseRef(a), to = parseRef(b);
    const values = [];
    for (let row = Math.min(from.row, to.row); row <= Math.max(from.row, to.row); row += 1)
      for (let col = Math.min(from.col, to.col); col <= Math.max(from.col, to.col); col += 1) values.push(cellValue(`${numberToCol(col)}${row}`));
    return values;
  };
  const num = value => (typeof value === 'number' ? value : typeof value === 'boolean' ? Number(value) : value === '' || value === null ? 0 : Number.isFinite(Number(value)) ? Number(value) : (() => { throw new Unsupported('texto donde va un número'); })());
  const flat = args => args.flat(Infinity);
  const roundTo = (value, digits, mode) => { const factor = 10 ** digits; const x = value * factor; const r = mode === 'up' ? Math.sign(x) * Math.ceil(Math.abs(x) - 1e-9) : mode === 'down' ? Math.sign(x) * Math.floor(Math.abs(x) + 1e-9) : Math.sign(x) * Math.round(Math.abs(x)); return r / factor; };
  const FUNCTIONS = {
    SUM: args => flat(args).reduce((total, value) => total + (typeof value === 'number' ? value : 0), 0),
    ROUND: ([value, digits = 0]) => roundTo(num(value), num(digits)),
    ROUNDUP: ([value, digits = 0]) => roundTo(num(value), num(digits), 'up'),
    ROUNDDOWN: ([value, digits = 0]) => roundTo(num(value), num(digits), 'down'),
    ABS: ([value]) => Math.abs(num(value)),
    MIN: args => Math.min(...flat(args).filter(v => typeof v === 'number')),
    MAX: args => Math.max(...flat(args).filter(v => typeof v === 'number')),
    AND: args => flat(args).every(Boolean),
    OR: args => flat(args).some(Boolean),
  };

  function evaluate(formula) {
    const tokens = tokenize(formula); let pos = 0;
    const peek = () => tokens[pos]; const take = () => tokens[pos++];
    const expect = v => { const tok = take(); if (!tok || tok.v !== v) throw new Unsupported(`se esperaba ${v}`); };
    const compare = () => {
      let left = concat();
      while (peek() && ['=', '<>', '<', '>', '<=', '>='].includes(peek().v)) {
        const op = take().v; const right = concat();
        const [a, b] = typeof left === 'string' || typeof right === 'string' ? [String(left), String(right)] : [num(left), num(right)];
        left = op === '=' ? a === b : op === '<>' ? a !== b : op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
      }
      return left;
    };
    const concat = () => { let left = additive(); while (peek()?.v === '&') { take(); left = `${left}${additive()}`; } return left; };
    const additive = () => { let left = term(); while (peek() && ['+', '-'].includes(peek().v)) { const op = take().v; const right = term(); left = op === '+' ? num(left) + num(right) : num(left) - num(right); } return left; };
    const term = () => { let left = power(); while (peek() && ['*', '/'].includes(peek().v)) { const op = take().v; const right = power(); left = op === '*' ? num(left) * num(right) : num(left) / num(right); } return left; };
    const power = () => { let left = unary(); while (peek()?.v === '^') { take(); left = num(left) ** num(unary()); } return left; };
    const unary = () => { if (peek()?.v === '-') { take(); return -num(unary()); } if (peek()?.v === '+') { take(); return unary(); } return percent(); };
    const percent = () => { let value = primary(); while (peek()?.v === '%') { take(); value = num(value) / 100; } return value; };
    const primary = () => {
      const tok = take();
      if (!tok) throw new Unsupported('fórmula incompleta');
      if (tok.t === 'num' || tok.t === 'str') return tok.v;
      if (tok.v === '(') { const value = compare(); expect(')'); return value; }
      if (tok.t === 'word') {
        if (tok.v.includes('!')) throw new Unsupported('referencia a otra hoja');
        if (peek()?.v === '(') {
          take(); const name = tok.v.toUpperCase(); const args = [];
          if (peek()?.v !== ')') { do { args.push(argument()); } while (peek()?.v === ',' && take()); }
          expect(')');
          if (name === 'IF') { const [cond, yes = true, no = false] = args; return cond ? yes : no; }
          if (!FUNCTIONS[name]) throw new Unsupported(`función ${name}`);
          return FUNCTIONS[name](args);
        }
        if (/^TRUE$/i.test(tok.v)) return true;
        if (/^FALSE$/i.test(tok.v)) return false;
        if (parseRef(tok.v)) {
          if (peek()?.v === ':') { take(); return range(tok.v, take().v); }
          return cellValue(tok.v);
        }
        throw new Unsupported(`nombre ${tok.v}`);
      }
      throw new Unsupported(`símbolo ${tok.v}`);
    };
    const argument = () => compare();
    const result = compare();
    if (pos < tokens.length) throw new Unsupported('fórmula con partes no leídas');
    return result;
  }
  return { cellValue, evaluate };
}

// ---------- la revisión ----------
const referencedCells = formula => new Set([...String(formula || '').matchAll(REF)].map(match => `${match[2]}${match[4]}`));
function rowLabel(sheet, ref) {
  const { row } = parseRef(ref);
  const texts = [...sheet.cells.values()].filter(cell => parseRef(cell.ref).row === row && typeof cell.value === 'string' && cell.value.trim() && !cell.formula)
    .sort((a, b) => parseRef(a.ref).col - parseRef(b.ref).col).map(cell => cell.value.trim());
  return texts.slice(0, 2).join(' · ').slice(0, 160) || `fila ${row}`;
}
function columnHeader(sheet, ref) {
  const { row, col } = parseRef(ref);
  for (let r = row - 1; r >= Math.max(1, row - 25); r -= 1) {
    const cell = sheet.cells.get(`${numberToCol(col)}${r}`);
    if (cell && typeof cell.value === 'string' && cell.value.trim() && !cell.formula) return cell.value.replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  return null;
}

export function checkEconomicOffer(bytes) {
  const sheets = readWorkbook(bytes);
  const casillas = [];
  const chequeos = [];
  const porConfirmar = [];
  for (const sheet of sheets) {
    const used = new Set();
    for (const cell of sheet.cells.values()) if (cell.formula) for (const ref of referencedCells(cell.formula)) used.add(ref);
    // 1-2. Las casillas que se llenan.
    for (const cell of sheet.cells.values()) {
      if (!cell.unlocked || cell.formula || typeof cell.value === 'string' || typeof cell.value === 'boolean') continue;
      if (cell.value === null && !used.has(cell.ref)) continue;
      const problemas = [];
      if (cell.value === null) problemas.push('Está vacía: una casilla sin valor es rechazo.');
      else if (cell.value <= 0) problemas.push(cell.value === 0 ? 'Está en cero: un cero es rechazo.' : 'Es negativa.');
      else if (!Number.isInteger(cell.value)) problemas.push('Tiene centavos: debe ir en pesos enteros.');
      casillas.push({ hoja: sheet.name, celda: cell.ref, columna: columnHeader(sheet, cell.ref), fila: rowLabel(sheet, cell.ref), valor: cell.value, problemas });
    }
    // 3. La verificación que trae el propio Excel.
    const { cellValue } = makeEvaluator(sheet);
    for (const cell of sheet.cells.values()) {
      if (!cell.formula || !/"(?:NO )?CUMPLE"/i.test(cell.formula)) continue;
      try {
        const resultado = cellValue(cell.ref);
        const valores = Object.fromEntries([...referencedCells(cell.formula)].map(ref => {
          let value; try { value = cellValue(ref); } catch { value = null; }
          return [ref, typeof value === 'number' ? Math.round(value * 100) / 100 : value];
        }));
        chequeos.push({ hoja: sheet.name, celda: cell.ref, fila: rowLabel(sheet, cell.ref), resultado: String(resultado), cumple: /^CUMPLE$/i.test(String(resultado)), formula: `=${cell.formula}`, valores });
      } catch (error) {
        if (!(error instanceof Unsupported)) throw error;
        porConfirmar.push({ hoja: sheet.name, celda: cell.ref, fila: rowLabel(sheet, cell.ref), motivo: `No se pudo calcular la verificación de la entidad (${error.message}): revisarla en Excel.` });
      }
    }
  }
  // Sin casillas reconocibles no se dice «listo»: se dice que hay que revisarlo a mano (Fiscalía, Anexo 4: las casillas
  // de «VALORES OFERTADOS» no están desbloqueadas ni las usa ninguna fórmula).
  if (!casillas.length) porConfirmar.push({ hoja: sheets[0]?.name || null, celda: null, fila: null, motivo: 'No identifiqué casillas para llenar (desbloqueadas o usadas por una fórmula): revise el Excel a mano contra el pliego.' });
  const casillasConProblema = casillas.filter(item => item.problemas.length);
  const chequeosQueNoCumplen = chequeos.filter(item => !item.cumple);
  return {
    listo: casillas.length > 0 && !casillasConProblema.length && !chequeosQueNoCumplen.length && !porConfirmar.length,
    resumen: {
      casillas: casillas.length,
      casillas_con_problema: casillasConProblema.length,
      chequeos_de_la_entidad: chequeos.length,
      no_cumplen: chequeosQueNoCumplen.length,
      por_confirmar: porConfirmar.length,
    },
    casillas,
    chequeos,
    por_confirmar: porConfirmar,
  };
}
