// Nuestras cartas de observaciones, de la carpeta de radicación de SharePoint al expediente del CRM (Juan, 2026-11-17).
//
// Las cartas se redactan y se dejan en `<proceso>/01_Observaciones/{Proyecto,Definitivo}` (mejora 11). Para que Vig-IA
// las tenga al analizar (agt002-nuestras-observaciones.js), tienen que estar en el expediente con origen `propio`. Este
// paso corre en el trabajo de borradores (root, cada 5 minutos, donde vive la sesión de Graph) y las carga con la misma
// secuencia que la pantalla (`ingestTenderDossierDocuments`): versionado por contenido, el reemplazo de la versión
// anterior del mismo nombre y el reanálisis incremental.
//
// Sólo lee SharePoint: nunca escribe ni mueve nada allá. De cada carta va el PDF (lo que se radica); si no hay PDF, el
// Word. La nota para quien radica, el «léeme» y la constancia no son cartas y no se cargan.
import { createHash } from 'node:crypto';
import { isAgt002OurObservationLetter } from './agt002-nuestras-observaciones.js';

const SUBFOLDERS = ['Proyecto', 'Definitivo'];
const EXTENSIONS = /\.(pdf|docx)$/i;
export const AGT002_NUESTRAS_OBSERVACIONES_MAX_POR_PASE = 4;

const stem = name => String(name || '').replace(EXTENSIONS, '').toLowerCase();
// Los mismos nombre e identidad que les da la carga del CRM (`cleanFileName` y `tenderManualUploadDocumentId` en
// server/index.js): así se reconoce lo que el expediente ya tiene, aunque una persona lo haya cargado con otro nombre.
export const agt002CrmFileName = name => String(name || 'documento').replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 140);
export const agt002ManualUploadDocumentId = buffer => `manual-${createHash('sha256').update(buffer).digest('hex').slice(0, 32)}`;

/**
 * De un listado de `01_Observaciones` (rutas relativas a la carpeta del proceso o absolutas), las cartas a cargar: una
 * por nombre base, PDF antes que Word, y sólo las que el expediente no tiene ya con el mismo nombre y tamaño. Pura.
 */
export function selectAgt002OurLettersToIngest(files, existing = []) {
  const known = new Set((existing || []).map(version => `${version.name}\u0000${Number(version.size_bytes)}`));
  const byStem = new Map();
  for (const file of files || []) {
    const parts = String(file?.ruta || '').split('/');
    const name = String(file?.nombre || parts.at(-1) || '');
    if (!SUBFOLDERS.includes(parts.at(-2)) || parts.at(-3) !== '01_Observaciones') continue;
    if (!EXTENSIONS.test(name) || !isAgt002OurObservationLetter({ name, origin: 'propio', current: true })) continue;
    const key = `${parts.at(-2)}/${stem(name)}`;
    const current = byStem.get(key);
    if (!current || (/\.pdf$/i.test(name) && !/\.pdf$/i.test(current.nombre))) byStem.set(key, { ...file, nombre: name });
  }
  return [...byStem.values()]
    .filter(file => !known.has(`${agt002CrmFileName(file.nombre)}\u0000${Number(file.bytes)}`))
    .sort((a, b) => String(b.modificado_en || '').localeCompare(String(a.modificado_en || '')));
}

// El reanálisis que pide la carga lo autoriza una persona, no Vig-IA (a nombre del agente, la admisión responde 42501,
// `evidence_package_forbidden`: 17-nov, Manizales y Pereira). Como en el cambio de fase: quien convirtió la oportunidad.
async function convertedBy(database, opportunityId) {
  const { data } = await database.from('psi_tender_processing_jobs').select('requested_by,created_at')
    .eq('opportunity_id', opportunityId).order('created_at', { ascending: true }).limit(1);
  return data?.[0]?.requested_by || null;
}

const MIME = name => (/\.pdf$/i.test(name) ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

/**
 * Un pase. `listing(path, depth)` y `download(path)` hablan con SharePoint; `ingest(args)` es la secuencia del CRM.
 * Devuelve eventos sin nombres de archivo ni rutas; nunca lanza por un proceso.
 */
export async function runAgt002OurObservationsPass(database, { listing, download, ingest, actorProfileId, limit = AGT002_NUESTRAS_OBSERVACIONES_MAX_POR_PASE }) {
  const { data: folders, error } = await database.from('psi_tender_filing_folders').select('opportunity_id,folder_path,status').eq('status', 'creada');
  if (error) throw error;
  const ids = (folders || []).map(row => row.opportunity_id);
  if (!ids.length) return [{ event: 'agt002_nuestras_observaciones_idle' }];
  const { data: opportunities, error: oppError } = await database.from('psi_sales_opportunities')
    .select('id,company_name,archived_at,deleted_at').in('id', ids);
  if (oppError) throw oppError;
  const active = new Map((opportunities || []).filter(row => !row.archived_at && !row.deleted_at).map(row => [row.id, row]));
  const events = [];
  let budget = limit;
  for (const folder of folders || []) {
    if (budget <= 0) break;
    const opportunity = active.get(folder.opportunity_id);
    if (!opportunity || !folder.folder_path) continue;
    try {
      const files = await listing(`${folder.folder_path}/01_Observaciones`, 2);
      if (!files.length) continue;
      const { data: existing, error: existingError } = await database.from('psi_tender_document_versions')
        .select('name,size_bytes,source_document_id').eq('opportunity_id', folder.opportunity_id).eq('current', true);
      if (existingError) throw existingError;
      const pending = selectAgt002OurLettersToIngest(files, existing || []).slice(0, budget);
      if (!pending.length) continue;
      const prepared = [];
      const ids = new Set((existing || []).map(version => version.source_document_id));
      for (const file of pending) {
        const buffer = await download(file.ruta);
        if (ids.has(agt002ManualUploadDocumentId(buffer))) continue;
        prepared.push({ name: file.nombre, content_base64: buffer.toString('base64'), mime_type: MIME(file.nombre), origin: 'propio' });
      }
      if (!prepared.length) continue;
      budget -= prepared.length;
      const analysisRequestedBy = await convertedBy(database, folder.opportunity_id);
      const result = await ingest({ opportunityId: folder.opportunity_id, opportunity, actorProfileId, files: prepared, proposeCompanyFacts: false, ...(analysisRequestedBy ? { analysisRequestedBy } : {}) });
      events.push({
        event: 'agt002_nuestras_observaciones_cargadas', opportunity_id: folder.opportunity_id, cartas: prepared.length,
        estados: (result?.upload_results || []).map(item => item.status), reanalisis: Boolean(result?.analysis_request?.requested),
      });
    } catch (cause) {
      events.push({ event: 'agt002_nuestras_observaciones_failed', opportunity_id: folder.opportunity_id, code: String(cause?.code || 'error').slice(0, 40) });
    }
  }
  return events.length ? events : [{ event: 'agt002_nuestras_observaciones_al_dia' }];
}
