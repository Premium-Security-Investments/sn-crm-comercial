#!/usr/bin/env node
// AGT-003 — generador del correo semanal (capacidad agt003.weekly_digest, contrato agt003-weekly-digest-v1).
//
// El CRM construye los correos y los deja en un outbox; Hermes los envía tal cual (HERMES-DELIVERY-CONTRACT.md).
// Este runner NUNCA envía correo, no llama modelos y sólo LEE la base de datos (service role, como el radar).
//
//   --mode=preview|live   preview: todo va a juanbotero@premiumsecurity.ai, sin copia, asunto "[PRUEBA] " y aviso.
//   --sample=N            sólo en preview: N correos de comercial + el resumen del gerente.
//   --out-dir=DIR         dónde escribir (por defecto $STATE_DIRECTORY o /var/lib/agt003-weekly-digest).
//   --dry                 imprime el resumen y escribe en un directorio temporal (o en --out-dir si se da).
//   --now=ISO             sólo para pruebas: fija la hora de generación.
//
// Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (EnvironmentFile), AGT003_DIGEST_MANAGER_EMAIL,
// AGT003_DIGEST_APP_URL, AGT003_DIGEST_PREVIEW_TO, AGT003_DIGEST_SENDER, AGT003_DIGEST_MANAGER_GREETING. ENV_FILE=/ruta carga un archivo KEY=VALUE
// (sin imprimirlo) para corridas manuales fuera de systemd.
//
// Salida: outbox-<run_id>.json siempre; el puntero por modo (live: outbox-latest.json/.txt; preview:
// outbox-preview-latest.json/.txt), todos escritos de forma atómica (archivo temporal + rename).
// Código de salida: 0 bien, 1 error de lectura/escritura, 2 uso incorrecto, 3 validación (sin destinatarios, correo
// inválido, gerente no encontrado...). Con salida distinta de 0 no se toca ningún puntero "latest".
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildWeeklyDigest, digestWeeks, selectDigestRecipients, WeeklyDigestValidationError, WEEKLY_DIGEST_CONTRACT } from '../../src/vigia/weekly-digest.js';
import { BEHAVIOR_FOLLOW_UP_TYPES } from '../../src/vigia/commercial-behavior.js';

const PAGE = 1000;
const OWNER_BATCH = 100;
const LATEST_FOLLOW_UP_LOOKBACK = 25;
const DEFAULT_STATE_DIR = '/var/lib/agt003-weekly-digest';
const log = event => console.log(JSON.stringify(event));

export function parseArgs(argv) {
  const args = { mode: null, sample: null, outDir: null, dry: false, now: null };
  for (const raw of argv) {
    const [key, value] = raw.includes('=') ? [raw.slice(0, raw.indexOf('=')), raw.slice(raw.indexOf('=') + 1)] : [raw, null];
    if (key === '--mode') args.mode = value;
    else if (key === '--sample') args.sample = Number(value);
    else if (key === '--out-dir') args.outDir = value;
    else if (key === '--dry') args.dry = true;
    else if (key === '--now') args.now = value;
    else throw new Error(`Argumento no reconocido: ${raw}`);
  }
  if (!['preview', 'live'].includes(args.mode)) throw new Error('Indique --mode=preview o --mode=live.');
  if (args.sample !== null && (!Number.isInteger(args.sample) || args.sample < 1)) throw new Error('--sample debe ser un entero >= 1.');
  if (args.now !== null && Number.isNaN(Date.parse(args.now))) throw new Error('--now debe ser una fecha ISO.');
  return args;
}

/** Carga KEY=VALUE de un archivo sin pisar variables ya definidas. Nunca imprime su contenido. */
export function loadEnvFile(path) {
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i <= 0) continue;
    const key = trimmed.slice(0, i).replace(/^export\s+/, '').trim();
    let value = trimmed.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function must(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
async function pages(build) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await must(build().range(offset, offset + PAGE - 1));
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}
const batches = ids => Array.from({ length: Math.ceil(ids.length / OWNER_BATCH) }, (_, i) => ids.slice(i * OWNER_BATCH, (i + 1) * OWNER_BATCH));
function isMissingRelation(error) {
  return error?.code === '42P01' || error?.code === 'PGRST205' || /does not exist|could not find the table/i.test(String(error?.message || ''));
}

