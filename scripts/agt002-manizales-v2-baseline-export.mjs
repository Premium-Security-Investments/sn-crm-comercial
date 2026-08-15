import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

import { assertNoOpenPii } from '../agt002-contractual-registry-taxonomy.js';
import {
  assertSanitaryReconcileMetadataOnly,
  createReadOnlyClientGuard,
  loadEnvFile,
} from './agt002-manizales-pre-go-production-reconcile.mjs';

const OPPORTUNITY_ID = '54190e51-15fb-46af-b0aa-8f13461a3110';
const ARTIFACT_TYPE = 'agt002_manizales_v2_production_baseline';
const CONTRACT_VERSION = 'agt002-manizales-v2-production-baseline@1';
const RESULT_ARRAY_FIELDS = Object.freeze(['strengths', 'weaknesses', 'blockers', 'questions', 'unverified']);

const DIMENSION_PATTERNS = Object.freeze({
  closing_or_extension: [/\bfecha de cierre\b/giu, /\bcierre\b/giu, /\bpr[oó]rroga\b/giu, /\bcronograma\b/giu],
  supervigilancia_license: [/\bsupervigilancia\b/giu, /\blicencia de funcionamiento\b/giu, /\blicencia operativa\b/giu],
  experience: [/\bexperiencia\b/giu, /\bcontratos? ejecutad/giu, /\bacreditaci[oó]n de experiencia\b/giu],
  sst: [/\bsg[- ]?sst\b/giu, /\bseguridad y salud en el trabajo\b/giu, /\bsistema de gesti[oó]n.*sst\b/giu],
  insurance_package: [/\bp[oó]liza/giu, /\bresponsabilidad civil extracontractual\b/giu, /\bvida colectiva\b/giu, /\brce\b/giu],
  financial_capacity: [/\bcapital de trabajo\b/giu, /\bcapacidad financiera\b/giu, /\bliquidez\b/giu, /\bendeudamiento\b/giu, /\bpatrimonio\b/giu],
  documentary_package: [/\bpaquete documental\b/giu, /\bdocumentos? habilitantes\b/giu, /\brup\b/giu, /\brut\b/giu, /\bcertificad/giu],
  technical_cctv: [/\bcctv\b/giu, /\bvideovigilancia\b/giu, /\bc[aá]maras?\b/giu],
  economic_viability: [/\bviabilidad econ[oó]mica\b/giu, /\boferta econ[oó]mica\b/giu, /\bpresupuesto oficial\b/giu, /\bprecio\b/giu],
});

const FIXTURE_KEYS = Object.freeze([
  'artifact_type', 'contract_version', 'read_only', 'metadata_only', 'human_go_no_go_required',
  'opportunity_id', 'generated_at', 'source_run', 'result_field_counts', 'dimensions',
]);
const SOURCE_RUN_KEYS = Object.freeze([
  'id', 'created_at', 'completed_at', 'status', 'producer', 'method', 'canonical',
  'critical_open_count', 'schema_version', 'policy_version', 'critical_question_count',
]);
const DIMENSION_KEYS = Object.freeze(Object.keys(DIMENSION_PATTERNS));

