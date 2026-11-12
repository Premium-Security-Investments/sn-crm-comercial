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
//
// ## El segundo paso: las sesiones de los puentes
//
// Corre aquí porque es el único trabajo diario que ya es root, y leer las sesiones de Claude de los
// puentes (archivos 600 de cada usuario de puente) exige root. Autorizado por Juan el 2026-11-03.
// Del archivo sólo se toma el vencimiento; ver `agt002-bridge-session-watch.js`. Es independiente: si
// uno de los dos pasos falla, el otro corre igual.
//
// ## La matriz histórica de requisitos: una sola vez, con `--cargar-matriz`
//
// Juan, 2026-11-12: el Excel de la matriz (SharePoint) ya no va a cambiar y desde ahora el CRM es la fuente del listado.
// Por eso no es un paso diario: `--cargar-matriz` corre SÓLO esa carga —sin sesiones ni avisos en los expedientes— y
// la copia completa a psi_tender_requirement_history aunque la fecha del archivo no haya cambiado (un primer intento
// dejó 400 de 798 filas). Lee con la misma sesión de Graph (bajar.py, junto al listador); no escribe en SharePoint.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { agt002PhaseChangeOpportunityBlocker } from '../../verticales/licitaciones/agt002-phase-change-followup.js';
import { runAgt002SharepointEvidenceWatch } from '../../verticales/licitaciones/agt002-sharepoint-evidence-diff.js';
import { runAgt002BridgeSessionWatch } from '../../verticales/licitaciones/agt002-bridge-session-watch.js';
import { runRequirementMatrixSync } from '../../verticales/licitaciones/requirement-history-import.js';

const BRIDGE_SESSIONS = ['AGT-001', 'AGT-002', 'AGT-003'].map(agent => ({
  agent,
  path: `/opt/${agent.toLowerCase().replace('-', '')}-bridge/.claude/.credentials.json`,
}));

const log = event => console.log(JSON.stringify(event));

const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const script = String(process.env.AGT002_SHAREPOINT_INVENTORY_SCRIPT || '').trim();
const drive = String(process.env.AGT002_SHAREPOINT_DRIVE_ID || '').trim();
const folder = String(process.env.AGT002_SHAREPOINT_LIBRARY_PATH || '').trim();
const onlyMatrix = process.argv.includes('--cargar-matriz');

async function loadMatrix(database) {
  const run = promisify(execFile);
  return runRequirementMatrixSync(database, {
    force: true,
    listFolder: async path => JSON.parse((await run('/usr/bin/python3', [script, drive, path], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 })).stdout)?.archivos || [],
    download: async path => {
      const dir = await mkdtemp(join(tmpdir(), 'matriz-'));
      try {
        await run('/usr/bin/python3', [join(dirname(script), 'bajar.py'), drive, path, join(dir, 'matriz.xlsx')], { timeout: 120_000 });
        return await readFile(join(dir, 'matriz.xlsx'));
      } finally { await rm(dir, { recursive: true, force: true }); }
    },
  });
}

if (!supabaseUrl || !serviceRoleKey || !script || !drive || !folder) {
  // Una sola línea segura en stdout, nunca los valores.
  log({ event: 'agt002_sharepoint_bridge_config_invalida' });
  process.exitCode = 1;
} else if (onlyMatrix) {
  try {
    const matrix = await loadMatrix(createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }));
    log(matrix);
    if (matrix.event !== 'requirement_matrix_loaded') process.exitCode = 1;
  } catch (error) {
    log({ event: 'requirement_matrix_failed', code: error?.code || 'excepcion' });
    process.exitCode = 1;
  }
} else {
  try {
    const database = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const appendLine = async (db, opportunityId, line) => {
      const { error } = await db.rpc('psi_append_opportunity_observation_line', { p_opportunity_id: opportunityId, p_line: line });
      if (error) throw new Error(error.message || 'no se pudo escribir el aviso');
    };
    const inactiveReason = (db, opportunityId, tenderId) => agt002PhaseChangeOpportunityBlocker(db, opportunityId, tenderId);
    let sessionFailures = 0;
    try {
      const sessionEvents = await runAgt002BridgeSessionWatch(database, { sessions: BRIDGE_SESSIONS, readFile, log, inactiveReason, appendLine });
      sessionFailures = sessionEvents.filter(event => ['agt002_bridge_session_watch_failed', 'agt002_bridge_session_watch_unavailable'].includes(event.event)).length;
    } catch {
      log({ event: 'agt002_bridge_session_watch_failed' });
      sessionFailures = 1;
    }
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
      // El mismo filtro que las otras dos vigilancias, y se me había olvidado: la primera corrida
      // real escribió en 18 expedientes, 4 de ellos ARCHIVADOS. Un aviso en un expediente donde
      // nadie trabaja es ruido puro, y el ruido es lo que hace que nadie lea los avisos.
      inactiveReason,
      appendLine,
    });
    const avisos = events.filter(event => event.event === 'agt002_sharepoint_watch_notice').length;
    const fallos = events.filter(event => event.event === 'agt002_sharepoint_watch_failed').length;
    log({ event: 'agt002_sharepoint_bridge_fin', archivos: files.length, avisos, fallos });
    // Sin listado no se concluye nada, y eso ES un fallo del trabajo: que se vea en rojo, en vez de
    // parecer un día tranquilo. Un aviso que no se pudo escribir también.
    if (files.length === 0 || fallos > 0 || sessionFailures > 0) process.exitCode = 1;
  } catch {
    log({ event: 'agt002_sharepoint_bridge_failed' });
    process.exitCode = 1;
  }
}
