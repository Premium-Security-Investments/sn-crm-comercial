-- AGT-002 F0-B (migration 092): CERO APPLY. This file is repo-only evidence.
-- Do not supabase db push. Do not psql prod/staging. Not applied to any database
-- as part of this slice.
--
-- public.chat_query(p_sql text) was a SECURITY DEFINER function that ran
-- caller-supplied dynamic SQL and carried EXECUTE grants to PUBLIC, anon
-- and authenticated. This migration retires the function body (it now
-- unconditionally raises) and revokes EXECUTE/ALL from PUBLIC, anon and
-- authenticated. No role is granted EXECUTE on this function.

create or replace function public.chat_query(p_sql text)
returns json
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception 'chat_query retired: dynamic SQL is not available' using errcode = '42501';
end;
$$;

revoke all on function public.chat_query(text) from public;
revoke all on function public.chat_query(text) from anon;
revoke all on function public.chat_query(text) from authenticated;
