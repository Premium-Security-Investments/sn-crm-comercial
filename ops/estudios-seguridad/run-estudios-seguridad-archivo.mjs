#!/usr/bin/env node
// Estudios de Seguridad — archiva en SharePoint las versiones aprobadas (tramo 4, migración 186). Decisión de Juan del
// 2026-11-05: al aprobar, el informe se genera solo y queda en cola; la aprobación es el pedido de una persona que su
// regla del 2026-11-04 exige para subir a su nombre.
//
// Corre cada minuto, pero sin pedidos no hace nada: ni arma documentos ni toca Microsoft. Corre como root por la misma
// razón que agt002-sharepoint-drafts: la sesión delegada de Graph vive en /root/.vigia-graph (700) y no se copia a un
// usuario de servicio. La lógica está en verticales/estudios-seguridad/archivo.js; aquí sólo se conectan las piezas.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { renderAgt002Docx } from '../../verticales/licitaciones/agt002-document-render.js';
import { runArchiveBatch } from '../../verticales/estudios-seguridad/archivo.js';

const run = promisify(execFile);
const log = event => console.log(JSON.stringify(event));
const env = name => String(process.env[name] || '').trim();
const supabaseUrl = env('SUPABASE_URL') || env('NEXT_PUBLIC_SUPABASE_URL');
const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
const uploader = env('ESTUDIOS_SHAREPOINT_UPLOAD_SCRIPT');
const drive = env('ESTUDIOS_SHAREPOINT_DRIVE_ID');
const soffice = env('ESTUDIOS_SOFFICE') || '/usr/bin/soffice';

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'estudios-archivo-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

// Word → PDF con LibreOffice, perfil propio por conversión. Argumentos fijos; lo único variable es el contenido.
const toPdf = docx => withTempDir(async dir => {
  const source = path.join(dir, 'informe.docx');
  await writeFile(source, docx);
  await run(soffice, [`-env:UserInstallation=file://${path.join(dir, 'perfil')}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, source], { timeout: 120_000, maxBuffer: 1024 * 1024 });
  const pdf = await readFile(path.join(dir, 'informe.pdf'));
  if (pdf.length < 1000 || pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('pdf');
  return pdf;
});

// subir.py nunca sobrescribe y relee después de escribir. Se devuelve su salida para leerla en archivo.js.
const upload = (relativePath, bytes) => withTempDir(async dir => {
  const local = path.join(dir, 'archivo');
  await writeFile(local, bytes);
  try {
    const { stdout } = await run('/usr/bin/python3', [uploader, drive, relativePath, local], { timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  } catch (uploadError) {
    return String(uploadError?.stdout || '');
  }
});

if (!supabaseUrl || !serviceRoleKey || !uploader || !drive) {
  log({ event: 'estudios_archivo_config_invalida' });
  process.exitCode = 1;
} else {
  const database = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const result = await runArchiveBatch(database, { renderDocx: document => renderAgt002Docx(document, { soffice }), toPdf, upload }, log);
    if (result.processed) log({ event: 'estudios_archivo_corrida', pedidos: result.processed, archivados: result.ok });
  } catch {
    log({ event: 'estudios_archivo_corrida_fallida' });
    process.exitCode = 1;
  }
}
