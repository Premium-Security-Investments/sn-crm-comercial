-- Estudios de Seguridad Física: carta de recomendación al cliente (Juan, 2026-11-12: "Si").
--
-- Héctor Martínez (reunión del 2026-11-11): si el cliente no aplica lo que se le recomendó, "una carta de recomendación
-- automática … oiga cliente, yo le hablé desde el mes de diciembre de la malla", con la evidencia; "eso nos blinda". El
-- SIIO arma la carta con las recomendaciones a cargo del cliente que siguen pendientes y lo que registró SecurityOps
-- después de aprobar; el servidor de tareas la convierte en PDF con el membrete y la sube a SharePoint junto al estudio.
-- La carta NO se envía sola: una persona la manda y registra el envío (fecha, a quién, cómo).
begin;

create table if not exists public.psi_security_study_letters (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.psi_security_studies(id) on delete cascade,
  version integer not null check (version > 0),
  recipient text not null check (length(btrim(recipient)) between 2 and 300),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 60),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  status text not null default 'pendiente' check (status in ('pendiente', 'procesando', 'lista', 'fallida', 'enviada')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  started_at timestamptz,
  file_url text check (file_url is null or file_url ~ '^https://'),
  folder_path text,
  error text check (error is null or length(error) <= 300),
  requested_by uuid not null references public.psi_sales_profiles(id),
  requested_at timestamptz not null default now(),
  sent_on date,
  sent_to text check (sent_to is null or length(btrim(sent_to)) between 2 and 300),
  sent_medium text check (sent_medium is null or sent_medium in ('correo', 'fisico', 'reunion')),
  sent_by uuid references public.psi_sales_profiles(id),
  sent_recorded_at timestamptz,
  constraint psi_security_study_letters_sent_consistency check ((status = 'enviada') = (sent_on is not null and sent_to is not null and sent_medium is not null))
);
create index if not exists psi_security_study_letters_queue_idx on public.psi_security_study_letters (status, requested_at);
create index if not exists psi_security_study_letters_study_idx on public.psi_security_study_letters (study_id, requested_at desc);

alter table public.psi_security_study_letters enable row level security;
revoke all on public.psi_security_study_letters from public, anon, authenticated;
grant select, insert, update, delete on public.psi_security_study_letters to service_role;

commit;
