// Un ZIP sin compresión (método `store`), armado en memoria y sin dependencias.
//
// Para qué: el paquete de la oferta se arma **en el navegador**, no en el servidor. Una función sin servidor no
// puede devolver 30 MB de respuesta, y los documentos de una licitación los pasan fácil; el navegador, en cambio, ya
// tiene cada archivo porque los baja uno por uno con su propia autorización. Esto es lo único que faltaba para
// juntarlos.
//
// Sin compresión a propósito: los PDF, los DOCX y los XLSX ya vienen comprimidos, así que `deflate` no ahorraría
// nada y sí traería una dependencia nueva al navegador. `store` es el formato más simple que todo descompresor
// entiende, incluido el Explorador de Windows.
//
// Módulo puro y neutro: sólo `Uint8Array`, `TextEncoder` y `DataView`. Corre igual en el navegador y en Node, que es
// lo que permite probarlo leyéndolo de vuelta con una librería real.

const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Fecha y hora en el formato MS-DOS que exige el ZIP: segundos en pasos de dos y años desde 1980. */
function dosDateTime(date) {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (Math.floor(date.getUTCSeconds() / 2) & 0x1f),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

function asBytes(content) {
  if (content === null || content === undefined) return new Uint8Array(0);
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (typeof content === 'string') return encoder.encode(content);
  throw new TypeError('El contenido de una entrada del ZIP debe ser texto o bytes.');
}

/** Nombre dentro del ZIP: barras normales, sin raíz absoluta, sin `..` y sin barras repetidas. */
export function zipEntryName(name) {
  const clean = String(name ?? '')
    .replace(/\\/g, '/')
    .split('/')
    // Cada tramo se recorta: un nombre de puros espacios no es un nombre, y los espacios al borde de una carpeta
    // dan problemas en Windows.
    .map(part => part.trim())
    .filter(part => part && part !== '.' && part !== '..')
    .join('/');
  if (!clean) throw new TypeError('Una entrada del ZIP necesita nombre.');
  return clean;
}

/**
 * Arma el ZIP. `entries` es una lista de `{ name, content }` —texto o bytes— y `folders` una lista de carpetas que
 * deben existir **aunque queden vacías**, que es justo lo que pide el paquete de la oferta: las doce carpetas
 * siempre, para que quien lo reciba vea lo que falta y no sólo lo que hay.
 */
export function zipStore({ entries = [], folders = [], now = new Date() } = {}) {
  const stamp = dosDateTime(now);
  const parts = [];
  const central = [];
  let offset = 0;

  const push = (name, content, isFolder) => {
    const bytes = asBytes(content);
    const nameBytes = encoder.encode(isFolder ? `${name}/` : name);
    const crc = isFolder ? 0 : crc32(bytes);

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    // Bit 11: el nombre viaja en UTF-8. Sin esto, "Jurídico" y "Económico" salen con la tilde rota.
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, stamp.time, true);
    localView.setUint16(12, stamp.date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, bytes.length, true);
    localView.setUint32(22, bytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    parts.push(local);
    if (bytes.length) parts.push(bytes);

    const header = new Uint8Array(46 + nameBytes.length);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, 0x02014b50, true);
    headerView.setUint16(4, 20, true);
    headerView.setUint16(6, 20, true);
    headerView.setUint16(8, 0x0800, true);
    headerView.setUint16(10, 0, true);
    headerView.setUint16(12, stamp.time, true);
    headerView.setUint16(14, stamp.date, true);
    headerView.setUint32(16, crc, true);
    headerView.setUint32(20, bytes.length, true);
    headerView.setUint32(24, bytes.length, true);
    headerView.setUint16(28, nameBytes.length, true);
    headerView.setUint16(30, 0, true);
    headerView.setUint16(32, 0, true);
    headerView.setUint16(34, 0, true);
    headerView.setUint16(36, 0, true);
    // Atributos externos: una carpeta se marca con el bit de directorio de MS-DOS.
    headerView.setUint32(38, isFolder ? 0x10 : 0, true);
    headerView.setUint32(42, offset, true);
    header.set(nameBytes, 46);
    central.push(header);

    offset += local.length + bytes.length;
  };

  const seen = new Set();
  for (const folder of folders) {
    const name = zipEntryName(folder);
    if (seen.has(`${name}/`)) continue;
    seen.add(`${name}/`);
    push(name, null, true);
  }
  for (const entry of entries) {
    const name = zipEntryName(entry?.name);
    if (seen.has(name)) throw new TypeError(`El ZIP no puede llevar dos entradas con el mismo nombre: ${name}`);
    seen.add(name);
    push(name, entry?.content, false);
  }

  const centralSize = central.reduce((total, header) => total + header.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, central.length, true);
  endView.setUint16(10, central.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  const total = offset + centralSize + end.length;
  const zip = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...parts, ...central, end]) {
    zip.set(part, cursor);
    cursor += part.length;
  }
  return zip;
}
