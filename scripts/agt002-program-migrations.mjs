import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
export const MIGRATION_ORDER = Object.freeze(['049', '050', '051', '052', '053']);

const fn = signature => `to_regprocedure('public.${signature}') is not null`;
const fnInvariant = (signature, fragments) => `exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.${signature}') and ${fragments.map(fragment => `pg_get_functiondef(p.oid) ilike '%${fragment.replaceAll("'", "''")}%'`).join(' and ')})`;
const anyFnInvariant = (signatures, fragments) => `(${signatures.map(signature => fnInvariant(signature, fragments)).join(' or ')})`;
const table = name => `exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='${name}' and c.relkind in ('r','p'))`;
const index = (tableName, name) => `exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_index i on i.indexrelid=c.oid where n.nspname='public' and c.relname='${name}' and c.relkind='i' and i.indrelid=to_regclass('public.${tableName}'))`;
const column = (tableName, columnName) => `exists (select 1 from information_schema.columns where table_schema='public' and table_name='${tableName}' and column_name='${columnName}')`;
const constraint = (tableName, name, type = 'c') => `exists (select 1 from pg_constraint where conname='${name}' and conrelid=to_regclass('public.${tableName}') and contype='${type}')`;
const trigger = (tableName, name) => `exists (select 1 from pg_trigger where tgrelid=to_regclass('public.${tableName}') and tgname='${name}' and not tgisinternal)`;

