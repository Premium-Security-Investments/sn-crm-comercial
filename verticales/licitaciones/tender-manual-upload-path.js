// Ruta de almacenamiento para la carga manual de documentos de licitación con URL firmada: el navegador sube directo
// al almacenamiento y la petición a la API no lleva los bytes.
//
// Lo pidió Juan el 2026-10-23, cuando Supersalud falló con **413**. La carga mandaba todos los archivos en base64
// dentro del JSON, y una función de Vercel no admite más de 4,5 MB de cuerpo: con el 33% que infla base64, el techo
// real eran unos 3 MB POR LOTE, no los 50 MB que promete `RUP_MAX_BYTES` ni los 25 MB de `express.json`. La petición
// moría en la plataforma, así que ninguna de esas validaciones alcanzaba a correr y el error no decía qué pasaba.
//
// Módulo puro: sin red, sin base de datos, sin express. La ruta la firma el servidor y la vuelve a verificar al
// procesar, porque entre las dos llamadas el cliente la tiene en la mano y podría cambiarla.

import { createHash } from 'node:crypto';

export const TENDER_MANUAL_UPLOAD_PREFIX = 'manual-uploads/';

/** Carpeta de una oportunidad. Termina en `/` para que un prefijo no se confunda con otro id más largo. */
export function tenderManualUploadFolder(opportunityId) {
  return `${TENDER_MANUAL_UPLOAD_PREFIX}${opportunityId}/`;
}

/**
 * Ruta única e irrepetible para un archivo. Lleva la oportunidad, quién carga, el momento, el nombre y el tamaño,
 * así que dos cargas del mismo archivo no se pisan: la identidad por contenido la resuelve después
 * `tenderManualUploadDocumentId`, que es la que evita versiones duplicadas.
 */
export function tenderManualUploadStoragePath({ opportunityId, profileId, name, size, now = Date.now() }) {
  const id = createHash('sha256')
    .update(`tender-upload:${opportunityId}:${profileId}:${now}:${name}:${size}`)
    .digest('hex').slice(0, 24);
  return `${tenderManualUploadFolder(opportunityId)}${id}-${name}`;
}

/**
 * ¿La ruta es una que esta API firmó para ESTA oportunidad? Nadie sube a la carpeta de otra, ni se sale de la
 * carpeta con `..`, ni cuela una ruta absoluta. Se verifica al procesar, no sólo al firmar.
 */
export function isTenderManualUploadStoragePath(storagePath, opportunityId) {
  const path = String(storagePath || '');
  if (!path || !opportunityId) return false;
  if (path.includes('..') || path.startsWith('/') || path.includes('\\')) return false;
  const folder = tenderManualUploadFolder(opportunityId);
  if (!path.startsWith(folder)) return false;
  // Un solo nivel: el archivo va en la carpeta de la oportunidad, no en una subcarpeta inventada.
  const rest = path.slice(folder.length);
  return rest.length > 0 && !rest.includes('/');
}
