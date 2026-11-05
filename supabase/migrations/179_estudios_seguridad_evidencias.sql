-- Estudios de Seguridad Física, tramo 2: fotos y evidencias de la visita (Juan, 2026-11-05).
--
-- En los Excel cada ficha de riesgo tenía un recuadro "FOTO DE EVIDENCIA": en HADA International, 25 fotos pegadas
-- dentro del libro (18 MB); en Cancha Horizontes, vacío. Aquí la foto es un archivo propio, amarrado al estudio y,
-- si aplica, a la zona o al riesgo que muestra, con su huella (sha256) calculada por el servidor al recibirla.
--
-- Dónde viven los archivos: en un depósito privado de Supabase Storage mientras el estudio se trabaja. El paquete
-- final (informe, matriz y evidencias de la versión aprobada) se archiva en SharePoint en el tramo 4; este depósito
-- no lo sustituye. El navegador sube con un permiso firmado de un solo uso que da el servidor, y sólo ve las fotos
-- con enlaces firmados de vida corta. Como el resto del módulo, la tabla sólo la toca `service_role`.
begin;

create table if not exists public.psi_security_study_evidence (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.psi_security_studies(id) on delete cascade,
  -- A qué se refiere: al estudio en general, a una zona o a un riesgo. No a ambos a la vez.
  zone_id uuid references public.psi_security_study_zones(id) on delete set null,
  risk_id uuid references public.psi_security_study_risks(id) on delete set null,
  constraint psi_security_study_evidence_one_target check (zone_id is null or risk_id is null),
  kind text not null check (kind in ('foto', 'documento')),
  storage_path text not null unique check (length(storage_path) between 10 and 400),
  file_name text not null check (length(btrim(file_name)) between 1 and 200),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 15728640),
  -- Huella del archivo tal como quedó guardado; la calcula el servidor al confirmar la subida.
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  caption text check (caption is null or length(btrim(caption)) <= 500),
  taken_on date,
  uploaded_by uuid not null references public.psi_sales_profiles(id),
  created_at timestamptz not null default now()
);
comment on table public.psi_security_study_evidence is 'Fotos y documentos de la visita de un estudio de seguridad; el archivo está en el depósito security-study-evidence. Ver migración 179.';

create index if not exists psi_security_study_evidence_study_idx on public.psi_security_study_evidence(study_id);
create index if not exists psi_security_study_evidence_risk_idx on public.psi_security_study_evidence(risk_id);

alter table public.psi_security_study_evidence enable row level security;
revoke all on public.psi_security_study_evidence from public, anon, authenticated;
grant select, insert, update, delete on public.psi_security_study_evidence to service_role;

do $storage_bucket$
begin
  if to_regclass('storage.buckets') is not null then
    execute $sql$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values (
        'security-study-evidence',
        'security-study-evidence',
        false,
        15728640,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']::text[]
      )
      on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types
    $sql$;
  end if;
end
$storage_bucket$;

commit;
