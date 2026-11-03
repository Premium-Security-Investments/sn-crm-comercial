// AGT-002 — el sentido que faltaba del puente: del CRM a SharePoint (mejora 1 del encargo del
// 2026-10-31, autorizado por Juan el 2026-11-02).
//
// **El caso:** los 15 documentos oficiales de Terminal estaban en el CRM y no en SharePoint. Los
// subió Juan a mano. Es el primero de los tres casos del encargo, y el único de los tres que exige
// escribir.
//
// ## Lo que este módulo decide, y lo que NO
//
// Decide **qué falta**. No sube nada: eso lo hace el ejecutor, con `subir.py`, que relee y compara
// después de cada escritura y se niega a sobreescribir sin que alguien lo pida a sabiendas.
//
// Y no decide **dónde archivar**. Las carpetas numeradas de cada proceso (`01_Pliegos`,
// `02_Respuestas_observaciones`, …) son trabajo curado de una persona: meter ahí un archivo por una
// regla de nombre es apostar a no equivocarse en la carpeta de otro. Todo va a una sola carpeta
// marcada, `99_Del_CRM`, y si alguien quiere archivarlo bien, lo mueve. Preferir una carpeta fea a
// un archivo mal archivado.
//
// ## Dos trampas de los datos reales, las dos medidas
//
//  1. **El CRM tiene duplicados.** La «ADENDA No. 02» de Terminal está dos veces, una de `secop ii`
//     y otra de `carga manual`, con el mismo contenido. Sin deduplicar, el puente intentaría subir
//     la misma cosa dos veces; la segunda la rechazaría `subir.py`, pero el informe mentiría.
//  2. **`storage_path` ya incluye el bucket.** Las rutas vienen como
//     `tender-documents/<oportunidad>/…`, así que pedirlas con el bucket otra vez da 404 `NoSuchKey`
//     —la llave sirve y la ruta no—. El ejecutor le quita el prefijo; aquí se deja dicho.
//
// Módulo puro: sin red, sin base de datos, sin express.

export const AGT002_CRM_TO_SHAREPOINT_FOLDER = '99_Del_CRM';

const fileName = path => String(path || '').split('/').pop() || '';
/** Nombres comparables: SharePoint y el CRM no coinciden en espacios ni en mayúsculas. */
const key = name => String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Hash del contenido, sacado del nombre del objeto en el almacenamiento: las rutas del CRM terminan
 * en `<64 hex>-<nombre>`, y esos 64 son el sha256 del archivo. Es la única identidad **exacta** que
 * hay, y hace falta porque el CRM guarda el mismo documento dos veces con el nombre corrompido de
 * dos formas distintas —medido en Supersalud: «Resolucio_n de apertura.pdf» y «Resoluci_n de
 * apertura.pdf», las dos de 231 KB, el mismo acto administrativo—. Deduplicar por nombre no las ve.
 */
export function agt002ContentHashFromStoragePath(storagePath) {
  const name = String(storagePath || '').split('/').pop() || '';
  const match = /^([0-9a-f]{64})-/.exec(name);
  return match ? match[1] : null;
}

/**
 * Carpeta del proceso en SharePoint para una licitación, por su referencia. Las carpetas reales se
 * llaman «TERMINAL DE TRANSPORTE S.A. - TT-SPO-07-2026», así que la referencia aparece dentro del
 * nombre. Un proceso cuya carpeta no exista devuelve null y **no se crea**: crear carpetas de
 * procesos es decisión de quien organiza el expediente, no del puente.
 */
export function agt002ProcessFolderForRef(folders = [], ref = '') {
  const needle = key(ref);
  if (!needle) return null;
  return (folders || []).find(folder => key(folder).includes(needle)) || null;
}

/** Sin acentos, sin puntuación, sin dobles espacios: «FISCALÍA ... NACIÓN» contra «FISCALIA ... NACION». */
const plain = value => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Empareja cada licitación con su carpeta de proceso. La primera versión emparejaba sólo por
 * referencia y encontró **1 de 18**: las carpetas no se nombran de forma sistemática. Supersalud
 * tiene carpeta («SUPERINTENDENCIA NACIONAL DE SALUD») y no la encontraba porque ese nombre no trae
 * la referencia.
 *
 * Dos reglas, en orden, y la segunda con el freno puesto:
 *
 *  1. **Por referencia dentro del nombre.** Es exacta y es la que manda.
 *  2. **Por nombre de entidad**, sólo si la pareja es **única en los dos sentidos**: una sola carpeta
 *     calza con esa entidad, y esa carpeta no la reclama ninguna otra licitación. El freno no es
 *     teórico: hay **cuatro** licitaciones de la Rama Judicial, y sin él las cuatro apuntarían a la
 *     misma carpeta y se mezclarían los documentos de cuatro procesos distintos. Un documento mal
 *     archivado en el expediente de otro proceso es peor que un documento sin archivar.
 *
 * Lo que no calza sale con su motivo —`sin_carpeta` o `carpeta_ambigua`— y no se adivina.
 */
