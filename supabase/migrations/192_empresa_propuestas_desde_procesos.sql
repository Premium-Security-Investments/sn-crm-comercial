-- 192 — F14: lo que se verifica en un proceso llega a la ficha de la empresa (auditoría del piloto Fiscalía).
--
-- Caso: la RCE de 400 SMMLV se verificó el 30-oct en Supersalud y quedó sólo en ese expediente; en Fiscalía, que pide
-- 500, el análisis dijo «sin monto en el perfil». Política de Juan (2026-11-07): todo dato de la empresa debe estar en la
-- ficha. Decisión de Juan (2026-11-08, opción A): cuando se sube un documento propio al expediente de una licitación,
-- Vig-IA lo lee, lo compara con la ficha y PROPONE lo nuevo o distinto. Aparece en Empresa con Confirmar y Descartar.
--
-- Vig-IA nunca escribe la ficha: propone. Confirmar lo aplica una persona con custodia, como versión nueva del bloque
-- del registro de evidencia (el registro ya versiona por `entry_id`, con una sola fila vigente). Todo append-only.
begin;

create table if not exists public.psi_company_fact_proposals (
  id uuid primary key default gen_random_uuid(),
  entry_id text not null check (entry_id ~ '^[a-z][a-z0-9_]*$'),
  summary text not null check (nullif(btrim(summary), '') is not null and char_length(summary) <= 500),
  proposed_vigencia_text text not null check (nullif(btrim(proposed_vigencia_text), '') is not null and char_length(proposed_vigencia_text) <= 1000),
  proposed_expiry date,
  current_vigencia_text text,
  current_expiry date,
  why text check (why is null or char_length(why) <= 1000),
  opportunity_id uuid references public.psi_sales_opportunities(id) on delete set null,
  source_document_version_id uuid,
  source_file_name text check (source_file_name is null or char_length(source_file_name) <= 300),
  source_label text check (source_label is null or char_length(source_label) <= 300),
  proposed_by_model boolean not null default true,
  actor_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists psi_company_fact_proposals_entry on public.psi_company_fact_proposals (entry_id, created_at desc);

create table if not exists public.psi_company_fact_proposal_decisions (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null unique references public.psi_company_fact_proposals(id) on delete restrict,
  decision text not null check (decision in ('confirmada', 'descartada')),
  registry_version integer,
  actor_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create or replace function public.psi_company_fact_proposals_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'Las propuestas a la ficha no se editan ni se borran.' using errcode = '42501';
end;
$$;
do $$
declare v_table text;
begin
  foreach v_table in array array['psi_company_fact_proposals', 'psi_company_fact_proposal_decisions'] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', v_table);
    execute format('grant select on table public.%I to service_role', v_table);
    execute format('drop trigger if exists %I on public.%I', v_table || '_append_only', v_table);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.psi_company_fact_proposals_append_only()', v_table || '_append_only', v_table);
  end loop;
end;
$$;

-- Propone (lo llama el servidor después de que Vig-IA leyó el documento). El actor es quien subió el documento.
create or replace function public.psi_propose_company_fact(p_actor_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cur public.psi_agt002_company_evidence_registry%rowtype; v_row public.psi_company_fact_proposals%rowtype;
begin
  if not exists (
    select 1 from public.psi_sales_profiles p
    join public.psi_profile_permissions pp on pp.profile_id = p.id and pp.permission_code = 'licitaciones'
    join public.psi_access_permissions ap on ap.code = pp.permission_code and ap.active
    where p.id = p_actor_id and p.active and coalesce(p.identity_type, 'human') = 'human'
  ) then
    raise exception 'Proponer un dato a la ficha requiere el permiso de Licitaciones.' using errcode = '42501';
  end if;
  select * into v_cur from public.psi_agt002_company_evidence_registry where entry_id = p_payload ->> 'entry_id' and current;
  if not found then raise exception 'Ese bloque de la ficha no existe.' using errcode = 'P0002'; end if;
  insert into public.psi_company_fact_proposals (entry_id, summary, proposed_vigencia_text, proposed_expiry, current_vigencia_text,
    current_expiry, why, opportunity_id, source_document_version_id, source_file_name, source_label, proposed_by_model, actor_id)
  values (v_cur.entry_id, btrim(p_payload ->> 'summary'), btrim(p_payload ->> 'proposed_vigencia_text'),
    nullif(p_payload ->> 'proposed_expiry', '')::date, v_cur.vigencia_text, v_cur.expiry, nullif(btrim(coalesce(p_payload ->> 'why', '')), ''),
    nullif(p_payload ->> 'opportunity_id', '')::uuid, nullif(p_payload ->> 'source_document_version_id', '')::uuid,
    nullif(btrim(coalesce(p_payload ->> 'source_file_name', '')), ''), nullif(btrim(coalesce(p_payload ->> 'source_label', '')), ''),
    coalesce((p_payload ->> 'proposed_by_model')::boolean, true), p_actor_id)
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.psi_propose_company_fact(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.psi_propose_company_fact(uuid, jsonb) to service_role;

-- Confirmar o descartar. Confirmar crea la versión siguiente del bloque con el texto y la fecha propuestos, marcada como
-- verificada y aprobada por quien confirma; si el bloque cambió desde que se propuso, se rechaza (hay que mirar de nuevo).
create or replace function public.psi_decide_company_fact(p_actor_id uuid, p_proposal_id uuid, p_decision text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_p public.psi_company_fact_proposals%rowtype; v_cur public.psi_agt002_company_evidence_registry%rowtype;
  v_new public.psi_agt002_company_evidence_registry%rowtype; v_name text; v_version integer;
begin
  if not public.psi_profile_has_tender_custody(p_actor_id) then
    raise exception 'Confirmar datos de la ficha requiere la custodia de Licitaciones.' using errcode = '42501';
  end if;
  if p_decision not in ('confirmada', 'descartada') then raise exception 'La decisión no es válida.' using errcode = '22023'; end if;
  select * into v_p from public.psi_company_fact_proposals where id = p_proposal_id for update;
  if not found then raise exception 'La propuesta no existe.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.psi_company_fact_proposal_decisions where proposal_id = p_proposal_id) then
    raise exception 'Esta propuesta ya se decidió.' using errcode = '23505';
  end if;
  if p_decision = 'confirmada' then
    perform pg_advisory_xact_lock(hashtext('psi_agt002_company_evidence_registry:' || v_p.entry_id));
    select * into v_cur from public.psi_agt002_company_evidence_registry where entry_id = v_p.entry_id and current for update;
    if not found then raise exception 'Ese bloque de la ficha ya no existe.' using errcode = 'P0002'; end if;
    if v_cur.vigencia_text is distinct from v_p.current_vigencia_text or v_cur.expiry is distinct from v_p.current_expiry then
      raise exception 'La ficha cambió desde que Vig-IA hizo esta propuesta; descártela y vuelva a subir el documento.' using errcode = '23514';
    end if;
    select full_name into v_name from public.psi_sales_profiles where id = p_actor_id;
    update public.psi_agt002_company_evidence_registry set current = false where id = v_cur.id;
    v_new := v_cur;
    v_new.id := gen_random_uuid();
    v_new.version := v_cur.version + 1;
    v_new.current := true;
    v_new.vigencia_text := v_p.proposed_vigencia_text;
    v_new.expiry := coalesce(v_p.proposed_expiry, v_cur.expiry);
    v_new.existence_status := 'verified';
    v_new.human_review_status := 'approved';
    v_new.decision_humana := left('Confirmado por ' || coalesce(v_name, 'una persona del equipo') || ': ' || v_p.summary
      || coalesce(' (verificado en ' || v_p.source_label || ')', ''), 500);
    v_new.decision_humana_fecha := (now() at time zone 'America/Bogota')::date;
    v_new.decision_humana_por := p_actor_id;
    v_new.source_reference := left(coalesce('Propuesta de Vig-IA desde ' || v_p.source_label || coalesce(': ' || v_p.source_file_name, ''), v_cur.source_reference), 1000);
    v_new.created_by := p_actor_id;
    v_new.created_at := now();
    v_new.updated_at := now();
    insert into public.psi_agt002_company_evidence_registry select v_new.*;
    v_version := v_new.version;
  end if;
  insert into public.psi_company_fact_proposal_decisions (proposal_id, decision, registry_version, actor_id)
  values (p_proposal_id, p_decision, v_version, p_actor_id);
  return jsonb_build_object('proposal_id', p_proposal_id, 'decision', p_decision, 'registry_version', v_version);
end;
$$;
revoke all on function public.psi_decide_company_fact(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.psi_decide_company_fact(uuid, uuid, text) to service_role;

commit;
