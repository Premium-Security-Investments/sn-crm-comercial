import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planAerocivilBackfill } from '../aerocivil-backfill-dryrun.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function loadEnvFile(path = resolve(root, '.env.local')) {
  let source = '';
  try { source = readFileSync(path, 'utf8'); } catch { return; }
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const separator = line.indexOf('=');
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

function requireUuid(value, label) {
  if (!UUID_PATTERN.test(String(value || ''))) throw new Error(`${label} debe ser un UUID válido.`);
  return String(value);
}

async function readRest(baseUrl, serviceKey, table, query) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/rest/v1/${table}?${query}`, {
    method: 'GET',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Lectura ${table} falló con HTTP ${response.status}.`);
  return response.json();
}

export async function runAerocivilBackfillDryRun({ opportunityId, tenderId, baseUrl, serviceKey } = {}) {
  const opportunityUuid = requireUuid(opportunityId, 'opportunity-uuid');
  const tenderUuid = requireUuid(tenderId, 'tender-uuid');
  if (!baseUrl || !serviceKey) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');

  const tenderQuery = new URLSearchParams({
    select: 'id,converted_opportunity_id,source,entity,title',
    id: `eq.${tenderUuid}`,
    converted_opportunity_id: `eq.${opportunityUuid}`,
    limit: '1',
  });
  const tenders = await readRest(baseUrl, serviceKey, 'psi_public_tenders', tenderQuery.toString());
  if (tenders.length !== 1) throw new Error('Los UUID indicados no corresponden a una licitación convertida única.');

  const interactionQuery = new URLSearchParams({
    select: 'id,opportunity_id,interaction_type,notes,occurred_at',
    opportunity_id: `eq.${opportunityUuid}`,
    interaction_type: 'eq.documento',
    order: 'occurred_at.asc',
  });
  const interactions = await readRest(baseUrl, serviceKey, 'psi_sales_interactions', interactionQuery.toString());
  return { opportunity_id: opportunityUuid, tender_id: tenderUuid, tender: tenders[0], ...planAerocivilBackfill({ interactions, expectedCount: 40 }) };
}

export async function main(args = process.argv.slice(2)) {
  const [opportunityId, tenderId] = args;
  if (!opportunityId || !tenderId) {
    console.error('Uso: node scripts/aerocivil-backfill-dryrun.mjs <opportunity-uuid> <tender-uuid>');
    process.exitCode = 2;
    return;
  }
  loadEnvFile(process.env.ENV_FILE || resolve(root, '.env.local'));
  const plan = await runAerocivilBackfillDryRun({ opportunityId, tenderId, baseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY });
  console.log(JSON.stringify(plan, null, 2));
  if (plan.found !== plan.expected || plan.excluded.length) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
