-- 198 — Mejora 9, primera parte (Juan, 2026-11-10): el certificado de cada experiencia y la lista de cuáles pedir.
--
-- No hay una carpeta con los certificados de los contratos: hay que pedírselos a los clientes (Juan, 2026-11-10). En
-- SharePoint sólo están los de Matecaña (RUP 050) y Terminales Medellín (RUP 086). Cada experiencia lleva el estado de
-- su certificado y una nota (qué le falta, a quién se le pidió); la pantalla arma con eso la lista de qué pedir primero.
--
-- Estados: falta (no lo tenemos), pedido (se le pidió al cliente), recibido (lo tenemos, sin revisar contra el RUP),
-- incompleto (lo tenemos y le falta algo que el pliego exige), completo (revisado y sirve).
begin;

alter table public.psi_company_experience
  add column if not exists certificate_status text not null default 'falta'
    check (certificate_status in ('falta', 'pedido', 'recibido', 'incompleto', 'completo')),
  add column if not exists certificate_note text check (certificate_note is null or char_length(certificate_note) <= 500),
  add column if not exists certificate_updated_at timestamptz;

-- Lo que consta en SharePoint (`02_Biblioteca_Corporativa_SN/04_Experiencia_Acreditada`, revisado el 2026-11-10).
update public.psi_company_experience
set certificate_status = 'recibido', certificate_updated_at = now(),
    certificate_note = 'En SharePoint: CERT_MATECANA_contrato_2016041_RUP050.pdf. Sin revisar contra el RUP.'
where rup_consecutive = '050' and certificate_status = 'falta';
update public.psi_company_experience
set certificate_status = 'incompleto', certificate_updated_at = now(),
    certificate_note = 'En SharePoint: CERT_TERMINALES_MEDELLIN_contrato_051-2024_RUP086.pdf. Sin fecha de expedición (Terminal, nov-2026).'
where rup_consecutive = '086' and certificate_status = 'falta';
update public.psi_company_experience
set certificate_note = 'Hay un borrador para firma de Jerónimo Martins (V8, 2026-10-04) en 04_Experiencia_Acreditada.'
where rup_consecutive = '089' and certificate_note is null;

commit;
