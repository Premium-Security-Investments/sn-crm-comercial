// Mejora 11 (migración 203): el paso de la carpeta de radicación dentro del trabajo que ya sube los borradores a
// SharePoint cada 5 minutos (ops/agt002-sharepoint-bridge/run-agt002-sharepoint-drafts.mjs). No es un trabajo nuevo (Juan
// pidió no multiplicar tareas repetitivas). Sin nada que hacer no lista SharePoint ni toca Microsoft.
//
//   1. Los procesos que entran al CRM entran solos a la cola con la etapa «observaciones» (migración 225); los GO
//      registrados desde que existe la mejora, con la etapa «completa» (una fila que estaba en observaciones sube a
//      completa); los procesos viejos, con el botón.
//   2. Crear: un 00_LEEME.md en cada una de las carpetas (así se crean, con el mismo `subir.py`): nunca sobrescribe; si
//      el LEEME ya existe, la carpeta ya estaba y se sigue.
//   3. Fotografía: cuando alguien pide actualizar el índice (o recién creada), se lista la carpeta del proceso y se
//      guarda el índice de 03_PARA_RADICAR y la comparación con 04_Radicado.
// Nunca registra rutas ni nombres de archivo en el log: sólo identificadores y códigos.
import { agt002MapTendersToProcessFolders } from './agt002-crm-to-sharepoint.js';
import { FILING_GO_CUTOFF, FILING_LEEME_NAME, filingLeeme, filingProcessFolderName, filingSnapshot, filingStructureFor } from './tender-filing-folder.js';

const SHAREPOINT_WEB = 'https://seguridadnacional.sharepoint.com/sites/innovacion/Documentos%20compartidos';
const absent = error => ['PGRST205', '42P01'].includes(String(error?.code || ''));

/** El enlace web a una carpeta de la biblioteca (para abrirla desde el CRM). Pura. */
export function filingWebUrl(path) {
  return `${SHAREPOINT_WEB}/${String(path || '').split('/').map(part => encodeURIComponent(part)).join('/')}`;
}

/**
 * Un pase. `listFolders()` → nombres de las carpetas de procesos; `upload(destination, content)` → { ok, reason };
 * `inventory(path)` → [{ ruta, nombre, bytes, modificado_en }] con rutas completas. Devuelve eventos; nunca lanza por un proceso.
 */