const SPECS = Object.freeze({
  '049': Object.freeze({
    migrationFile: '049_tender_processing_lease_release.sql',
    rollbackFile: '049_tender_processing_lease_release_rollback.sql',
    prerequisites: [table('psi_tender_processing_jobs'), table('psi_tender_document_snapshots'), table('psi_tender_analysis_runs'), fn('psi_update_tender_processing_job(uuid,uuid,jsonb)')],
    markers: [`exists (select 1 from pg_proc where oid=to_regprocedure('public.psi_update_tender_processing_job(uuid,uuid,jsonb)') and pg_get_functiondef(oid) like '%v_release_lease boolean%')`],
    tables: [],
    functions: ['psi_update_tender_processing_job(uuid,uuid,jsonb)'],
    rlsTables: [],
    rollbackPolicy: 'restore',
  }),
  '050': Object.freeze({
    migrationFile: '050_agt002_canonical_analysis.sql',
    rollbackFile: '050_agt002_canonical_analysis_rollback.sql',
    prerequisites: [table('psi_tender_analysis_runs'), table('psi_tender_document_snapshots'), table('psi_sales_opportunities'), table('psi_public_tenders')],
    markers: [
      column('psi_tender_analysis_runs', 'canonical'),
      constraint('psi_tender_analysis_runs', 'psi_tender_analysis_runs_canonical_agt002_check'),
      index('psi_tender_analysis_runs', 'psi_tender_analysis_runs_canonical_current_idx'),
      table('psi_agt002_analysis_attempt_events'),
      index('psi_agt002_analysis_attempt_events', 'psi_agt002_analysis_attempt_events_attempt_idx'),
      index('psi_agt002_analysis_attempt_events', 'psi_agt002_analysis_attempt_events_opportunity_idx'),
      trigger('psi_agt002_analysis_attempt_events', 'psi_agt002_analysis_attempt_events_immutable'),
      `(((to_regprocedure('public.psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb)') is not null)::int
        + (to_regprocedure('public.psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid)') is not null)::int
        + (to_regprocedure('public.psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid,uuid)') is not null)::int) = 1)`,
      anyFnInvariant([
        'psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb)',
        'psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid)',
        'psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid,uuid)',
      ], ['insert into public.psi_tender_analysis_runs', 'v_run.canonical is distinct from true']),
      fnInvariant('psi_append_agt002_analysis_attempt(uuid,uuid,uuid,text,text,text,text,text,text,uuid)', ['insert into public.psi_agt002_analysis_attempt_events', 'where event_key = p_event_key']),
      fnInvariant('psi_agt002_analysis_attempt_events_prevent_mutation()', ['append-only']),
    ],
    tables: ['psi_agt002_analysis_attempt_events'],
    auditTables: ['psi_agt002_analysis_attempt_events', 'psi_tender_analysis_runs'],
    functions: [
      'psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb)',
      'psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid)',
      'psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid,uuid)',
      'psi_append_agt002_analysis_attempt(uuid,uuid,uuid,text,text,text,text,text,text,uuid)',
    ],
    rlsTables: ['psi_agt002_analysis_attempt_events', 'psi_tender_analysis_runs'],
    rollbackPolicy: 'destructive-zero-data',
    allowInsecureAbsent: true,
  }),
  '051': Object.freeze({
    migrationFile: '051_agt002_context_versions.sql',
    rollbackFile: '051_agt002_context_versions_rollback.sql',
    prerequisites: [table('psi_tender_analysis_runs'), table('psi_tender_document_snapshots'), table('psi_sales_opportunities'), table('psi_public_tenders'), `(to_regprocedure('public.psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb)') is not null or to_regprocedure('public.psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid)') is not null or to_regprocedure('public.psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid,uuid)') is not null)`],
    markers: [
      table('psi_agt002_context_versions'),
      index('psi_agt002_context_versions', 'psi_agt002_context_versions_opportunity_idx'),
      index('psi_agt002_context_versions', 'psi_agt002_context_versions_snapshot_idx'),
      trigger('psi_agt002_context_versions', 'psi_agt002_context_versions_immutable'),
      column('psi_tender_analysis_runs', 'context_version_id'),
      index('psi_tender_analysis_runs', 'psi_tender_analysis_runs_context_version_idx'),
      fnInvariant('psi_record_agt002_context_version(uuid,uuid,uuid,integer,jsonb,text,integer,text,uuid)', ['insert into public.psi_agt002_context_versions', 'on conflict (idempotency_key) do nothing']),
      `(((to_regprocedure('public.psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid)') is not null)::int
        + (to_regprocedure('public.psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid,uuid)') is not null)::int) = 1)`,
      anyFnInvariant([
        'psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid)',
        'psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid,uuid)',
      ], ['p_context_version_id is null', 'insert into public.psi_tender_analysis_runs']),
      fnInvariant('psi_agt002_context_versions_prevent_mutation()', ['append-only']),
    ],
    tables: ['psi_agt002_context_versions'],
    auditTables: ['psi_agt002_context_versions', 'psi_tender_analysis_runs'],
    functions: [
      'psi_record_agt002_context_version(uuid,uuid,uuid,integer,jsonb,text,integer,text,uuid)',
      'psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid)',
      'psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid,uuid)',
    ],
    rlsTables: ['psi_agt002_context_versions', 'psi_tender_analysis_runs'],
    rollbackPolicy: 'destructive-zero-data',
  }),
  '052': Object.freeze({
    migrationFile: '052_tender_document_chunks.sql',
    rollbackFile: '052_tender_document_chunks_rollback.sql',
    prerequisites: [table('psi_tender_document_versions'), table('psi_tender_document_snapshots'), table('psi_sales_opportunities'), table('psi_public_tenders'), table('psi_sales_profiles')],
    markers: [
      table('psi_tender_document_chunks'),
      index('psi_tender_document_chunks', 'psi_tender_document_chunks_opportunity_idx'),
      index('psi_tender_document_chunks', 'psi_tender_document_chunks_snapshot_idx'),
      index('psi_tender_document_chunks', 'psi_tender_document_chunks_document_version_idx'),
      trigger('psi_tender_document_chunks', 'psi_tender_document_chunks_immutable'),
      fnInvariant('psi_tender_document_chunks_prevent_mutation()', ['append-only']),
      fnInvariant('psi_record_tender_document_chunk(uuid,uuid,uuid,uuid,text,text,text,text,integer,text,integer,integer,integer,text,text,boolean,text,boolean,uuid)', ['insert into public.psi_tender_document_chunks', 'on conflict (chunk_id) do nothing']),
    ],
    tables: ['psi_tender_document_chunks'],
    auditTables: ['psi_tender_document_chunks', 'psi_tender_analysis_runs'],
    functions: ['psi_record_tender_document_chunk(uuid,uuid,uuid,uuid,text,text,text,text,integer,text,integer,integer,integer,text,text,boolean,text,boolean,uuid)'],
    rlsTables: ['psi_tender_document_chunks', 'psi_tender_analysis_runs'],
    rollbackPolicy: 'non-destructive-disable',
    disabledMarkerCount: 1,
  }),
  '053': Object.freeze({
    migrationFile: '053_agt002_legal_corpus.sql',
    rollbackFile: '053_agt002_legal_corpus_rollback.sql',
    prerequisites: [table('psi_tender_analysis_runs'), table('psi_tender_document_snapshots'), table('psi_agt002_context_versions'), table('psi_sales_profiles'), `(to_regprocedure('public.psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid)') is not null or to_regprocedure('public.psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid,uuid)') is not null)`],
    markers: [
      table('psi_agt002_legal_corpus_versions'), table('psi_agt002_legal_sources'), table('psi_agt002_legal_topics'),
      index('psi_agt002_legal_corpus_versions', 'psi_agt002_legal_corpus_versions_status_idx'), index('psi_agt002_legal_sources', 'psi_agt002_legal_sources_corpus_version_idx'), index('psi_tender_analysis_runs', 'psi_tender_analysis_runs_legal_corpus_version_idx'),
      trigger('psi_agt002_legal_corpus_versions', 'psi_agt002_legal_corpus_versions_guard'),
      trigger('psi_agt002_legal_sources', 'psi_agt002_legal_sources_immutable'),
      trigger('psi_agt002_legal_sources', 'psi_agt002_legal_sources_guard_insert'),
      trigger('psi_agt002_legal_topics', 'psi_agt002_legal_topics_immutable'),
      column('psi_tender_analysis_runs', 'legal_corpus_version_id'),
      fnInvariant('psi_agt002_legal_corpus_versions_guard()', ['old.status', 'new.published_at is null']),
      fnInvariant('psi_agt002_legal_sources_prevent_mutation()', ['append-only']),
      fnInvariant('psi_agt002_legal_sources_guard_insert()', ['select status into v_status', 'new.corpus_version_id']),
      fnInvariant('psi_agt002_legal_topics_prevent_mutation()', ['append-only']),
      fnInvariant('psi_create_agt002_legal_corpus_draft(text,text,uuid,uuid)', ['insert into public.psi_agt002_legal_corpus_versions', "'draft'"]),
      fnInvariant('psi_add_agt002_legal_source(uuid,text,text,text,integer,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,jsonb,text,text[],text[],timestamp with time zone,text,text,text,uuid)', ['insert into public.psi_agt002_legal_sources', 'select * into v_version']),
      fnInvariant('psi_publish_agt002_legal_corpus(uuid,uuid)', ['update public.psi_agt002_legal_corpus_versions']),
      `(to_regprocedure('public.psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid,uuid)') is not null
        and to_regprocedure('public.psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid)') is null)`,
      fnInvariant('psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid,uuid)', ['p_context_version_id is null', 'insert into public.psi_tender_analysis_runs']),
    ],
    tables: ['psi_agt002_legal_corpus_versions', 'psi_agt002_legal_sources', 'psi_agt002_legal_topics'],
    auditTables: ['psi_agt002_legal_corpus_versions', 'psi_agt002_legal_sources', 'psi_agt002_legal_topics', 'psi_tender_analysis_runs'],
    functions: [
      'psi_create_agt002_legal_corpus_draft(text,text,uuid,uuid)',
      'psi_add_agt002_legal_source(uuid,text,text,text,integer,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,jsonb,text,text[],text[],timestamp with time zone,text,text,text,uuid)',
      'psi_publish_agt002_legal_corpus(uuid,uuid)',
      'psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid,uuid)',
    ],
    rlsTables: ['psi_agt002_legal_corpus_versions', 'psi_agt002_legal_sources', 'psi_agt002_legal_topics', 'psi_tender_analysis_runs'],
    rollbackPolicy: 'non-destructive-disable',
    disabledMarkerCount: 5,
  }),
});

