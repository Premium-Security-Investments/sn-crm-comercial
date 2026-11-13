-- 218 — «Requisitos»: los procesos que vienen primero y los bloqueos que una persona deja anotados (Juan, 2026-11-13:
-- «busquemos una forma de mostrar en la tarjeta los procesos futuros que nos bloquea ese requisito», «vamos adelante
-- con este plan»).
--
-- 1. Grupos nuevos de «lo que nos inhabilita»: experiencia que no podemos acreditar, personal acreditado, armas y
--    salvoconductos, y Red de Apoyo de la Policía. Las claves son las de REQUIREMENT_FOCUS en
--    verticales/licitaciones/requirement-catalog.js.
-- 2. Bloqueos anotados: lo que una persona (o el agente, al revisar el pliego) encuentra que nos inhabilita en un proceso
--    entra a la pestaña aunque el análisis de Vig-IA no lo haya marcado. Cada uno con su motivo y la cita del pliego. Se
--    retira marcándolo como resuelto, no se borra.
begin;

alter table public.psi_tender_requirement_focus drop constraint if exists psi_tender_requirement_focus_focus_key_check;
alter table public.psi_tender_requirement_focus add constraint psi_tender_requirement_focus_focus_key_check
  check (focus_key in ('presencia', 'codigos', 'comunicaciones', 'importador', 'canino', 'financiero', 'certificaciones', 'horas_extras',
    'experiencia', 'personal', 'armas', 'red_apoyo'));

insert into public.psi_tender_requirement_focus (focus_key, owner) values
  ('experiencia', 'Katherine'), ('personal', 'Katherine'), ('armas', 'Katherine'), ('red_apoyo', 'Katherine')
on conflict (focus_key) do nothing;

create table if not exists public.psi_tender_requirement_blocks (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.psi_sales_opportunities(id) on delete cascade,
  focus_key text not null check (focus_key in ('presencia', 'codigos', 'comunicaciones', 'importador', 'canino', 'financiero', 'certificaciones',
    'horas_extras', 'experiencia', 'personal', 'armas', 'red_apoyo')),
  reason text not null check (char_length(reason) between 5 and 500),
  citation text check (citation is null or char_length(citation) <= 500),
  source text not null check (source in ('revision', 'mesa')),
  created_by uuid references public.psi_sales_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_note text check (resolved_note is null or char_length(resolved_note) <= 500)
);
create index if not exists psi_tender_requirement_blocks_open_idx on public.psi_tender_requirement_blocks (focus_key) where resolved_at is null;
-- Un mismo bloqueo no se anota dos veces mientras siga abierto.
create unique index if not exists psi_tender_requirement_blocks_unique_open on public.psi_tender_requirement_blocks (opportunity_id, focus_key, reason)
  where resolved_at is null;
alter table public.psi_tender_requirement_blocks enable row level security;
revoke all on table public.psi_tender_requirement_blocks from public, anon, authenticated, service_role;
grant select, insert, update on table public.psi_tender_requirement_blocks to service_role;

commit;
