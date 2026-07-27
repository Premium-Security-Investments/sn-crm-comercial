begin;

create table if not exists public.psi_tender_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  pipeline_version text not null check (length(btrim(pipeline_version)) > 0),
  idempotency_key text not null unique check (length(btrim(idempotency_key)) > 0),
  status text not null check (status in (
    'queued','discovering_documents','importing_documents','retry_wait','needs_attention',
    'ready_for_snapshot','snapshot_ready','awaiting_analysis_authorization','waiting_agent_capacity',
    'analyzing','completed','cancelled')),
  current_step text not null check (length(btrim(current_step)) > 0),
  requested_by uuid not null references public.psi_sales_profiles(id) on delete restrict,
  analysis_authorized_by uuid references public.psi_sales_profiles(id) on delete restrict,
  analysis_authorized_at timestamptz,
  lease_id uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  documents_discovered integer not null default 0 check (documents_discovered >= 0),
  documents_processed integer not null default 0 check (documents_processed >= 0),
  documents_imported integer not null default 0 check (documents_imported >= 0),
  documents_unchanged integer not null default 0 check (documents_unchanged >= 0),
  documents_failed integer not null default 0 check (documents_failed >= 0),
  snapshot_id uuid references public.psi_tender_document_snapshots(id) on delete restrict,
  analysis_run_id uuid references public.psi_tender_analysis_runs(id) on delete restrict,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint psi_tender_processing_jobs_lease_all_or_none check (
    (lease_id is null and lease_expires_at is null) or (lease_id is not null and lease_expires_at is not null)),
  constraint psi_tender_processing_jobs_auth_all_or_none check (
    (analysis_authorized_by is null and analysis_authorized_at is null) or
    (analysis_authorized_by is not null and analysis_authorized_at is not null))
);

create unique index if not exists psi_tender_processing_jobs_one_active
  on public.psi_tender_processing_jobs (opportunity_id)
  where status not in ('completed','cancelled');
create index if not exists psi_tender_processing_jobs_claimable_idx
  on public.psi_tender_processing_jobs (status, next_attempt_at, lease_expires_at);

create table if not exists public.psi_tender_document_import_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.psi_tender_processing_jobs(id) on delete cascade,
  tender_id uuid not null references public.psi_public_tenders(id) on delete restrict,
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete restrict,
  source text not null check (length(btrim(source)) > 0),
  source_document_id text not null check (length(btrim(source_document_id)) > 0),
  source_url text,
  name text not null check (length(btrim(name)) > 0),
  status text not null default 'pending' check (status in (
    'pending','processing','imported','unchanged','failed_retryable','failed_terminal')),
  critical boolean not null default false,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  lease_id uuid,
  lease_expires_at timestamptz,
  document_version_id uuid references public.psi_tender_document_versions(id) on delete restrict,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint psi_tender_document_import_items_identity unique (job_id, source, source_document_id),
  constraint psi_tender_document_import_items_lease_all_or_none check (
    (lease_id is null and lease_expires_at is null) or (lease_id is not null and lease_expires_at is not null))
);
create index if not exists psi_tender_document_import_items_job_status_idx
  on public.psi_tender_document_import_items (job_id, status, next_attempt_at);

alter table public.psi_tender_processing_jobs enable row level security;
alter table public.psi_tender_document_import_items enable row level security;
revoke all on public.psi_tender_processing_jobs from public, authenticated, anon;
revoke all on public.psi_tender_document_import_items from public, authenticated, anon;
grant select on public.psi_tender_processing_jobs to service_role;
grant select on public.psi_tender_document_import_items to service_role;

commit;
