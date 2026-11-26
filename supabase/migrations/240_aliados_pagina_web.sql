-- 240 — Aliados: la página web de cada empresa y lo que Vig-IA lee en ella (Juan, 2026-11-26: «en el perfil de los
-- aliados deberíamos tener dónde dejar la web de las empresas, ya que hoy hemos visto que la web nos da mucha
-- información» y «de una vez que Vig-IA consulte la web; no necesita proponer los datos: déjelos registrados de una vez»).
--
-- 1. `website`: la dirección, la escribe una persona.
-- 2. `website_info`: lo que Vig-IA leyó (sedes, teléfonos, correos, servicios, certificaciones…), con las páginas
--    leídas. Se guarda directo, sin aprobación (decisión de Juan); no toca el contacto ni las notas, que son nuestros.
-- 3. `website_read_at` / `website_read_error`: cuándo se leyó y, si falló, por qué (para volver a pedirlo).
-- Funciones nuevas con nombre propio (memoria firma-nueva-nace-sin-permisos).
begin;

alter table public.psi_vigilance_companies
  add column if not exists website text check (website is null or (char_length(website) <= 300 and website ~* '^https?://[^\s/]+')),
  add column if not exists website_info jsonb check (website_info is null or jsonb_typeof(website_info) = 'object'),
  add column if not exists website_read_at timestamptz,
  add column if not exists website_read_error text check (website_read_error is null or char_length(website_read_error) <= 300);

-- La dirección de la web. Si cambia, lo leído de la anterior se borra (no puede quedar pegado a otra web).
create or replace function public.psi_save_vigilance_website(p_actor_id uuid, p_nit text, p_website text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.psi_vigilance_companies%rowtype; v_url text := nullif(btrim(coalesce(p_website, '')), '');
begin
  perform public.psi_assert_allies_actor(p_actor_id);
  if v_url is not null and (char_length(v_url) > 300 or v_url !~* '^https?://[^\s/]+') then
    raise exception 'La página web no es válida.' using errcode = '22023';
  end if;
  update public.psi_vigilance_companies
    set website = v_url,
        website_info = case when website is distinct from v_url then null else website_info end,
        website_read_at = case when website is distinct from v_url then null else website_read_at end,
        website_read_error = case when website is distinct from v_url then null else website_read_error end,
        updated_by = p_actor_id, updated_at = now()
    where nit = p_nit
    returning * into v_row;
  if not found then raise exception 'Esa empresa no está en la base.' using errcode = 'P0002'; end if;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.psi_save_vigilance_website(uuid, text, text) from public, anon, authenticated;
grant execute on function public.psi_save_vigilance_website(uuid, text, text) to service_role;

-- Lo que Vig-IA leyó de la web (o el error). Sólo si la web sigue siendo la misma que se leyó.
create or replace function public.psi_save_vigilance_website_reading(p_actor_id uuid, p_nit text, p_website text, p_info jsonb, p_error text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.psi_vigilance_companies%rowtype;
begin
  perform public.psi_assert_allies_actor(p_actor_id);
  if p_info is not null and jsonb_typeof(p_info) is distinct from 'object' then
    raise exception 'Lo leído de la web no es válido.' using errcode = '22023';
  end if;
  update public.psi_vigilance_companies
    set website_info = case when p_info is not null then p_info else website_info end,
        website_read_at = case when p_info is not null then now() else website_read_at end,
        website_read_error = left(nullif(btrim(coalesce(p_error, '')), ''), 300),
        updated_at = now()
    where nit = p_nit and website = p_website
    returning * into v_row;
  if not found then raise exception 'La página web de esa empresa cambió mientras se leía.' using errcode = 'P0002'; end if;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.psi_save_vigilance_website_reading(uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.psi_save_vigilance_website_reading(uuid, text, text, jsonb, text) to service_role;

commit;