// Sólo columnas de conteo, fecha e identificación del cliente. Nunca notes, observaciones ni loss_notes.
const OPPORTUNITY_SELECT = 'id,owner_id,company_name,quote_city,regional_nombre,service_type_code,stage_code,offer_value,next_action_at,last_interaction_at,approved_at,updated_at,frozen_until,delete_requested_at';
const INTERACTION_SELECT = 'opportunity_id,created_by,interaction_type,created_at';

/** Lee de Supabase (sólo lectura) lo que necesita buildWeeklyDigest. Mismo patrón que /api/vigia/commercial-behavior. */
export async function loadDigestInputs(database, now) {
  const profiles = await must(database.from('psi_sales_profiles').select('id,full_name,role,active,can_own_opportunities,identity_type,microsoft_email').eq('active', true).order('full_name'));
  const areaAssignments = await must(database.from('psi_profile_area_assignments').select('profile_id,area_code,subarea_code').eq('area_code', 'comercial'));
  const { included } = selectDigestRecipients({ profiles, areaAssignments });
  const ids = included.map(p => p.id).sort();
  if (!ids.length) return { profiles, areaAssignments, opportunities: [], interactions: [], decisions: [], lastSeen: [], goals: [] };
  const opportunities = [];
  for (const batch of batches(ids)) {
    opportunities.push(...await pages(() => database.from('v_psi_sales_opportunity_enriched').select(OPPORTUNITY_SELECT).in('owner_id', batch).order('id', { ascending: true })));
  }
  const opportunityIds = new Set(opportunities.map(o => o.id));
  const week = digestWeeks(now);
  const windowStart = new Date(Date.parse(`${week.last_week_start}T05:00:00Z`) - 31 * 86_400_000).toISOString();
  const decisionsStart = new Date(Date.parse(`${week.last_week_start}T05:00:00Z`) - 86_400_000).toISOString();
  const [windowInteractions, decisions] = await Promise.all([
    pages(() => database.from('psi_sales_interactions').select(INTERACTION_SELECT)
      .in('created_by', ids).in('interaction_type', BEHAVIOR_FOLLOW_UP_TYPES).gte('created_at', windowStart)
      .order('created_at', { ascending: false }).order('id', { ascending: true })),
    pages(() => database.from('psi_sales_opportunity_audit_logs').select('opportunity_id,changed_by,created_at,field_name')
      .eq('field_name', 'decision').in('changed_by', ids).gte('created_at', decisionsStart)
      .order('created_at', { ascending: false }).order('id', { ascending: true })),
  ]);
  // Último seguimiento de quien no tiene ninguno en la ventana (consulta acotada por comercial).
  const withRecent = new Set(windowInteractions.filter(row => opportunityIds.has(row.opportunity_id)).map(row => row.created_by));
  const older = await Promise.all(ids.filter(id => !withRecent.has(id)).map(async id => {
    const rows = await must(database.from('psi_sales_interactions').select(INTERACTION_SELECT)
      .eq('created_by', id).in('interaction_type', BEHAVIOR_FOLLOW_UP_TYPES).lt('created_at', windowStart)
      .order('created_at', { ascending: false }).limit(LATEST_FOLLOW_UP_LOOKBACK));
    const latest = rows.find(row => opportunityIds.has(row.opportunity_id));
    return latest ? [latest] : [];
  }));
  let lastSeen = [];
  try {
    lastSeen = await must(database.from('psi_profile_last_seen').select('profile_id,last_seen_at').in('profile_id', ids));
  } catch (error) {
    if (!isMissingRelation(error)) throw error; // Sin la migración 111 el ingreso queda desconocido (nunca "inactivo").
  }
  const goals = await must(database.from('psi_sales_goals').select('user_id,period_month,sales_budget,service_type_code').in('user_id', ids).order('period_month', { ascending: false }).limit(1000));
  return { profiles, areaAssignments, opportunities, interactions: [...windowInteractions, ...older.flat()], decisions, lastSeen, goals };
}

export function digestConfigFromEnv(env = process.env) {
  return {
    managerEmail: env.AGT003_DIGEST_MANAGER_EMAIL || undefined,
    appUrl: env.AGT003_DIGEST_APP_URL || undefined,
    previewTo: env.AGT003_DIGEST_PREVIEW_TO || undefined,
    sender: env.AGT003_DIGEST_SENDER || undefined,
    managerGreeting: env.AGT003_DIGEST_MANAGER_GREETING || undefined,
  };
}

