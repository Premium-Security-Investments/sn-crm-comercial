#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

import { validateAgt002EvidencePackageFreezeRequest } from '../agt002-evidence-package-api.js';
import { normalizeAgt002WorkflowScopeSnapshot } from '../agt002-initial-workflow.js';
import { admitAgt002InitialAnalysis } from '../agt002-initial-analysis-admission.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCHEMA_VERSION = 'agt002-initial-analysis-admission-v1';
const MANIFEST_KEYS = new Set([
  'schema_version',
  'opportunity_id',
  'tender_id',
  'actor_profile_id',
  'expires_at',
  'policy_version',
  'scope',
  'profile_snapshot_id',
  'profile_snapshot_hash',
  'documents',
  'attempt',
  'analysis_kind',
  'source_analysis_run_id',
]);

function requireUuid(value, label) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new Error(`${label} debe ser un UUID.`);
  return value.toLowerCase();
}

export function parseAgt002InitialAnalysisAdmissionManifest(source) {
  let value;
  try { value = JSON.parse(source); }
  catch { throw new Error('El manifiesto INITIAL no es JSON válido.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('El manifiesto INITIAL debe ser un objeto.');
  }
  const unexpected = Object.keys(value).filter(key => !MANIFEST_KEYS.has(key));
  if (unexpected.length > 0) throw new Error(`El manifiesto INITIAL contiene campos unexpected: ${unexpected.join(', ')}.`);
  if (value.schema_version !== SCHEMA_VERSION) throw new Error('La schema_version del manifiesto INITIAL no es válida.');

  const opportunityId = requireUuid(value.opportunity_id, 'opportunity_id');
  const tenderId = requireUuid(value.tender_id, 'tender_id');
  const actorProfileId = requireUuid(value.actor_profile_id, 'actor_profile_id');
  const { requestedMembers } = validateAgt002EvidencePackageFreezeRequest({
    opportunity_id: opportunityId,
    documents: value.documents,
  });
  if (typeof value.expires_at !== 'string' || !Number.isFinite(Date.parse(value.expires_at))) {
    throw new Error('expires_at debe ser un timestamp válido.');
  }
  if (typeof value.policy_version !== 'string' || value.policy_version.trim() === '') {
    throw new Error('policy_version es obligatoria.');
  }
  if (value.attempt !== undefined && (!Number.isInteger(value.attempt) || value.attempt < 2)) {
    throw new Error('attempt debe ser un entero mayor o igual a 2 cuando se indica.');
  }
  // REANALYSIS (migration 108): both keys travel together; INITIAL manifests carry neither.
  const analysisKind = value.analysis_kind ?? 'INITIAL';
  if (analysisKind !== 'INITIAL' && analysisKind !== 'REANALYSIS') throw new Error('analysis_kind debe ser INITIAL o REANALYSIS.');
  const sourceAnalysisRunId = analysisKind === 'REANALYSIS'
    ? requireUuid(value.source_analysis_run_id, 'source_analysis_run_id')
    : null;
  if (analysisKind === 'INITIAL' && value.source_analysis_run_id != null) {
    throw new Error('Un manifiesto INITIAL no lleva source_analysis_run_id.');
  }
  const normalizedScope = normalizeAgt002WorkflowScopeSnapshot({
    scope: value.scope,
    profileSnapshotId: value.profile_snapshot_id,
    profileSnapshotHash: value.profile_snapshot_hash,
  });
  return Object.freeze({
    opportunityId,
    tenderId,
    actorProfileId,
    requestedMembers,
    expiresAt: value.expires_at,
    policyVersion: value.policy_version.trim(),
    attempt: value.attempt ?? null,
    ...(analysisKind === 'REANALYSIS' ? { analysisKind, sourceAnalysisRunId } : {}),
    ...normalizedScope,
  });
}

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== '--manifest' || typeof argv[1] !== 'string' || !argv[1].startsWith('/')) {
    throw new Error('Uso: node scripts/agt002-initial-analysis-admit.mjs --manifest /ruta/absoluta/protegida.json');
  }
  return argv[1];
}

export async function runAgt002InitialAnalysisAdmissionCli({ argv = process.argv.slice(2), environment = process.env } = {}) {
  const manifestPath = parseArgs(argv);
  const manifestStat = statSync(manifestPath);
  if (!manifestStat.isFile() || (manifestStat.mode & 0o077) !== 0) {
    throw new Error('El manifiesto INITIAL debe ser un archivo regular sin permisos para grupo u otros.');
  }
  const manifest = parseAgt002InitialAnalysisAdmissionManifest(readFileSync(manifestPath, 'utf8'));
  const supabaseUrl = String(environment.SUPABASE_URL || environment.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const serviceRoleKey = String(environment.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !serviceRoleKey) throw new Error('La configuración Supabase del runtime INITIAL no está disponible.');
  const database = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  return admitAgt002InitialAnalysis(database, { ...manifest, environment });
}

const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  try {
    const result = await runAgt002InitialAnalysisAdmissionCli();
    console.log(JSON.stringify({ event: 'agt002_initial_analysis_admitted', ...result }));
  } catch (error) {
    console.error(JSON.stringify({ event: 'agt002_initial_analysis_admission_failed', code: error?.code || 'ADMISSION_FAILED' }));
    process.exitCode = 1;
  }
}
