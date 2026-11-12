// La carpeta del proceso (Juan, 2026-11-12: «Mesa y Vig-IA deben ser iguales a usted»). El agente de código responde
// buscando en el texto completo de los documentos, leyendo el bloque entero y volviendo a buscar antes de decir «no
// consta»; la Mesa sólo recibía fragmentos. Con esta carpeta el puente le da al modelo buscar, leer y listar sobre el
// texto completo del proceso, y nada más.
//
// Este contrato lo comparten quien arma la carpeta (el CRM), quien la transporta (el puente) y quien la escribe en disco
// (el cliente de Claude): una ruta o un tamaño que no pasa aquí no llega al disco.

export const AGT002_CARPETA_MAX_ARCHIVOS = 300;
export const AGT002_CARPETA_MAX_BYTES = 14 * 1024 * 1024;
const SEGMENTO = '[0-9A-Za-z][0-9A-Za-z._ ()-]{0,119}';
const RUTA = new RegExp(`^${SEGMENTO}(?:/${SEGMENTO}){0,2}$`);

function falla(motivo) {
  return Object.assign(new Error(`La carpeta del proceso no es válida: ${motivo}.`), { code: 'AGT002_CARPETA_INVALIDA' });
}

/**
 * Devuelve la lista de archivos normalizada o lanza. Las rutas son relativas, de hasta tres niveles, sin «..» ni
 * rutas absolutas (cada segmento empieza con letra o número), y no se repiten.
 */
export function validarAgt002Carpeta(carpeta) {
  if (carpeta === null || typeof carpeta !== 'object' || Array.isArray(carpeta)) throw falla('no es un objeto');
  const claves = Object.keys(carpeta);
  if (claves.length !== 1 || claves[0] !== 'archivos' || !Array.isArray(carpeta.archivos)) throw falla('sólo se admite «archivos»');
  if (carpeta.archivos.length === 0 || carpeta.archivos.length > AGT002_CARPETA_MAX_ARCHIVOS) throw falla('número de archivos fuera de rango');
  const vistas = new Set();
  let bytes = 0;
  const archivos = carpeta.archivos.map(archivo => {
    if (archivo === null || typeof archivo !== 'object' || Array.isArray(archivo)) throw falla('archivo mal formado');
    const { ruta, texto } = archivo;
    if (typeof ruta !== 'string' || !RUTA.test(ruta)) throw falla('ruta no permitida');
    if (typeof texto !== 'string') throw falla('texto no es una cadena');
    const clave = ruta.toLowerCase();
    if (vistas.has(clave)) throw falla('ruta repetida');
    vistas.add(clave);
    bytes += Buffer.byteLength(texto, 'utf8');
    if (bytes > AGT002_CARPETA_MAX_BYTES) throw falla('excede el tamaño permitido');
    return Object.freeze({ ruta, texto });
  });
  return Object.freeze(archivos);
}