export function getSpec(id) {
  if (typeof id !== 'string' || !Object.hasOwn(SPECS, id)) throw new Error('Selector de migración inválido; use exactamente 049, 050, 051, 052 o 053.');
  return SPECS[id];
}

const sqlStringList = values => values.map(value => `'${value.replaceAll("'", "''")}'`).join(', ');
const procedureArray = values => values.map(value => `to_regprocedure('public.${value}')::oid`).join(', ');
const markersCountExpr = spec => `(${spec.markers.map(expr => `(${expr})::int`).join(' + ')})`;
const missingPrerequisitesExpr = spec => `(${spec.prerequisites.map(expr => `(not (${expr}))::int`).join(' + ')})`;
const unsafeTableGrantsExpr = spec => {
  const audited = spec.auditTables || spec.tables;
  const names = audited.length ? sqlStringList(audited) : "''";
  return `(select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r',c.relowner))) a
    left join pg_roles r on r.oid=a.grantee
    where n.nspname='public' and c.relname in (${names})
      and (a.grantee=0 or lower(r.rolname) in ('anon','authenticated')))`;
};
const unsafeFunctionGrantsExpr = spec => {
  const oids = spec.functions.length ? procedureArray(spec.functions) : 'null::oid';
  return `(select count(*)::int from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
    left join pg_roles r on r.oid=a.grantee
    where p.oid = any(array[${oids}])
      and a.privilege_type='EXECUTE' and (a.grantee=0 or lower(r.rolname) in ('anon','authenticated')))`;
};
const missingServiceExecExpr = spec => spec.functions.length
  ? `(${spec.functions.map(signature => `(case when to_regprocedure('public.${signature}') is not null and not has_function_privilege('service_role','public.${signature}','EXECUTE') then 1 else 0 end)`).join(' + ')})`
  : '0';
