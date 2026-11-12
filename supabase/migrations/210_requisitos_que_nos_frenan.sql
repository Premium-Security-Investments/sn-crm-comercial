-- 210 — Pestaña «Requisitos» (Juan, 2026-11-11: «vamos así y luego vemos detalles»).
--
-- El catálogo histórico de requisitos se arma en el servidor (matriz histórica + análisis del CRM + actas de cierre) y
-- no necesita tabla. Lo único que se guarda es el trabajo sobre «lo que nos frena»: los 7 requisitos que más veces
-- impidieron presentarse, cada uno con responsable, estado, nota, cómo estamos y qué lo resuelve. Lo lleva Katherine
-- (decisión de Juan del 2026-11-11). Las claves son las de REQUIREMENT_FOCUS en verticales/licitaciones/requirement-catalog.js.
begin;

create table if not exists public.psi_tender_requirement_focus (
  focus_key text primary key check (focus_key in ('presencia', 'financiero', 'codigos', 'seriedad', 'certificados', 'licencias_especiales', 'personal_local')),
  status text not null default 'pendiente' check (status in ('pendiente', 'en_tramite', 'resuelto')),
  owner text check (owner is null or char_length(owner) <= 120),
  note text check (note is null or char_length(note) <= 1000),
  current_state text check (current_state is null or char_length(current_state) <= 1000),
  fix_action text check (fix_action is null or char_length(fix_action) <= 1000),
  updated_by uuid references public.psi_sales_profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.psi_tender_requirement_focus enable row level security;
revoke all on table public.psi_tender_requirement_focus from public, anon, authenticated, service_role;
grant select, insert, update on table public.psi_tender_requirement_focus to service_role;

-- Punto de partida. Presencia, indicadores y códigos se leen en vivo de la ficha; para los otros cuatro, lo que consta
-- en las actas de cierre y los análisis al 2026-11-11. No pisa lo que una persona ya haya escrito.
insert into public.psi_tender_requirement_focus (focus_key, owner, current_state) values
  ('presencia', 'Katherine', null),
  ('financiero', 'Katherine', null),
  ('codigos', 'Katherine', null),
  ('seriedad', 'Katherine', 'La ficha no registra un cupo con aseguradora para garantías de seriedad. En Fiscalía Nivel Central, Municipio de Pereira y Supersalud no constaba la garantía.'),
  ('certificados', 'Katherine', 'En Municipio de Pereira (octubre de 2026) el certificado de sanciones de la Supervigilancia era del 18-jun-2026, con más de 90 días, y las consultas de antecedentes habían vencido el 29-ago-2026. En Fiscalía Nivel Central el listado de armas estaba fuera de plazo.'),
  ('licencias_especiales', 'Katherine', 'Terminal de Transporte: el permiso de comunicaciones no cubre Bogotá. ESU: la empresa no tiene el registro de comercializador de equipos tecnológicos.'),
  ('personal_local', 'Katherine', 'La ficha no trae un banco de hojas de vida por cargo y ciudad. En Cali (1.665 guardas), Municipio de Pereira (316 guardas) y Fiscalía Nivel Central (coordinadores con 8 años) no se pudo verificar la planta exigida.')
on conflict (focus_key) do nothing;

commit;
