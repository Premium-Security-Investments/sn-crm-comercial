-- Catálogo de fuentes · entrega 1 (Juan, 2026-10-23): tipar los códigos UNSPSC del RUP.
--
-- Hoy viven como prosa dentro de psi_company_procurement_profile.rup_unspsc_codes: 1.219
-- caracteres de los que el código rescata los 14 códigos con una expresión regular que acierta
-- por deduplicación, no por contrato. La Mesa necesita responder "¿me falta el 46101500?" sin
-- interpretar un párrafo, así que el destilado se vuelve tabla.
--
-- Regla del destilado: queda amarrado a la versión del documento que lo produjo. Por eso cada
-- fila lleva `inscrito_al` (fecha del certificado) y `contratos_base` (sobre cuántos contratos se
-- contó la frecuencia). Los conteos de la prosa se calcularon sobre 101 contratos; hoy la tabla
-- psi_company_experience tiene 103. Esa diferencia se conserva explícita en vez de corregirse a
-- ojo: recontar exige volver al certificado, no al destilado.
--
-- La prosa NO se borra: sigue siendo el respaldo legible y conserva las notas que no son datos
-- (qué códigos son tecnológicos, el límite duro de 14).
begin;

create table if not exists public.psi_company_rup_codes (
  codigo text primary key check (codigo ~ '^[0-9]{8}$'),
  descripcion text not null check (nullif(btrim(descripcion), '') is not null),
  contratos_con_el_codigo integer check (contratos_con_el_codigo is null or contratos_con_el_codigo >= 0),
  contratos_base integer check (contratos_base is null or contratos_base > 0),
  inscrito_al date not null,
  fuente text not null check (nullif(btrim(fuente), '') is not null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.psi_company_rup_codes is
  'Códigos UNSPSC inscritos en el RUP, tipados. Destilado del certificado de la Cámara de Comercio; la prosa de psi_company_procurement_profile.rup_unspsc_codes queda como respaldo.';
comment on column public.psi_company_rup_codes.contratos_base is
  'Total de contratos sobre el que se contó contratos_con_el_codigo. Si no coincide con el conteo actual de psi_company_experience, la frecuencia es de una base anterior y no debe compararse de frente.';

create index if not exists idx_psi_company_rup_codes_inscrito_al on public.psi_company_rup_codes(inscrito_al);

drop trigger if exists trg_psi_company_rup_codes_updated_at on public.psi_company_rup_codes;
create trigger trg_psi_company_rup_codes_updated_at before update on public.psi_company_rup_codes
for each row execute function public.psi_sales_set_updated_at();

alter table public.psi_company_rup_codes enable row level security;
revoke all on table public.psi_company_rup_codes from public, anon, authenticated, service_role;
grant select, insert, update on table public.psi_company_rup_codes to service_role;

insert into public.psi_company_rup_codes (codigo, descripcion, contratos_con_el_codigo, contratos_base, inscrito_al, fuente)
values
  ('32151800', 'Dispositivos de control de seguridad', 62, 101, '2026-09-28', 'Certificado RUP Cámara de Comercio de Pereira 28/09/2026'),
  ('43221700', 'Equipo fijo de red y componentes', 18, 101, '2026-09-28', 'Certificado RUP Cámara de Comercio de Pereira 28/09/2026'),
  ('43233200', 'Software de seguridad y protección', 46, 101, '2026-09-28', 'Certificado RUP Cámara de Comercio de Pereira 28/09/2026'),
  ('46151600', 'Equipo de seguridad y control', 66, 101, '2026-09-28', 'Certificado RUP Cámara de Comercio de Pereira 28/09/2026'),
  ('46171600', 'Equipo de vigilancia y detección', 66, 101, '2026-09-28', 'Certificado RUP Cámara de Comercio de Pereira 28/09/2026'),
  ('46182500', 'Armas o dispositivos de seguridad personal', 46, 101, '2026-09-28', 'Certificado RUP Cámara de Comercio de Pereira 28/09/2026'),
  ('46191500', 'Prevención contra incendios', 53, 101, '2026-09-28', 'Certificado RUP Cámara de Comercio de Pereira 28/09/2026'),
  ('72151700', 'Servicios de instalación de sistemas de seguridad física e industrial', 65, 101, '2026-09-28', 'Certificado RUP Cámara de Comercio de Pereira 28/09/2026'),
  ('80101500', 'Servicios de consultoría de negocios y administración corporativa', 18, 101, '2026-09-28', 'Certificado RUP Cámara de Comercio de Pereira 28/09/2026'),
  ('81101700', 'Ingeniería eléctrica y electrónica', 18, 101, '2026-09-28', 'Certificado RUP Cámara de Comercio de Pereira 28/09/2026'),
  ('92101500', 'Servicios de policía', 50, 101, '2026-09-28', 'Certificado RUP Cámara de Comercio de Pereira 28/09/2026'),
  ('92121500', 'Servicios de guardias', 101, 101, '2026-09-28', 'Certificado RUP Cámara de Comercio de Pereira 28/09/2026'),
  ('92121600', 'Servicios de detectives', 54, 101, '2026-09-28', 'Certificado RUP Cámara de Comercio de Pereira 28/09/2026'),
  ('92121700', 'Servicios de sistemas de seguridad', 79, 101, '2026-09-28', 'Certificado RUP Cámara de Comercio de Pereira 28/09/2026')
on conflict (codigo) do nothing;

commit;