const missingServiceSelectExpr = spec => spec.tables.length
  ? `(${(spec.auditTables || spec.tables).map(name => `(case when to_regclass('public.${name}') is not null and not has_table_privilege('service_role','public.${name}','SELECT') then 1 else 0 end)`).join(' + ')})`
  : '0';
const rlsMissingExpr = spec => {
  const names = spec.rlsTables.length ? sqlStringList(spec.rlsTables) : "''";
  return `(select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in (${names}) and not c.relrowsecurity)`;
};
const secureStateExpr = spec => `(${unsafeTableGrantsExpr(spec)} = 0 and ${unsafeFunctionGrantsExpr(spec)} = 0
  and ${missingServiceExecExpr(spec)} = 0 and ${missingServiceSelectExpr(spec)} = 0 and ${rlsMissingExpr(spec)} = 0)`;
const advisoryLockSql = "perform pg_advisory_xact_lock(hashtextextended('agt002-program-migrations-049-053', 0));";
const disabledStateExpr = spec => {
  if (!spec.disabledMarkerCount) return 'false';
  const split = spec.markers.length - spec.disabledMarkerCount;
  const preserved = spec.markers.slice(0, split).map(expr => `(${expr})`).join(' and ');
  const disabled = spec.markers.slice(split).map(expr => `(not (${expr}))`).join(' and ');
  return `((${preserved}) and (${disabled}) and ${secureStateExpr(spec)})`;
};

export function buildAtomicApplySql(id, migrationSql) {
  const spec = getSpec(id);
  const body = stripTopLevelTransactionWrapper(migrationSql);
  return `-- AGT002_RUNNER:ATOMIC_APPLY:${id}
do $agt002_apply$
begin
  ${advisoryLockSql}
  if ${missingPrerequisitesExpr(spec)} <> 0 then
    raise exception 'AGT002_PREREQUISITES_${id}';
  end if;
  if ${markersCountExpr(spec)} = ${spec.markers.length} and ${secureStateExpr(spec)} then
    raise exception 'AGT002_ALREADY_APPLIED_${id}';
  end if;
  if not ((${markersCountExpr(spec)} = 0 and ${spec.allowInsecureAbsent === true ? 'true' : secureStateExpr(spec)}) or ${disabledStateExpr(spec)}) then
    raise exception 'AGT002_STATE_DRIFT_${id}';
  end if;
end
$agt002_apply$;
${body}`;
}

export function buildPrerequisitesSql(id) {
  const spec = getSpec(id);
  return `-- AGT002_RUNNER:PREREQUISITES:${id}\nselect ${missingPrerequisitesExpr(spec)}::int as missing_prerequisites;`;
}

export function buildStateSql(id) {
  const spec = getSpec(id);
  return `-- AGT002_RUNNER:STATE:${id}
select
  ${markersCountExpr(spec)}::int as markers_present,
  ${spec.markers.length}::int as markers_expected,
  ${unsafeTableGrantsExpr(spec)} as unsafe_table_grants,
  ${unsafeFunctionGrantsExpr(spec)} as unsafe_function_grants,
  ${missingServiceExecExpr(spec)}::int as missing_service_exec,
  ${missingServiceSelectExpr(spec)}::int as missing_service_select,
  ${rlsMissingExpr(spec)} as rls_missing;`;
}

