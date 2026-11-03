#!/usr/bin/env node
// AGT-002 — sube a SharePoint los documentos del proceso que están en el CRM y no allá.
// Mejora 1 del encargo, sentido CRM -> SharePoint. **Autorizado por Juan el 2026-11-02**, con tres
// guardas que él puso y que no se negocian:
//
//   1. **Nunca sobreescribe.** `subir.py` se niega si el destino existe, y aquí NO se le pasa
//      `--reemplazar`. Jamás.
//   2. **Relee y compara después de cada escritura.** Lo hace `subir.py` por sha256. Para `.docx` la
//      comparación no va a coincidir nunca —SharePoint los reescribe al subirlos, trampa ya pagada—
//      así que eso se reporta como `readback_distinto`, no como éxito ni como fallo silencioso.
//   3. **Nunca toca un documento canónico de otro dueño.** Todo va a `99_Del_CRM`, nunca a las
//      carpetas numeradas del expediente, que son trabajo curado de una persona.
//
// `--dry-run` calcula el plan y no escribe nada.
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import {
  AGT002_CRM_TO_SHAREPOINT_FOLDER,
  agt002CrmToSharepointLine,
  agt002CrmToSharepointPlan,
  agt002MapTendersToProcessFolders,
  agt002StorageObjectPaths,
} from '../../verticales/licitaciones/agt002-crm-to-sharepoint.js';

const run = promisify(execFile);
const log = event => console.log(JSON.stringify(event));
// En seco por bandera o por variable: la bandera sirve a mano, y la variable sirve en la unidad, que
// es donde se decide si una corrida programada escribe o sólo calcula.
const dryRun = process.argv.includes('--dry-run')
  || String(process.env.AGT002_CRM_TO_SHAREPOINT_DRY_RUN || '').trim() === 'true';

const env = name => String(process.env[name] || '').trim();
const supabaseUrl = env('SUPABASE_URL') || env('NEXT_PUBLIC_SUPABASE_URL');
const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
const inventory = env('AGT002_SHAREPOINT_INVENTORY_SCRIPT');
const uploader = env('AGT002_SHAREPOINT_UPLOAD_SCRIPT');
const drive = env('AGT002_SHAREPOINT_DRIVE_ID');
const processesPath = env('AGT002_SHAREPOINT_PROCESSES_PATH');
const bucket = env('AGT002_TENDER_DOCUMENTS_BUCKET') || 'tender-documents';
const maxPerTender = Number(env('AGT002_CRM_TO_SHAREPOINT_MAX') || 25);

