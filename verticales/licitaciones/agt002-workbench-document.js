// AGT-002 — de borrador a Word, del lado del CRM (mejora 5).
//
// El drain de la Mesa corre en Vercel, donde no hay LibreOffice. Por eso el Word lo arma el puente de Vig-IA en el
// servidor de tareas (`renderDocument`) y aquí sólo se guarda: en el almacenamiento del CRM, dentro de la carpeta
// del proceso, bajo `borradores-vigia/<trabajo>/`. Esa copia es el original tal como lo produjo Vig-IA y no se
// modifica; la copia de trabajo, la que Katherine corrige y firma, va a SharePoint (decisión de Juan, 2026-11-03:
// "en ambos lados"). La versión del artefacto en el expediente enlaza las dos.
//
// Lo que esto NO hace: no registra el archivo como documento del pliego (no entra al análisis), no lo carga como
// soporte de la empresa (eso sería aprobar evidencia) y no lo envía a nadie.

import { agt002DocumentFileName } from './agt002-document-render.js';
import { agt002QuitarNotasInternas, agt002ValidarDocx } from './agt002-docx-validation.js';
import { agt002LeerCiudadFechaDePresentacion, agt002PonerFechaDePresentacion } from './agt002-fecha-de-presentacion.js';

export const AGT002_DRAFT_BUCKET = 'tender-documents';
export const AGT002_DRAFT_FOLDER = 'borradores-vigia';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const METADATA_MAX = 7500;

/** Dónde queda el original de un borrador. El prefijo del bucket va dentro del nombre, como en el resto del CRM. */
export function agt002DraftStoragePath({ opportunityId, jobId, fileName }) {
  return `${AGT002_DRAFT_BUCKET}/${opportunityId}/${AGT002_DRAFT_FOLDER}/${jobId}/${fileName}`;
}

/** Un `storage_path` sólo se sirve si es un borrador de ESTA oportunidad: nunca otra ruta del bucket. */
export function isAgt002DraftStoragePath(storagePath, opportunityId) {
  const prefix = `${AGT002_DRAFT_BUCKET}/${opportunityId}/${AGT002_DRAFT_FOLDER}/`;
  return typeof storagePath === 'string' && storagePath.startsWith(prefix)
    && !storagePath.includes('..') && /^[0-9a-f-]{36}\/[A-Za-z0-9._-]+\.docx$/.test(storagePath.slice(prefix.length));
}

/** Lo que va a `content_metadata`: dónde está el Word y qué falta, acotado al tope del contrato (8000). */
export function agt002DraftMetadata({ storagePath, fileName, sha256, bytes, generatedAt, missingInformation = [] }) {
  const metadata = {
    archivo: { almacen: 'crm', storage_path: storagePath, nombre: fileName, sha256, bytes, generado_en: generatedAt },
    // La copia de trabajo en SharePoint la sube el servidor de tareas; hasta entonces, pendiente.
    sharepoint: { estado: 'pendiente' },
    falta: [],
  };
  for (const item of missingInformation) {
    metadata.falta.push(String(item).slice(0, 600));
    if (JSON.stringify(metadata).length > METADATA_MAX) { metadata.falta.pop(); break; }
  }
  return metadata;
}

export function createAgt002DraftDocumentProducer({ database, bridgeClient, now = () => new Date() } = {}) {
  if (!database?.storage || typeof database.storage.from !== 'function') throw new TypeError('database.storage es obligatorio.');
  if (!bridgeClient || typeof bridgeClient.renderDocument !== 'function') throw new TypeError('El cliente del puente no sabe armar documentos.');
  return async function produceDocument({ input, document, missingInformation = [] }) {
    // Mejora 6: las notas para el equipo no van en el Word; lo que se saca se dice en «lo que falta».
    const { document: sinNotas, quitadas } = agt002QuitarNotasInternas(document);
    const avisos = quitadas.map(nota => `Se sacó del Word una nota interna: «${nota}». Si era parte del documento, agréguela a mano.`);
    // Mejora 6: la línea «Ciudad, fecha» es la sede principal y el día del cierre; la pone el servidor, no el modelo.
    const fecha = agt002PonerFechaDePresentacion(sinNotas, await agt002LeerCiudadFechaDePresentacion(database, { tenderId: input.tender_id }));
    const limpio = fecha.document;
    if (fecha.aviso) avisos.push(fecha.aviso);
    const { bytes, sha256 } = await bridgeClient.renderDocument({ document: limpio });
    // Mejora 6: el paquete se revisa como lo abre Word; uno que sólo abre en LibreOffice no llega al expediente.
    const revision = agt002ValidarDocx(bytes);
    if (!revision.ok) {
      console.warn('agt002_document_invalid_package', { event: 'agt002_document_invalid_package', job_id: input.job_id, problemas: revision.problemas.slice(0, 5) });
      throw Object.assign(new Error('El Word armado no pasó la revisión del paquete.'), { code: 'AGT002_DOCUMENT_INVALID_PACKAGE' });
    }
    const fileName = agt002DocumentFileName(limpio?.title);
    const storagePath = agt002DraftStoragePath({ opportunityId: input.opportunity_id, jobId: input.job_id, fileName });
    const { error } = await database.storage.from(AGT002_DRAFT_BUCKET).upload(storagePath, bytes, { contentType: DOCX_MIME, upsert: false });
    if (error) throw Object.assign(new Error('No se pudo guardar el Word en el CRM.'), { code: 'AGT002_DOCUMENT_STORAGE_FAILED' });
    const metadata = agt002DraftMetadata({ storagePath, fileName, sha256, bytes: bytes.length, generatedAt: now().toISOString(), missingInformation: [...avisos, ...missingInformation] });
    return avisos.length ? { ...metadata, avisos: avisos } : metadata;
  };
}