export function classifyState(row) {
  const present = Number(row?.markers_present);
  const expected = Number(row?.markers_expected);
  if (!Number.isFinite(present) || !Number.isFinite(expected) || expected < 1 || present < 0 || present > expected) return 'drift';
  if (present === 0) return 'absent';
  if (present < expected) return 'partial';
  const insecure = Number(row?.unsafe_table_grants) !== 0 || Number(row?.unsafe_function_grants) !== 0
    || Number(row?.missing_service_exec) !== 0 || Number(row?.missing_service_select) !== 0 || Number(row?.rls_missing) !== 0;
  return insecure ? 'drift' : 'applied';
}

export function buildRollbackGuardSql(id) {
  getSpec(id);
  if (id === '050') return `-- AGT002_RUNNER:ROLLBACK_GUARD:050
select (not exists (select 1 from public.psi_agt002_analysis_attempt_events)
  and not exists (select 1 from public.psi_tender_analysis_runs where canonical is true)
  and to_regclass('public.psi_agt002_context_versions') is null) as safe;`;
  if (id === '051') return `-- AGT002_RUNNER:ROLLBACK_GUARD:051
select (not exists (select 1 from public.psi_agt002_context_versions)
  and not exists (select 1 from public.psi_tender_analysis_runs where context_version_id is not null)
  and to_regclass('public.psi_agt002_legal_corpus_versions') is null) as safe;`;
  return `-- AGT002_RUNNER:ROLLBACK_GUARD:${id}\nselect true as safe;`;
}

export function buildRollbackVerifySql(id) {
  getSpec(id);
  if (id === '049') return `-- AGT002_RUNNER:ROLLBACK_VERIFY:049
select exists (select 1 from pg_proc where oid=to_regprocedure('public.psi_update_tender_processing_job(uuid,uuid,jsonb)') and pg_get_functiondef(oid) not like '%v_release_lease boolean%') as ok;`;
  if (id === '050') return `-- AGT002_RUNNER:ROLLBACK_VERIFY:050
select (to_regclass('public.psi_agt002_analysis_attempt_events') is null
  and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='psi_tender_analysis_runs' and column_name='canonical')
  and to_regprocedure('public.psi_append_agt002_analysis_attempt(uuid,uuid,uuid,text,text,text,text,text,text,uuid)') is null) as ok;`;
  if (id === '051') return `-- AGT002_RUNNER:ROLLBACK_VERIFY:051
select (to_regclass('public.psi_agt002_context_versions') is null
  and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='psi_tender_analysis_runs' and column_name='context_version_id')
  and to_regprocedure('public.psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb)') is not null
  and to_regprocedure('public.psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid)') is null) as ok;`;
  if (id === '052') return `-- AGT002_RUNNER:ROLLBACK_VERIFY:052
select (to_regclass('public.psi_tender_document_chunks') is not null
  and to_regprocedure('public.psi_record_tender_document_chunk(uuid,uuid,uuid,uuid,text,text,text,text,integer,text,integer,integer,integer,text,text,boolean,text,boolean,uuid)') is null) as ok;`;
  return `-- AGT002_RUNNER:ROLLBACK_VERIFY:053
select (to_regclass('public.psi_agt002_legal_corpus_versions') is not null
  and to_regclass('public.psi_agt002_legal_sources') is not null
  and to_regclass('public.psi_agt002_legal_topics') is not null
  and to_regprocedure('public.psi_create_agt002_legal_corpus_draft(text,text,uuid,uuid)') is null
  and to_regprocedure('public.psi_add_agt002_legal_source(uuid,text,text,text,integer,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,jsonb,text,text[],text[],timestamp with time zone,text,text,text,uuid)') is null
  and to_regprocedure('public.psi_publish_agt002_legal_corpus(uuid,uuid)') is null
  and to_regprocedure('public.psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid)') is not null
  and to_regprocedure('public.psi_record_agt002_canonical_analysis_run(uuid,uuid,uuid,jsonb,integer,text,text,text,text,jsonb,uuid,uuid)') is null) as ok;`;
}