function exactKeys(value, expected, label) {
  const actual = Object.keys(value || {}).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} tiene una forma no permitida.`);
  }
}

function collectStrings(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach(item => collectStrings(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => collectStrings(item, output));
  return output;
}

function classifyDimensions(result) {
  const bySection = Object.fromEntries(Object.entries(result || {}).map(([key, value]) => [key, collectStrings(value)]));
  return Object.fromEntries(DIMENSION_KEYS.map(dimension => {
    let occurrences = 0;
    const sourceSections = [];
    for (const [section, strings] of Object.entries(bySection)) {
      let sectionHits = 0;
      for (const text of strings) {
        for (const pattern of DIMENSION_PATTERNS[dimension]) {
          pattern.lastIndex = 0;
          sectionHits += [...text.matchAll(pattern)].length;
        }
      }
      if (sectionHits > 0) sourceSections.push(section);
      occurrences += sectionHits;
    }
    return [dimension, { present: occurrences > 0, occurrences, source_sections: sourceSections.sort() }];
  }));
}

export function buildSanitaryV2Baseline(run, { opportunityId = OPPORTUNITY_ID, generatedAt } = {}) {
  if (!run || typeof run !== 'object') throw new Error('Se requiere una corrida V2.');
  if (typeof run.schema_version !== 'string' || !run.schema_version.startsWith('2.')) {
    throw new Error('La corrida fuente debe usar schema 2.x.');
  }
  if (run.status !== 'completed' || !run.result || typeof run.result !== 'object') {
    throw new Error('La corrida V2 fuente debe estar completed y tener result.');
  }
  if (typeof generatedAt !== 'string' || !generatedAt) throw new Error('generatedAt es obligatorio.');

  const questions = Array.isArray(run.result.questions) ? run.result.questions : [];
  const fixture = {
    artifact_type: ARTIFACT_TYPE,
    contract_version: CONTRACT_VERSION,
    read_only: true,
    metadata_only: true,
    human_go_no_go_required: true,
    opportunity_id: opportunityId,
    generated_at: generatedAt,
    source_run: {
      id: run.id,
      created_at: run.created_at,
      completed_at: run.completed_at,
      status: run.status,
      producer: run.producer,
      method: run.method,
      canonical: run.canonical === true,
      critical_open_count: run.critical_open_count,
      schema_version: run.schema_version,
      policy_version: run.policy_version,
      critical_question_count: questions.filter(question => question?.critical === true).length,
    },
    result_field_counts: Object.fromEntries(RESULT_ARRAY_FIELDS.map(field => [
      field,
      Array.isArray(run.result[field]) ? run.result[field].length : 0,
    ])),
    dimensions: classifyDimensions(run.result),
  };
  validateSanitaryV2Baseline(fixture);
  return fixture;
}

export function validateSanitaryV2Baseline(value) {
  exactKeys(value, FIXTURE_KEYS, 'fixture V2');
  exactKeys(value.source_run, SOURCE_RUN_KEYS, 'source_run V2');
  exactKeys(value.dimensions, DIMENSION_KEYS, 'dimensions V2');
  if (value.artifact_type !== ARTIFACT_TYPE || value.contract_version !== CONTRACT_VERSION) {
    throw new Error('Contrato de fixture V2 inválido.');
  }
  if (value.read_only !== true || value.metadata_only !== true || value.human_go_no_go_required !== true) {
    throw new Error('La fixture V2 debe ser read-only, metadata-only y conservar gate humano.');
  }
  if (!value.source_run.schema_version.startsWith('2.')) throw new Error('La corrida fuente debe usar schema 2.x.');
  for (const [dimension, state] of Object.entries(value.dimensions)) {
    exactKeys(state, ['present', 'occurrences', 'source_sections'], `dimension ${dimension}`);
    if (typeof state.present !== 'boolean' || !Number.isInteger(state.occurrences) || state.occurrences < 0) {
      throw new Error(`Estado inválido para dimensión ${dimension}.`);
    }
    if (!Array.isArray(state.source_sections) || state.source_sections.some(section => typeof section !== 'string')) {
      throw new Error(`Fuentes inválidas para dimensión ${dimension}.`);
    }
  }
  assertNoOpenPii(value);
  assertSanitaryReconcileMetadataOnly(value);
  return value;
}

function parseArgs(argv) {
  const options = { envPath: null, outputPath: null, generatedAt: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--env-file') options.envPath = resolve(argv[++index] || '');
    else if (token === '--output') options.outputPath = resolve(argv[++index] || '');
    else if (token === '--generated-at') options.generatedAt = argv[++index] || null;
    else throw new Error(`Argumento no soportado: ${token}`);
  }
  return options;
}

export async function loadLatestHistoricalV2Run(database, opportunityId = OPPORTUNITY_ID) {
  const guarded = createReadOnlyClientGuard(database);
  const response = await guarded.from('psi_tender_analysis_runs')
    .select('id,created_at,completed_at,status,producer,method,canonical,critical_open_count,schema_version,policy_version,result')
    .eq('opportunity_id', opportunityId)
    .like('schema_version', '2.%')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (response.error) throw response.error;
  if (!response.data) throw new Error('No se encontró una corrida V2 histórica completada.');
  return response.data;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.envPath || !options.outputPath) throw new Error('--env-file y --output son obligatorios.');
  loadEnvFile(options.envPath);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('Configuración Supabase no disponible.');
  const database = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const run = await loadLatestHistoricalV2Run(database);
  const fixture = buildSanitaryV2Baseline(run, {
    opportunityId: OPPORTUNITY_ID,
    generatedAt: options.generatedAt || new Date().toISOString(),
  });
  mkdirSync(dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    source_run_id: fixture.source_run.id,
    schema_version: fixture.source_run.schema_version,
    canonical: fixture.source_run.canonical,
    dimensions_present: Object.values(fixture.dimensions).filter(state => state.present).length,
    output: options.outputPath,
    read_only: true,
    metadata_only: true,
  })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`agt002-manizales-v2-baseline-export falló: ${String(error?.message || error).split(/\r?\n/, 1)[0]}\n`);
    process.exitCode = 1;
  });
}
