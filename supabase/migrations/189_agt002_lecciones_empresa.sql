-- 189 — Lecciones de la empresa (encargo AGT-002 del 2026-11-06, PR a de cinco).
--
-- Una lista corta de reglas que la empresa ya aprendió en un proceso («agencia no es sucursal», «la RCE vigente es de
-- 400 SMMLV»…) y que Vig-IA recibirá en cada análisis y en cada respuesta de la Mesa (PR b). Ninguna lección entra sin
-- que una persona la apruebe: las que proponen AGT-002 o Vig-IA quedan en `propuesta`.
--
-- Decisión de Juan Botero (2026-11-07): «Katherine y yo podemos aprobarlas». La custodia de Licitaciones la tiene también
-- otra persona, así que aprobar y retirar es un permiso propio, `licitaciones_lecciones`, que esta migración da sólo a
-- Juan Botero y a Katherine Valencia Buitrago. Proponer basta con el permiso `licitaciones`.
--
-- Append-only, igual que el expediente: cada cambio de estado es una versión nueva de la misma lección (mismo `code`,
-- `version` + 1). Nada se edita ni se borra; la vigente es la de versión más alta.
begin;

insert into public.psi_access_permissions (code, name, description, active)
values (
  'licitaciones_lecciones',
  'Aprobar lecciones de Licitaciones',
  'Aprobar y retirar las lecciones de la empresa que Vig-IA usa en cada análisis y en la Mesa.',
  true
)
on conflict (code) do update set name = excluded.name, description = excluded.description, active = true;

-- Sólo Juan y Katherine (decisión del 2026-11-07). Se busca por id y nombre a la vez: si alguno no coincide, no se da.
insert into public.psi_profile_permissions (profile_id, permission_code)
select p.id, 'licitaciones_lecciones'
from public.psi_sales_profiles p
where (p.id, p.full_name) in (
  ('60b26173-1226-476b-a958-cf2917661432'::uuid, 'Juan Botero'),
  ('8c172493-12aa-4be1-893a-2e5e93f7fba2'::uuid, 'Katherine Valencia Buitrago')
)
on conflict do nothing;

create or replace function public.psi_profile_can_approve_tender_lessons(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.psi_sales_profiles p
    where p.id = p_profile_id and p.active = true and coalesce(p.identity_type, 'human') = 'human'
      and exists (select 1 from public.psi_profile_permissions pp join public.psi_access_permissions ap on ap.code = pp.permission_code and ap.active
                  where pp.profile_id = p.id and pp.permission_code = 'licitaciones')
      and exists (select 1 from public.psi_profile_permissions pp join public.psi_access_permissions ap on ap.code = pp.permission_code and ap.active
                  where pp.profile_id = p.id and pp.permission_code = 'licitaciones_lecciones')
  );
$$;
revoke all on function public.psi_profile_can_approve_tender_lessons(uuid) from public, anon, authenticated;
grant execute on function public.psi_profile_can_approve_tender_lessons(uuid) to service_role;

create table if not exists public.psi_tender_lessons (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^L-[0-9]{2,4}$'),
  version integer not null check (version >= 1),
  status text not null check (status in ('propuesta', 'activa', 'retirada', 'descartada')),
  statement text not null check (nullif(btrim(statement), '') is not null and char_length(statement) <= 500),
  rationale text check (rationale is null or char_length(rationale) <= 1200),
  how_to_apply text check (how_to_apply is null or char_length(how_to_apply) <= 800),
  category text not null check (category in (
    'sede_agencia', 'financiero', 'precio', 'garantias_polizas', 'personal_habilitante', 'documentos_vigencias',
    'rup_unspsc', 'alianzas_ut', 'cronograma', 'licencias', 'competencia', 'estrategia', 'otro')),
  source_kind text not null check (source_kind in ('acta', 'proceso', 'handoff', 'carga_inicial')),
  source_ref text check (source_ref is null or char_length(source_ref) <= 400),
  opportunity_id uuid references public.psi_sales_opportunities(id) on delete set null,
  proposed_by_model boolean not null default false,
  actor_id uuid not null references public.psi_sales_profiles(id) on delete restrict,
  reason text check (reason is null or char_length(reason) <= 1000),
  created_at timestamptz not null default now(),
  unique (code, version),
  check (status <> 'retirada' or nullif(btrim(coalesce(reason, '')), '') is not null)
);
create index if not exists psi_tender_lessons_code on public.psi_tender_lessons (code, version desc);
alter table public.psi_tender_lessons enable row level security;
revoke all on table public.psi_tender_lessons from public, authenticated, anon, service_role;
grant select on table public.psi_tender_lessons to service_role;

create or replace function public.psi_tender_lessons_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'Las lecciones no se editan ni se borran: cada cambio es una versión nueva.' using errcode = '42501';
end;
$$;
drop trigger if exists psi_tender_lessons_append_only on public.psi_tender_lessons;
create trigger psi_tender_lessons_append_only before update or delete on public.psi_tender_lessons
  for each row execute function public.psi_tender_lessons_append_only();