export function buildAtomicRollbackSql(id, rollbackSql) {
  const spec = getSpec(id);
  const body = stripTopLevelTransactionWrapper(rollbackSql);
  let locks = '';
  let guard = '';
  if (id === '050') {
    locks = "execute 'lock table public.psi_agt002_analysis_attempt_events, public.psi_tender_analysis_runs in share row exclusive mode';";
    guard = `if exists (select 1 from public.psi_agt002_analysis_attempt_events)
      or exists (select 1 from public.psi_tender_analysis_runs where canonical is true)
      or to_regclass('public.psi_agt002_context_versions') is not null then
      raise exception 'rollback 050 bloqueado: existe evidencia o una migración dependiente';
    end if;`;
  } else if (id === '051') {
    locks = "execute 'lock table public.psi_agt002_context_versions, public.psi_tender_analysis_runs in share row exclusive mode';";
    guard = `if exists (select 1 from public.psi_agt002_context_versions)
      or exists (select 1 from public.psi_tender_analysis_runs where context_version_id is not null)
      or to_regclass('public.psi_agt002_legal_corpus_versions') is not null then
      raise exception 'rollback 051 bloqueado: existe evidencia o una migración dependiente';
    end if;`;
  }
  return `-- AGT002_RUNNER:ATOMIC_ROLLBACK:${id}
do $agt002_rollback$
begin
  ${advisoryLockSql}
  if ${markersCountExpr(spec)} = 0 or ${disabledStateExpr(spec)} then
    raise exception 'AGT002_ALREADY_ROLLED_BACK_${id}';
  end if;
  if not (${markersCountExpr(spec)} = ${spec.markers.length} and ${secureStateExpr(spec)}) then
    raise exception 'AGT002_STATE_DRIFT_${id}';
  end if;
  ${locks}
  if not (${markersCountExpr(spec)} = ${spec.markers.length} and ${secureStateExpr(spec)}) then
    raise exception 'AGT002_STATE_DRIFT_AFTER_LOCK_${id}';
  end if;
  ${guard}
end
$agt002_rollback$;
${body}`;
}

export async function readState(execSql, id) {
  const spec = getSpec(id);
  const [row] = await execSql(buildStateSql(id));
  let status = classifyState(row);
  if (status === 'partial' && spec.disabledMarkerCount) {
    const [disabled] = await execSql(buildRollbackVerifySql(id));
    if (disabled?.ok === true) status = 'disabled';
  }
  const evidence = {
    migration: id, status,
    markers_present: Number(row?.markers_present || 0), markers_expected: Number(row?.markers_expected || 0),
    unsafe_table_grants: Number(row?.unsafe_table_grants || 0), unsafe_function_grants: Number(row?.unsafe_function_grants || 0),
    missing_service_exec: Number(row?.missing_service_exec || 0), missing_service_select: Number(row?.missing_service_select || 0),
    rls_missing: Number(row?.rls_missing || 0),
  };
  console.log(`STATE ${JSON.stringify(evidence)}`);
  return evidence;
}

export async function preflight(execSql, id) {
  getSpec(id);
  const [dependencies] = await execSql(buildPrerequisitesSql(id));
  if (Number(dependencies?.missing_prerequisites) !== 0) throw new Error(`Preflight ${id} falló: faltan prerrequisitos; abortando fail-closed.`);
  const current = await readState(execSql, id);
  if (current.status === 'partial' || current.status === 'drift') throw new Error(`Preflight ${id} detectó estado ${current.status}; no se aplicará SQL.`);
  return current;
}

export async function verify(execSql, id) {
  const current = await readState(execSql, id);
  if (current.status !== 'applied') throw new Error(`Verificación ${id} falló: estado ${current.status}, se esperaba applied.`);
  console.log(`VERIFY_OK ${id}`);
  return current;
}

export async function apply(execSql, id) {
  const spec = getSpec(id);
  const migrationSql = readFileSync(resolve(root, 'supabase/migrations', spec.migrationFile), 'utf8');
  try {
    await execSql(buildAtomicApplySql(id, migrationSql));
  } catch (error) {
    if (!String(error?.message || '').includes(`AGT002_ALREADY_APPLIED_${id}`)) throw error;
    const current = await verify(execSql, id);
    console.log(`APPLY_SKIPPED_ALREADY_READY ${id}`);
    return { ...current, skipped: true };
  }
  const result = await verify(execSql, id);
  console.log(`APPLY_OK ${id}`);
  return result;
}