export async function runFilingFolderPass(database, { processesPath, listFolders, upload, inventory, now = () => new Date(), limit = 2 }) {
  const events = [];
  // 1. Cola. `select('*')`: sin la migración 225 no hay columna `etapa` y todo es la carpeta completa, como antes.
  const { data: rows, error } = await database.from('psi_tender_filing_folders').select('*');
  if (error) return [{ event: absent(error) ? 'tender_filing_unavailable' : 'tender_filing_failed', code: absent(error) ? null : String(error.code || 'lectura') }];
  const etapaOf = row => row?.etapa || 'completa';
  const byOpportunity = new Map((rows || []).map(row => [row.opportunity_id, row]));
  const etapaById = new Map((rows || []).map(row => [row.opportunity_id, etapaOf(row)]));
  // 1a. GO: sin fila, se crea la completa; con la de observaciones, sube a completa.
  const { data: gos } = await database.from('psi_tender_go_no_go_decisions').select('opportunity_id,created_at').eq('decision', 'go').gte('created_at', FILING_GO_CUTOFF);
  const fresh = [];
  for (const opportunityId of [...new Set((gos || []).map(row => row.opportunity_id))].filter(Boolean)) {
    const row = byOpportunity.get(opportunityId);
    if (!row) {
      const { error: insertError } = await database.from('psi_tender_filing_folders').insert({ opportunity_id: opportunityId, origin: 'go' });
      if (!insertError) { fresh.push(opportunityId); etapaById.set(opportunityId, 'completa'); events.push({ event: 'tender_filing_queued', opportunity_id: opportunityId }); }
    } else if (etapaOf(row) === 'observaciones' && row.status !== 'pendiente') {
      const { error: upgradeError } = await database.from('psi_tender_filing_folders').update({ etapa: 'completa', status: 'pendiente', error: null, updated_at: now().toISOString() }).eq('opportunity_id', opportunityId);
      if (!upgradeError) { fresh.push(opportunityId); etapaById.set(opportunityId, 'completa'); events.push({ event: 'tender_filing_queued', opportunity_id: opportunityId, etapa: 'completa' }); }
    }
  }
  // 1b. Ingreso: cada licitación abierta del CRM sin fila, con la etapa de observaciones. Sin la columna, no se hace.
  const { data: converted } = await database.from('psi_public_tenders').select('converted_opportunity_id').eq('internal_status', 'convertida_oportunidad').not('converted_opportunity_id', 'is', null);
  const candidates = [...new Set((converted || []).map(row => row.converted_opportunity_id))].filter(id => id && !byOpportunity.has(id) && !etapaById.has(id));
  if (candidates.length) {
    const { data: opportunities } = await database.from('psi_sales_opportunities').select('id,tender_offer_status,stage_code,archive_note,archived_at,discarded_at,lost_at,deleted_at').in('id', candidates);
    const open = (opportunities || []).filter(row => !row.archive_note && !row.archived_at && !row.discarded_at && !row.lost_at && !row.deleted_at
      && row.stage_code !== 'descartado' && !['cerrada_no_go', 'no_presentada', 'adjudicada', 'no_adjudicada'].includes(row.tender_offer_status));
    for (const { id } of open) {
      const { error: insertError } = await database.from('psi_tender_filing_folders').insert({ opportunity_id: id, origin: 'ingreso', etapa: 'observaciones' });
      if (insertError) break;
      fresh.push(id); etapaById.set(id, 'observaciones');
      events.push({ event: 'tender_filing_queued', opportunity_id: id, etapa: 'observaciones' });
    }
  }
  const pending = [...new Set([...(rows || []).filter(row => row.status === 'pendiente').map(row => row.opportunity_id), ...fresh])].slice(0, limit);
  // El índice es de la oferta: sólo en la carpeta completa.
  const toRefresh = (rows || []).filter(row => etapaOf(row) === 'completa' && row.status === 'creada' && row.refresh_requested_at && (!row.snapshot_at || new Date(row.refresh_requested_at) > new Date(row.snapshot_at))).slice(0, limit);
  if (!pending.length && !toRefresh.length) return [...events, { event: 'tender_filing_idle' }];

  // 2. Crear.
  if (pending.length) {
    const folders = await listFolders();
    const { data: tenders } = await database.from('psi_public_tenders').select('id,ref,entity,converted_opportunity_id').in('converted_opportunity_id', pending);
    const mapping = agt002MapTendersToProcessFolders(folders, tenders || []);
    for (const opportunityId of pending) {
      const finish = values => database.from('psi_tender_filing_folders').update({ ...values, updated_at: now().toISOString() }).eq('opportunity_id', opportunityId);
      try {
        const tender = (tenders || []).find(row => row.converted_opportunity_id === opportunityId);
        if (!tender) { await finish({ status: 'error', error: 'el proceso no está en el radar de licitaciones' }); events.push({ event: 'tender_filing_failed', opportunity_id: opportunityId, code: 'sin_proceso' }); continue; }
        const found = mapping.get(tender.id) || { folder: null, reason: 'sin_carpeta' };
        if (found.reason === 'carpeta_ambigua') { await finish({ status: 'error', error: 'hay más de una carpeta en SharePoint que podría ser de este proceso' }); events.push({ event: 'tender_filing_failed', opportunity_id: opportunityId, code: 'carpeta_ambigua' }); continue; }
        const folder = found.folder || filingProcessFolderName(tender);
        if (!folder) { await finish({ status: 'error', error: 'el proceso no tiene entidad ni referencia para nombrar la carpeta' }); continue; }
        const processLabel = [tender.entity, tender.ref].filter(Boolean).join(' · ');
        let failed = null;
        const etapa = etapaById.get(opportunityId) || 'completa';
        for (const entry of filingStructureFor(etapa)) {
          const result = await upload(`${processesPath}/${folder}/${entry.folder}/${FILING_LEEME_NAME}`, filingLeeme(entry, { processLabel }));
          if (!result.ok && result.reason !== 'ya_existe') { failed = result.reason || 'no_subio'; break; }
        }
        if (failed) { await finish({ status: 'error', error: 'SharePoint no aceptó crear las carpetas; se reintenta con el botón' }); events.push({ event: 'tender_filing_failed', opportunity_id: opportunityId, code: failed }); continue; }
        const path = `${processesPath}/${folder}`;
        await finish({ status: 'creada', error: null, folder_path: path, web_url: filingWebUrl(path), ...(etapa === 'completa' ? { refresh_requested_at: now().toISOString() } : {}) });
        events.push({ event: 'tender_filing_created', opportunity_id: opportunityId, carpeta_nueva: !found.folder, etapa });
      } catch {
        await finish({ status: 'error', error: 'error técnico al crear las carpetas' }).catch(() => {});
        events.push({ event: 'tender_filing_failed', opportunity_id: opportunityId, code: 'excepcion' });
      }
    }
  }

  // 3. Fotografía del índice y la comparación.
  for (const row of toRefresh) {
    try {
      const files = await inventory(row.folder_path);
      const prefix = `${row.folder_path}/`;
      const relative = files.map(file => ({ ...file, ruta: String(file.ruta || '').startsWith(prefix) ? String(file.ruta).slice(prefix.length) : file.ruta }));
      const snapshot = filingSnapshot(relative, { observedAt: now().toISOString() });
      await database.from('psi_tender_filing_folders').update({ snapshot, snapshot_at: now().toISOString(), updated_at: now().toISOString() }).eq('opportunity_id', row.opportunity_id);
      events.push({ event: 'tender_filing_indexed', opportunity_id: row.opportunity_id, archivos: snapshot.indice.total });
    } catch {
      events.push({ event: 'tender_filing_failed', opportunity_id: row.opportunity_id, code: 'inventario' });
    }
  }
  return events;
}
