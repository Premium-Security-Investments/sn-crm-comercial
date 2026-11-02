#!/usr/bin/env node
// AGT-002 — puente SharePoint -> CRM, una vez al día (mejora 1 del encargo del 2026-10-31).
//
// Lee la biblioteca corporativa de SharePoint, la compara contra lo que el CRM tiene cargado, y deja
// UNA línea por expediente abierto con las diferencias. No marca evidencia como verificada y no
// escribe nada en SharePoint.
//
// ## Por qué es su propia unidad y no un paso de la revisión de fases
//
// Lo intenté primero como un paso de `agt002-phase-change-review`, y estaba mal: esa unidad corre
// como `psi-agt002` con `ProtectHome=true`, así que no puede —ni debe— leer la sesión delegada de
// Graph, que es de root con permisos 700. El trabajo falló limpio (`inventory_failed` →
// `sin_listado`, sin escribir nada, que es la guarda funcionando) y de ahí salió este diseño: el
// puente necesita root, así que tiene su propia unidad endurecida y el motivo escrito en ella.
//
// ## Lo que nunca sale de aquí
//
// El listado trae rutas y nombres de archivo, y 76 de los 122 son de las dos bóvedas de datos
// personales. Las reglas cuentan esas clases y nunca las nombran, y este ejecutor **no registra el
// stdout ni el stderr** del listador: sólo cuántos archivos leyó, o un código de error.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { runAgt002SharepointEvidenceWatch } from '../../verticales/licitaciones/agt002-sharepoint-evidence-diff.js';

const log = event => console.log(JSON.stringify(event));

const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const script = String(process.env.AGT002_SHAREPOINT_INVENTORY_SCRIPT || '').trim();
const drive = String(process.env.AGT002_SHAREPOINT_DRIVE_ID || '').trim();
const folder = String(process.env.AGT002_SHAREPOINT_LIBRARY_PATH || '').trim();

if (!supabaseUrl || !serviceRoleKey || !script || !drive || !folder) {
  // Una sola línea segura en stdout, nunca los valores.
  log({ event: 'agt002_sharepoint_bridge_config_invalida' });
  process.exitCode = 1;
} else {
  try {
    const database = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    let files = [];
    try {
      const { stdout } = await promisify(execFile)('/usr/bin/python3', [script, drive, folder], {
        timeout: Number(process.env.AGT002_SHAREPOINT_INVENTORY_TIMEOUT_MS || 180_000),
        maxBuffer: 16 * 1024 * 1024,
      });
      const payload = JSON.parse(stdout);
      files = Array.isArray(payload?.archivos) ? payload.archivos : [];
      log({ event: 'agt002_sharepoint_inventory_leido', archivos: files.length });
    } catch (error) {
      log({ event: 'agt002_sharepoint_inventory_failed', code: error?.code || 'desconocido' });
    }
    const events = await runAgt002SharepointEvidenceWatch(database, {
      files,
      log,
      appendLine: async (db, opportunityId, line) => {
        const { error } = await db.rpc('psi_append_opportunity_observation_line', { p_opportunity_id: opportunityId, p_line: line });
        if (error) throw new Error(error.message || 'no se pudo escribir el aviso');
      },
    });
    const avisos = events.filter(event => event.event === 'agt002_sharepoint_watch_notice').length;
    const fallos = events.filter(event => event.event === 'agt002_sharepoint_watch_failed').length;
    log({ event: 'agt002_sharepoint_bridge_fin', archivos: files.length, avisos, fallos });
    // Sin listado no se concluye nada, y eso ES un fallo del trabajo: que se vea en rojo, en vez de
    // parecer un día tranquilo. Un aviso que no se pudo escribir también.
    if (files.length === 0 || fallos > 0) process.exitCode = 1;
  } catch {
    log({ event: 'agt002_sharepoint_bridge_failed' });
    process.exitCode = 1;
  }
}
