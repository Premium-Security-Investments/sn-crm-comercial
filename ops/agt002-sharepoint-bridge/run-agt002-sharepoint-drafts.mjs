#!/usr/bin/env node
// AGT-002 — sube a SharePoint la copia de trabajo de los borradores que una persona pidió con el botón (mejora 5,
// migración 177). **Autorizado por Juan el 2026-11-04**: el botón, no un horario, decide qué sube.
//
// Corre cada minuto, pero sin pedidos no hace nada: ni lista SharePoint ni toca Microsoft. Corre como root por lo mismo
// que el puente SharePoint: la sesión delegada de Graph vive en /root/.vigia-graph con permisos 700, y no se copia a un
// usuario de servicio (ver el handoff del 2026-11-03, §6).
//
// Las guardas del puente CRM → SharePoint, que aquí no se negocian:
//   1. nunca sobrescribe: `subir.py` sin `--reemplazar`; si el nombre existe, el pedido falla y lo dice;
//   2. relee después de escribir (lo hace `subir.py`; con .docx el readback difiere siempre y se registra así);
//   3. nunca toca una carpeta curada: todo va a `99_Del_CRM/Borradores_Vig-IA/`.
// Nunca registra rutas ni nombres de archivo: sólo identificadores y códigos.
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { agt002MapTendersToProcessFolders, agt002StorageObjectPaths } from '../../verticales/licitaciones/agt002-crm-to-sharepoint.js';
import {
  AGT002_DRAFT_SHAREPOINT_ERRORS, agt002DraftSharepointPath, agt002ParseUploadOutput,
} from '../../verticales/licitaciones/agt002-draft-sharepoint-copy.js';
import { runFilingFolderPass } from '../../verticales/licitaciones/tender-filing-folder-run.js';

const run = promisify(execFile);
const log = event => console.log(JSON.stringify(event));
const env = name => String(process.env[name] || '').trim();
const supabaseUrl = env('SUPABASE_URL') || env('NEXT_PUBLIC_SUPABASE_URL');
const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
const inventory = env('AGT002_SHAREPOINT_INVENTORY_SCRIPT');
const uploader = env('AGT002_SHAREPOINT_UPLOAD_SCRIPT');
const drive = env('AGT002_SHAREPOINT_DRIVE_ID');
const processesPath = env('AGT002_SHAREPOINT_PROCESSES_PATH');
const bucket = env('AGT002_TENDER_DOCUMENTS_BUCKET') || 'tender-documents';

