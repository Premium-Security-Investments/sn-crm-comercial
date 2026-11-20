-- AGT-001 «Pregúntele a Vig-IA» como conversación (Juan, 2026-11-20, opción A): las preguntas se agrupan en
-- conversaciones; una conversación nueva empieza sólo cuando el directivo presiona «Nueva conversación», y la lista se
-- muestra por día. Vig-IA retoma la misma sesión de Claude (claude_session_id) para recordar todo lo anterior.
-- `progress` guarda lo que Vig-IA va haciendo mientras contesta («Leyendo Avancys · Contratos»).
-- Mismo régimen de la 229: RLS activo, sin políticas, sólo el servidor (service_role) lee y escribe.

create table if not exists public.siio_vigia_conversaciones (
  id uuid primary key default gen_random_uuid(),
  asked_by uuid not null references public.psi_sales_profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  claude_session_id uuid,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index if not exists siio_vigia_conversaciones_por_persona on public.siio_vigia_conversaciones (asked_by, last_message_at desc);

alter table public.siio_vigia_preguntas add column if not exists conversation_id uuid references public.siio_vigia_conversaciones(id) on delete cascade;
alter table public.siio_vigia_preguntas add column if not exists progress jsonb;
create index if not exists siio_vigia_preguntas_por_conversacion on public.siio_vigia_preguntas (conversation_id, requested_at);

-- Las preguntas de antes: cada cadena de seguimientos (parent_id) queda como una conversación, con el título de su
-- primera pregunta. Sin sesión de Claude: la primera respuesta nueva arranca una y recibe el historial escrito.
insert into public.siio_vigia_conversaciones (id, asked_by, title, created_at, last_message_at)
select r.id, r.asked_by, left(r.question, 160), r.requested_at, r.requested_at
from public.siio_vigia_preguntas r
where r.parent_id is null and r.conversation_id is null
on conflict (id) do nothing;

with recursive cadena as (
  select id, id as raiz from public.siio_vigia_preguntas where parent_id is null
  union all
  select p.id, c.raiz from public.siio_vigia_preguntas p join cadena c on p.parent_id = c.id
)
update public.siio_vigia_preguntas p set conversation_id = c.raiz
from cadena c
where c.id = p.id and p.conversation_id is null
  and exists (select 1 from public.siio_vigia_conversaciones v where v.id = c.raiz);

update public.siio_vigia_conversaciones v set last_message_at = u.ultima
from (select conversation_id, max(requested_at) as ultima from public.siio_vigia_preguntas where conversation_id is not null group by 1) u
where u.conversation_id = v.id and u.ultima > v.last_message_at;

alter table public.siio_vigia_conversaciones enable row level security;
revoke all on table public.siio_vigia_conversaciones from public, anon, authenticated, service_role;
grant select, insert, update on table public.siio_vigia_conversaciones to service_role;