if (!supabaseUrl || !serviceRoleKey || !inventory || !drive || !processesPath || (!dryRun && !uploader)) {
  log({ event: 'agt002_crm_to_sharepoint_config_invalida', dry_run: dryRun });
  process.exitCode = 1;
} else {
  const database = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let exitCode = 0;
  try {
    // Listado de los procesos activos en SharePoint, una sola vez.
    const { stdout } = await run('/usr/bin/python3', [inventory, drive, processesPath], { timeout: 300_000, maxBuffer: 32 * 1024 * 1024 });
    const all = JSON.parse(stdout);
    const files = Array.isArray(all?.archivos) ? all.archivos : [];
    if (!files.length) {
      // Un SharePoint ilegible no es un SharePoint vacío: con el listado vacío NO se sube nada,
      // porque todo parecería faltar.
      log({ event: 'agt002_crm_to_sharepoint_sin_listado' });
      process.exitCode = 1;
    } else {
      log({ event: 'agt002_crm_to_sharepoint_listado', archivos: files.length });
      const folders = [...new Set(files
        .map(file => String(file?.ruta || '').replace(`${processesPath}/`, '').split('/')[0])
        .filter(Boolean))];

      const { data: tenders, error } = await database
        .from('psi_public_tenders')
        // `entity` es imprescindible: sin él el emparejamiento por nombre de entidad recibe vacío y
        // toda licitación cuya carpeta no traiga la referencia sale `sin_carpeta`. La prueba del
        // módulo pasaba porque recibe las entidades a mano; sólo la corrida real lo mostró.
        .select('id,ref,entity,converted_opportunity_id,internal_status')
        .eq('internal_status', 'convertida_oportunidad')
        .limit(50);
      if (error) throw new Error(`licitaciones: ${error.message}`);

      // El emparejamiento se calcula para TODAS las licitaciones a la vez, porque la ambigüedad sólo
      // se ve mirando el conjunto: dos procesos de la misma entidad no pueden caer en la misma carpeta.
      const mapping = agt002MapTendersToProcessFolders(folders, tenders || []);
      for (const tender of tenders || []) {
        const ref = String(tender?.ref || '');
        const opportunityId = tender?.converted_opportunity_id;
        if (!ref || !opportunityId) continue;
        const { folder, reason } = mapping.get(tender.id) || { folder: null, reason: 'sin_carpeta' };
        if (!folder) { log({ event: `agt002_crm_to_sharepoint_${reason}`, ref }); continue; }

        const { data: documents, error: documentsError } = await database
          .from('psi_tender_document_versions')
          .select('name,storage_path,mime_type,size_bytes,source,current')
          .eq('opportunity_id', opportunityId)
          .eq('current', true);
        if (documentsError) { log({ event: 'agt002_crm_to_sharepoint_failed', ref, message: 'lectura de documentos' }); exitCode = 1; continue; }

        const inFolder = files.filter(file => String(file?.ruta || '').startsWith(`${processesPath}/${folder}/`));
        const plan = agt002CrmToSharepointPlan({ crmDocuments: documents || [], sharepointFiles: inFolder });
        const skipped = new Set((documents || []).map(d => String(d.name || '').toLowerCase().replace(/\s+/g, ' ').trim())).size - plan.length;
        log({ event: 'agt002_crm_to_sharepoint_plan', ref, folder, empareja_por: reason, en_crm: (documents || []).length, ya_estaban: skipped, a_subir: plan.length, dry_run: dryRun });
        if (dryRun) { for (const item of plan) log({ event: 'agt002_crm_to_sharepoint_subiria', ref, name: item.name, kb: Math.round((item.sizeBytes || 0) / 1024) }); continue; }

        let uploaded = 0, failed = 0;
        const slice = plan.slice(0, maxPerTender);
        const work = mkdtempSync(join(tmpdir(), 'agt002-puente-'));
        try {
          for (const item of slice) {
            try {
              // Se prueban las dos rutas candidatas en orden; la corrida dice cuál sirvió.
              let data = null, used = null;
              for (const candidate of agt002StorageObjectPaths(item.storagePath, bucket)) {
                const attempt = await database.storage.from(bucket).download(candidate);
                if (!attempt.error && attempt.data) { data = attempt.data; used = candidate === item.storagePath ? 'completa' : 'recortada'; break; }
              }
              if (!data) throw new Error('descarga');
              const buffer = Buffer.from(await data.arrayBuffer());
              if (used) log({ event: 'agt002_crm_to_sharepoint_ruta', ruta: used });
              if (!buffer.length) throw new Error('vacío');
              const local = join(work, item.name.replace(/[/\\]/g, '_'));
              writeFileSync(local, buffer);
              const destino = `${processesPath}/${folder}/${AGT002_CRM_TO_SHAREPOINT_FOLDER}/${item.name}`;
              // Sin `--reemplazar`: si existe, se niega, y eso es lo correcto.
              //
              // `subir.py` **sale con código 1 cuando el readback difiere, DESPUÉS de haber subido el
              // archivo**. Para los `.docx` eso pasa siempre: SharePoint los reescribe al subirlos y
              // el sha256 nunca coincide. La primera corrida real lo contó como fallo y reportó
              // perdido un «Anexo 2.docx» que sí estaba en SharePoint. Así que la salida se lee
              // SIEMPRE, con éxito o con error, y «escrito:» en ella es la prueba de que subió.
              let out = '';
              try {
                ({ stdout: out } = await run('/usr/bin/python3', [uploader, drive, destino, local], { timeout: 300_000, maxBuffer: 4 * 1024 * 1024 }));
              } catch (uploadError) {
                out = String(uploadError?.stdout || '');
                if (!/escrito:/.test(out)) throw new Error('subida');
              }
              if (/YA EXISTE/.test(out)) { log({ event: 'agt002_crm_to_sharepoint_ya_existe', ref, name: item.name }); continue; }
              const readback = /readback: IGUAL/.test(out) ? 'igual' : 'distinto';
              uploaded += 1;
              // `distinto` no es fallo ni es éxito callado: el archivo está, y el readback no cuadra
              // por una razón conocida. Se nombra para que se pueda mirar.
              log({ event: 'agt002_crm_to_sharepoint_subido', ref, name: item.name, readback });
            } catch (cause) {
              failed += 1;
              // Nunca el mensaje crudo: puede traer rutas.
              log({ event: 'agt002_crm_to_sharepoint_failed', ref, name: item.name, motivo: String(cause?.message || 'desconocido').slice(0, 40) });
            }
          }
        } finally { rmSync(work, { recursive: true, force: true }); }

        const line = agt002CrmToSharepointLine({ ref, folder, uploaded, skipped, failed, pending: plan.length - slice.length });
        if (line) {
          const { error: lineError } = await database.rpc('psi_append_opportunity_observation_line', { p_opportunity_id: opportunityId, p_line: line });
          if (lineError) { log({ event: 'agt002_crm_to_sharepoint_failed', ref, message: 'aviso' }); exitCode = 1; }
        }
        if (failed) exitCode = 1;
      }
      log({ event: 'agt002_crm_to_sharepoint_fin', dry_run: dryRun });
      process.exitCode = exitCode;
    }
  } catch (cause) {
    log({ event: 'agt002_crm_to_sharepoint_failed', motivo: String(cause?.message || 'desconocido').slice(0, 60) });
    process.exitCode = 1;
  }
}