export async function rollback(execSql, id) {
  const spec = getSpec(id);
  const rollbackSql = readFileSync(resolve(root, 'supabase/rollbacks', spec.rollbackFile), 'utf8');
  try {
    await execSql(buildAtomicRollbackSql(id, rollbackSql));
  } catch (error) {
    if (!String(error?.message || '').includes(`AGT002_ALREADY_ROLLED_BACK_${id}`)) throw error;
    const current = await readState(execSql, id);
    if (current.status !== 'absent' && current.status !== 'disabled') throw error;
    console.log(`ROLLBACK_SKIPPED_ALREADY_READY ${id}`);
    return { migration: id, ok: true, skipped: true, status: current.status, policy: spec.rollbackPolicy };
  }
  const [verified] = await execSql(buildRollbackVerifySql(id));
  if (verified?.ok !== true) throw new Error(`Rollback ${id} no coincidió con el estado esperado; detener secuencia.`);
  console.log(`ROLLBACK_OK ${id}`);
  return { migration: id, ok: true, policy: spec.rollbackPolicy };
}

export function stripTopLevelTransactionWrapper(sql) {
  const lines = sql.split(/\r?\n/);
  const beginLines = [];
  const commitLines = [];
  lines.forEach((line, i) => {
    if (/^begin\s*;$/i.test(line.trim())) beginLines.push(i);
    if (/^commit\s*;$/i.test(line.trim())) commitLines.push(i);
  });
  if (beginLines.length === 0 && commitLines.length === 0) return sql;
  let first = 0;
  while (first < lines.length && /^\s*(--.*)?$/.test(lines[first])) first++;
  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === '') last--;
  if (beginLines.length !== 1 || commitLines.length !== 1 || beginLines[0] !== first || commitLines[0] !== last || commitLines[0] <= beginLines[0]) {
    throw new Error('exec_sql normalization: wrapper transaccional top-level inesperado; abortando fail-closed.');
  }
  return [...lines.slice(0, beginLines[0]), ...lines.slice(beginLines[0] + 1, commitLines[0]), ...lines.slice(commitLines[0] + 1)].join('\n').trim();
}

function loadEnvFile(path) {
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const at = line.indexOf('=');
    process.env[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '');
  }
}

export function createExecSql({ fetchImpl = fetch, envPath, baseUrl, serviceKey } = {}) {
  let base = baseUrl;
  let key = serviceKey;
  if (!base || !key) {
    loadEnvFile(envPath || process.env.ENV_FILE || resolve(root, '.env.local'));
    base ||= process.env.NEXT_PUBLIC_SUPABASE_URL;
    key ||= process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
  if (!base || !key) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
  const endpoint = `${base.replace(/\/$/, '')}/rest/v1/rpc/exec_sql`;
  return async sql => {
    const normalized = stripTopLevelTransactionWrapper(sql.trim()).trim().replace(/;\s*$/, '');
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: normalized }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) {
      const marker = String(payload?.error || '').match(/AGT002_[A-Z0-9_]+/)?.[0];
      const error = new Error(marker || `exec_sql rechazó la operación (HTTP ${response.status}).`);
      error.sqlstate = typeof payload?.sqlstate === 'string' ? payload.sqlstate : undefined;
      throw error;
    }
    if (payload.rows === null) return [];
    if (!Array.isArray(payload.rows)) throw new Error('exec_sql devolvió una respuesta inválida; abortando fail-closed.');
    return payload.rows;
  };
}

async function main() {
  const mode = process.argv[2] || 'state';
  const id = process.argv[3];
  getSpec(id);
  const execSql = createExecSql();
  if (mode === 'state') await readState(execSql, id);
  else if (mode === 'preflight') await preflight(execSql, id);
  else if (mode === 'verify') await verify(execSql, id);
  else if (mode === 'apply') await apply(execSql, id);
  else if (mode === 'rollback') await rollback(execSql, id);
  else throw new Error('Modo inválido; use state, preflight, verify, apply o rollback.');
}

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href;
if (isMain) {
  main().catch(error => {
    if (!process.exitCode) process.exitCode = 1;
    console.error(`RUNNER_FAILED ${error.sqlstate || ''} ${error.message}`.trim());
  });
}