export function outboxSummary(outbox) {
  const lines = [
    `AGT-003 correo semanal — ${outbox.contract}`,
    `Corrida: ${outbox.run_id}`,
    `Modo: ${outbox.mode}${outbox.sample ? ` (muestra de ${outbox.sample})` : ''}`,
    `Generado: ${outbox.generated_at} (día Bogotá ${outbox.generated_day_bogota})`,
    `Semana pasada: ${outbox.week.last_week_start} a ${outbox.week.last_week_end} · Esta semana: ${outbox.week.this_week_start} a ${outbox.week.this_week_end}`,
    `Remitente (Hermes): ${outbox.sender}`,
    `Mensajes: ${outbox.messages.length}`,
    '',
  ];
  for (const m of outbox.messages) {
    lines.push(`- [${m.kind}] ${m.subject}`);
    lines.push(`    para: ${m.to.join(', ')}${m.cc.length ? ` · copia: ${m.cc.join(', ')}` : ''}`);
    if (outbox.mode === 'preview') lines.push(`    real: ${m.real_to.join(', ')}${m.real_cc.length ? ` · copia: ${m.real_cc.join(', ')}` : ''}`);
    lines.push(`    id: ${m.id}`);
  }
  if (outbox.excluded_recipients.length) {
    lines.push('', 'Excluidos por regla:');
    for (const e of outbox.excluded_recipients) lines.push(`- ${e.name}: ${e.reason}`);
  }
  return `${lines.join('\n')}\n`;
}

function writeAtomic(dir, name, content) {
  const tmp = join(dir, `.${name}.${process.pid}.tmp`);
  writeFileSync(tmp, content, { mode: 0o644 });
  renameSync(tmp, join(dir, name));
}

/** Escribe outbox-<run_id>.json y, por modo, el puntero latest (.json y .txt). Devuelve las rutas. */
export function writeOutbox(dir, outbox) {
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'receipts'), { recursive: true, mode: 0o755 });
  const json = `${JSON.stringify(outbox, null, 2)}\n`;
  const prefix = outbox.mode === 'live' ? 'outbox-latest' : 'outbox-preview-latest';
  const runFile = `outbox-${outbox.run_id}.json`;
  writeAtomic(dir, runFile, json);
  writeAtomic(dir, `${prefix}.json`, json);
  writeAtomic(dir, `${prefix}.txt`, outboxSummary(outbox));
  return { run: join(dir, runFile), latest: join(dir, `${prefix}.json`), summary: join(dir, `${prefix}.txt`) };
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  try { args = parseArgs(argv); } catch (error) {
    log({ event: 'agt003_weekly_digest_usage', message: error.message, usage: 'run-agt003-weekly-digest.mjs --mode=preview|live [--sample=N] [--out-dir=DIR] [--dry]' });
    return 2;
  }
  try {
    if (process.env.ENV_FILE) loadEnvFile(process.env.ENV_FILE);
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
    const now = args.now ? new Date(args.now) : new Date();
    const { createClient } = await import('@supabase/supabase-js');
    const database = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const inputs = await loadDigestInputs(database, now);
    const outbox = buildWeeklyDigest({ ...inputs, now, config: digestConfigFromEnv(), mode: args.mode, sample: args.sample });
    const dir = args.outDir || (args.dry ? mkdtempSync(join(tmpdir(), 'agt003-weekly-digest-')) : (process.env.STATE_DIRECTORY || DEFAULT_STATE_DIR));
    const paths = writeOutbox(dir, outbox);
    if (args.dry) process.stdout.write(outboxSummary(outbox));
    log({ event: 'agt003_weekly_digest_written', contract: WEEKLY_DIGEST_CONTRACT, run_id: outbox.run_id, mode: outbox.mode, messages: outbox.messages.length, excluded: outbox.excluded_recipients.length, dry: args.dry, ...paths });
    return 0;
  } catch (error) {
    if (error instanceof WeeklyDigestValidationError) {
      log({ event: 'agt003_weekly_digest_invalid', code: error.code, message: error.message });
      return 3;
    }
    log({ event: 'agt003_weekly_digest_failed', message: String(error?.message || error).slice(0, 300), stack: String(error?.stack || '').split('\n').slice(1, 5).join(' | ').slice(0, 500) });
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