export function agt002MapTendersToProcessFolders(folders = [], tenders = []) {
  const result = new Map();
  const taken = new Set();

  for (const tender of tenders || []) {
    const folder = agt002ProcessFolderForRef(folders, tender?.ref);
    if (folder) { result.set(tender.id, { folder, reason: 'referencia' }); taken.add(folder); }
  }

  // Candidatos por entidad, contando en los dos sentidos antes de decidir nada.
  const byFolder = new Map();
  const candidates = new Map();
  for (const tender of tenders || []) {
    if (result.has(tender?.id)) continue;
    const entity = plain(tender?.entity);
    if (!entity || entity.length < 6) continue;
    const matches = (folders || []).filter(folder => !taken.has(folder) && plain(folder).includes(entity));
    candidates.set(tender.id, matches);
    for (const folder of matches) byFolder.set(folder, (byFolder.get(folder) || 0) + 1);
  }
  for (const tender of tenders || []) {
    if (result.has(tender?.id)) continue;
    const matches = candidates.get(tender?.id) || [];
    if (matches.length === 0) { result.set(tender.id, { folder: null, reason: 'sin_carpeta' }); continue; }
    if (matches.length > 1) { result.set(tender.id, { folder: null, reason: 'carpeta_ambigua' }); continue; }
    if (byFolder.get(matches[0]) > 1) { result.set(tender.id, { folder: null, reason: 'carpeta_ambigua' }); continue; }
    result.set(tender.id, { folder: matches[0], reason: 'entidad' });
  }
  return result;
}

/**
 * Qué documentos del CRM no están en la carpeta del proceso en SharePoint.
 *
 * Compara por **nombre de archivo**, en cualquier subcarpeta del proceso: si el documento ya está
 * archivado en `01_Pliegos`, no se vuelve a subir a `99_Del_CRM`. Deduplica por nombre, quedándose
 * con el primero, porque el CRM tiene el mismo documento cargado dos veces por dos vías.
 */
export function agt002CrmToSharepointPlan({ crmDocuments = [], sharepointFiles = [] } = {}) {
  const present = new Set((sharepointFiles || []).map(file => key(fileName(file?.ruta ?? file?.path ?? ''))));
  const plan = [];
  const seen = new Set();
  const seenHashes = new Set();
  for (const document of crmDocuments || []) {
    const name = String(document?.name || '').trim();
    const storagePath = String(document?.storage_path || '').trim();
    if (!name || !storagePath) continue;
    // Primero por contenido, que es exacto; después por nombre, para las rutas sin hash.
    const hash = agt002ContentHashFromStoragePath(storagePath);
    if (hash) {
      if (seenHashes.has(hash)) continue;
      seenHashes.add(hash);
    }
    const id = key(name);
    if (seen.has(id)) continue;
    seen.add(id);
    if (present.has(id)) continue;
    plan.push({
      name,
      storagePath,
      mimeType: String(document?.mime_type || 'application/octet-stream'),
      sizeBytes: Number(document?.size_bytes) || null,
      source: String(document?.source || ''),
    });
  }
  return plan;
}

/**
 * Las dos rutas candidatas del objeto dentro del bucket, **en el orden en que hay que probarlas**.
 *
 * La trampa está documentada así: «el bucket es `tender-documents` y el nombre del objeto ya incluye
 * ese prefijo: la URL lleva `tender-documents` dos veces. Un 404 `NoSuchKey` significa que la llave
 * sirve y la ruta no». O sea que al cliente hay que darle la ruta **completa**, con el prefijo, y él
 * le pone el bucket encima.
 *
 * Yo la entendí al revés en la primera versión —quité el prefijo— y las 13 descargas de la primera
 * corrida real fallaron. Nada se subió y nada se dañó, porque el fallo es ruidoso, pero perdí una
 * corrida. Así que ahora se devuelven las dos y quien descarga prueba en orden: primero la completa,
 * que es la documentada, y si no, la recortada. La corrida dice cuál sirvió en vez de que yo adivine.
 */
export function agt002StorageObjectPaths(storagePath, bucket = 'tender-documents') {
  const text = String(storagePath || '').trim().replace(/^\/+/, '');
  if (!text) return [];
  const sinPrefijo = text.startsWith(`${bucket}/`) ? text.slice(bucket.length + 1) : null;
  return sinPrefijo ? [text, sinPrefijo] : [text];
}

/** Una línea por proceso, para dejar dicho qué se subió y qué no. */
export function agt002CrmToSharepointLine({ ref, folder, uploaded = 0, skipped = 0, failed = 0, pending = 0 }) {
  if (!uploaded && !failed && !pending) return null;
  const partes = [];
  if (uploaded) partes.push(`${uploaded} documento(s) del CRM subido(s) a «${folder}/${AGT002_CRM_TO_SHAREPOINT_FOLDER}»`);
  if (pending) partes.push(`${pending} quedaron sin subir en esta corrida`);
  if (failed) partes.push(`${failed} fallaron`);
  return `Vig-IA, puente SharePoint: ${partes.join('; ')}${skipped ? ` (${skipped} ya estaban en la carpeta del proceso)` : ''}. Van a una carpeta aparte a propósito: archivarlos en la estructura del expediente es decisión de una persona.`;
}
