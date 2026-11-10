-- 197 — Aliados: el contacto en cuatro campos (Juan, 2026-11-10: «donde dice contacto tenemos un campo para poner todo?»).
--
-- Nombre, cargo, teléfono y correo de la persona con quien hablamos en cada empresa. La columna `contact` de la 196 queda
-- (texto libre heredado; el 2026-11-10 estaba vacía en las 794 empresas). Función nueva con nombre propio, para no
-- sobrecargar `psi_update_vigilance_company` (memoria firma-nueva-nace-sin-permisos): la vieja sigue para la carga.
begin;

alter table public.psi_vigilance_companies
  add column if not exists contact_name text check (contact_name is null or char_length(contact_name) <= 200),
  add column if not exists contact_title text check (contact_title is null or char_length(contact_title) <= 200),
  add column if not exists contact_phone text check (contact_phone is null or char_length(contact_phone) <= 100),
  add column if not exists contact_email text check (contact_email is null or char_length(contact_email) <= 200);

-- Lo nuestro de cada empresa: rol, el contacto en cuatro campos y notas. `p_contact` = {name, title, phone, email}.
create or replace function public.psi_save_vigilance_company(p_actor_id uuid, p_nit text, p_role text, p_contact jsonb, p_notes text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.psi_vigilance_companies%rowtype;
begin
  perform public.psi_assert_allies_actor(p_actor_id);
  if p_contact is not null and jsonb_typeof(p_contact) is distinct from 'object' then
    raise exception 'El contacto no es válido.' using errcode = '22023';
  end if;
  update public.psi_vigilance_companies
    set role = coalesce(nullif(p_role, ''), role),
        contact_name = nullif(btrim(coalesce(p_contact ->> 'name', '')), ''),
        contact_title = nullif(btrim(coalesce(p_contact ->> 'title', '')), ''),
        contact_phone = nullif(btrim(coalesce(p_contact ->> 'phone', '')), ''),
        contact_email = nullif(btrim(coalesce(p_contact ->> 'email', '')), ''),
        notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_by = p_actor_id, updated_at = now()
    where nit = p_nit
    returning * into v_row;
  if not found then raise exception 'Esa empresa no está en la base.' using errcode = 'P0002'; end if;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.psi_save_vigilance_company(uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.psi_save_vigilance_company(uuid, text, text, jsonb, text) to service_role;

commit;