-- La versión vigente de cada lección, con quién la propuso y quién la dejó en su estado actual.
create or replace view public.psi_tender_lessons_current with (security_invoker = true) as
select cur.*, first.actor_id as proposed_by, first.created_at as proposed_at
from (select distinct on (code) * from public.psi_tender_lessons order by code, version desc) cur
join public.psi_tender_lessons first on first.code = cur.code and first.version = 1;
revoke all on table public.psi_tender_lessons_current from public, authenticated, anon, service_role;
grant select on table public.psi_tender_lessons_current to service_role;

-- Proponer: quien opera Licitaciones (persona). Si la redactó Vig-IA, p_proposed_by_model = true y el actor es la
-- persona en cuyo nombre corre (p. ej. quien confirmó el acta).
create or replace function public.psi_propose_tender_lesson(p_actor_id uuid, p_payload jsonb, p_proposed_by_model boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_next integer; v_row public.psi_tender_lessons%rowtype;
begin
  if not exists (
    select 1 from public.psi_sales_profiles p
    join public.psi_profile_permissions pp on pp.profile_id = p.id and pp.permission_code = 'licitaciones'
    join public.psi_access_permissions ap on ap.code = pp.permission_code and ap.active
    where p.id = p_actor_id and p.active and coalesce(p.identity_type, 'human') = 'human'
  ) then
    raise exception 'Proponer una lección requiere el permiso de Licitaciones.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'La lección debe ser un objeto.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('psi_tender_lessons:code'));
  select coalesce(max(substring(code from 3)::integer), 0) + 1 into v_next from public.psi_tender_lessons;
  insert into public.psi_tender_lessons (code, version, status, statement, rationale, how_to_apply, category, source_kind,
    source_ref, opportunity_id, proposed_by_model, actor_id)
  values ('L-' || lpad(v_next::text, 2, '0'), 1, 'propuesta', btrim(p_payload ->> 'statement'),
    nullif(btrim(coalesce(p_payload ->> 'rationale', '')), ''), nullif(btrim(coalesce(p_payload ->> 'how_to_apply', '')), ''),
    coalesce(nullif(p_payload ->> 'category', ''), 'otro'), coalesce(nullif(p_payload ->> 'source_kind', ''), 'proceso'),
    nullif(btrim(coalesce(p_payload ->> 'source_ref', '')), ''), nullif(p_payload ->> 'opportunity_id', '')::uuid,
    coalesce(p_proposed_by_model, false), p_actor_id)
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.psi_propose_tender_lesson(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.psi_propose_tender_lesson(uuid, jsonb, boolean) to service_role;

-- Aprobar, descartar (una propuesta) o retirar (una activa, con motivo): versión nueva con el mismo contenido. p_expected_version evita aprobar sobre algo que cambió
-- mientras la pantalla estaba abierta.
create or replace function public.psi_decide_tender_lesson(p_actor_id uuid, p_code text, p_expected_version integer, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cur public.psi_tender_lessons%rowtype; v_row public.psi_tender_lessons%rowtype;
begin
  if not public.psi_profile_can_approve_tender_lessons(p_actor_id) then
    raise exception 'Aprobar, descartar o retirar lecciones requiere el permiso «Aprobar lecciones de Licitaciones».' using errcode = '42501';
  end if;
  if p_status not in ('activa', 'retirada', 'descartada') then
    raise exception 'Sólo se puede aprobar, descartar o retirar una lección.' using errcode = '22023';
  end if;
  if p_status = 'retirada' and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Retirar una lección pide el motivo.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('psi_tender_lessons:' || coalesce(p_code, '')));
  select * into v_cur from public.psi_tender_lessons where code = p_code order by version desc limit 1;
  if not found then
    raise exception 'La lección % no existe.', p_code using errcode = 'P0002';
  end if;
  if v_cur.version <> p_expected_version then
    raise exception 'La lección % cambió mientras la revisaba; recargue la pantalla.', p_code using errcode = '23514';
  end if;
  if v_cur.status in ('retirada', 'descartada') or (p_status = 'activa' and v_cur.status = 'activa') then
    raise exception 'La lección % ya está %.', p_code, v_cur.status using errcode = '23514';
  end if;
  if p_status = 'descartada' and v_cur.status <> 'propuesta' then
    raise exception 'Sólo se descarta una propuesta; una lección activa se retira con motivo.' using errcode = '23514';
  end if;
  if p_status = 'retirada' and v_cur.status <> 'activa' then
    raise exception 'Sólo se retira una lección activa; una propuesta se descarta.' using errcode = '23514';
  end if;
  insert into public.psi_tender_lessons (code, version, status, statement, rationale, how_to_apply, category, source_kind,
    source_ref, opportunity_id, proposed_by_model, actor_id, reason)
  values (v_cur.code, v_cur.version + 1, p_status, v_cur.statement, v_cur.rationale, v_cur.how_to_apply, v_cur.category,
    v_cur.source_kind, v_cur.source_ref, v_cur.opportunity_id, v_cur.proposed_by_model, p_actor_id,
    nullif(btrim(coalesce(p_reason, '')), ''))
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.psi_decide_tender_lesson(uuid, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.psi_decide_tender_lesson(uuid, text, integer, text, text) to service_role;

commit;
