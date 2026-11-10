-- Reversa de la 196: quita Aliados. Se pierde lo cargado y lo escrito (rol, contacto, notas, participaciones):
-- respaldar antes con un select de las tres tablas.
begin;
drop function if exists public.psi_add_vigilance_participation(uuid, jsonb);
drop function if exists public.psi_update_vigilance_company(uuid, text, text, text, text);
drop function if exists public.psi_load_vigilance_listing(uuid, text, jsonb);
drop function if exists public.psi_assert_allies_actor(uuid);
drop table if exists public.psi_vigilance_participations;
drop table if exists public.psi_vigilance_company_offices;
drop table if exists public.psi_vigilance_companies;
drop function if exists public.psi_vigilance_participations_append_only();
commit;