if (!supabaseUrl || !serviceRoleKey || !inventory || !uploader || !drive || !processesPath) {
  log({ event: 'agt002_sharepoint_drafts_config_invalida' });
  process.exitCode = 1;
} else {
  const database = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const finish = async (copy, ok, { url = null, path = null, error = null } = {}) => {
    const { error: finishError } = await database.rpc('psi_finish_tender_draft_sharepoint_copy', {
      p_id: copy.id, p_ok: ok, p_url: url, p_path: path, p_error: error,
    });
    if (finishError) { log({ event: 'agt002_sharepoint_drafts_finish_failed', copy_id: copy.id }); process.exitCode = 1; }
  };
  try {
    const { data: claimed, error } = await database.rpc('psi_claim_tender_draft_sharepoint_copies', { p_limit: 5 });
    if (error) throw new Error('claim');
    const copies = Array.isArray(claimed) ? claimed : [];
    if (!copies.length) {
      log({ event: 'agt002_sharepoint_drafts_sin_pedidos' });
    } else {
      // Las carpetas de los procesos, una sola vez por corrida.
      let folders = [];
      try {
        const { stdout } = await run('/usr/bin/python3', [inventory, drive, processesPath], { timeout: 300_000, maxBuffer: 32 * 1024 * 1024 });
        const files = JSON.parse(stdout)?.archivos || [];
        folders = [...new Set(files.map(file => String(file?.ruta || '').replace(`${processesPath}/`, '').split('/')[0]).filter(Boolean))];
      } catch { folders = []; }
      const { data: tenders } = await database.from('psi_public_tenders')
        .select('id,ref,entity,converted_opportunity_id,internal_status').eq('internal_status', 'convertida_oportunidad').limit(200);
      const mapping = agt002MapTendersToProcessFolders(folders, tenders || []);
      const work = mkdtempSync(join(tmpdir(), 'agt002-borradores-'));
      try {
        for (const copy of copies) {
          try {
            if (!folders.length) { await finish(copy, false, { error: AGT002_DRAFT_SHAREPOINT_ERRORS.sin_listado }); log({ event: 'agt002_sharepoint_drafts_failed', copy_id: copy.id, motivo: 'sin_listado' }); continue; }
            const tender = (tenders || []).find(row => row.converted_opportunity_id === copy.opportunity_id) || null;
            const { folder, reason } = (tender && mapping.get(tender.id)) || { folder: null, reason: 'sin_carpeta' };
            if (!folder) { await finish(copy, false, { error: AGT002_DRAFT_SHAREPOINT_ERRORS[reason] || AGT002_DRAFT_SHAREPOINT_ERRORS.sin_carpeta }); log({ event: 'agt002_sharepoint_drafts_failed', copy_id: copy.id, motivo: reason }); continue; }
            let data = null;
            for (const candidate of agt002StorageObjectPaths(copy.storage_path, bucket)) {
              const attempt = await database.storage.from(bucket).download(candidate);
              if (!attempt.error && attempt.data) { data = attempt.data; break; }
            }
            if (!data) { await finish(copy, false, { error: AGT002_DRAFT_SHAREPOINT_ERRORS.descarga }); log({ event: 'agt002_sharepoint_drafts_failed', copy_id: copy.id, motivo: 'descarga' }); continue; }
            const local = join(work, `${copy.id}.docx`);
            writeFileSync(local, Buffer.from(await data.arrayBuffer()));
            const destination = agt002DraftSharepointPath({ processesPath, folder, fileName: copy.file_name, version: copy.version });
            let out = '';
            try {
              ({ stdout: out } = await run('/usr/bin/python3', [uploader, drive, destination, local], { timeout: 300_000, maxBuffer: 4 * 1024 * 1024 }));
            } catch (uploadError) {
              out = String(uploadError?.stdout || '');
            }
            const parsed = agt002ParseUploadOutput(out);
            if (!parsed.ok) { await finish(copy, false, { error: AGT002_DRAFT_SHAREPOINT_ERRORS[parsed.reason] }); log({ event: 'agt002_sharepoint_drafts_failed', copy_id: copy.id, motivo: parsed.reason }); continue; }
            await finish(copy, true, { url: parsed.url, path: destination });
            log({ event: 'agt002_sharepoint_drafts_subido', copy_id: copy.id, readback: parsed.readback, con_enlace: Boolean(parsed.url) });
          } catch {
            await finish(copy, false, { error: 'error técnico al subir' }).catch(() => {});
            log({ event: 'agt002_sharepoint_drafts_failed', copy_id: copy.id, motivo: 'excepcion' });
          }
        }
      } finally { rmSync(work, { recursive: true, force: true }); }
    }
  } catch {
    log({ event: 'agt002_sharepoint_drafts_failed', motivo: 'corrida' });
    process.exitCode = 1;
  }
  // Mejora 11 (2026-11-11): la carpeta de radicación, en este mismo trabajo. Sin nada pendiente no toca SharePoint.
  try {
    const listing = async (path, depth) => {
      const { stdout } = await run('/usr/bin/python3', [inventory, drive, path, String(depth)], { timeout: 300_000, maxBuffer: 32 * 1024 * 1024 });
      return JSON.parse(stdout)?.archivos || [];
    };
    const work = mkdtempSync(join(tmpdir(), 'agt002-radicacion-'));
    try {
      let counter = 0;
      const events = await runFilingFolderPass(database, {
        processesPath,
        listFolders: async () => [...new Set((await listing(processesPath, 2)).map(file => String(file?.ruta || '').replace(`${processesPath}/`, '').split('/')[0]).filter(Boolean))],
        inventory: path => listing(path, 4),
        upload: async (destination, content) => {
          const local = join(work, `leeme-${counter += 1}.md`);
          writeFileSync(local, content);
          let out = '';
          try { ({ stdout: out } = await run('/usr/bin/python3', [uploader, drive, destination, local], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 })); }
          catch (uploadError) { out = String(uploadError?.stdout || ''); }
          return agt002ParseUploadOutput(out);
        },
      });
      for (const event of events) log(event);
    } finally { rmSync(work, { recursive: true, force: true }); }
  } catch {
    log({ event: 'tender_filing_failed', motivo: 'corrida' });
  }
}
