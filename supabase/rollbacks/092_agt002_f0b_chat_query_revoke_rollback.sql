-- CERO APPLY. Repo-only evidence. Do NOT `supabase db push`. Do NOT `psql` against
-- prod/staging. Do NOT run this remotely, ever. This file exists only so the TDD
-- suite (tests/agt002-f0b-chat-query-rollback-pglite.integration.test.mjs) can prove,
-- against a local isolated PGlite instance, that migration 092 (AGT-002 F0-B
-- chat_query SECURITY DEFINER revoke/retire) is reversible.
--
-- Source of truth: the live pre-092 F0-D snapshot of public.chat_query(text), recovered
-- verbatim (definition, SECURITY DEFINER, owner postgres, grants) before 092 revoked it.

begin;

CREATE OR REPLACE FUNCTION public.chat_query(p_sql text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_sql_upper text;
  v_result json;
BEGIN
  v_sql_upper := upper(trim(p_sql));
  IF v_sql_upper NOT LIKE 'SELECT%' THEN
    RAISE EXCEPTION 'Solo se permiten consultas SELECT';
  END IF;
  IF v_sql_upper ~ '(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)' THEN
    RAISE EXCEPTION 'Operacion no permitida';
  END IF;
  EXECUTE format('SELECT json_agg(t) FROM (%s) t', p_sql) INTO v_result;
  RETURN COALESCE(v_result, '[]'::json);
END;
$function$;

-- 092 added `SET search_path = pg_catalog` (proconfig non-null). CREATE OR REPLACE
-- above restores the pre-092 body but does not clear a proconfig set by a prior
-- version of the function on some engines, so this reset is required to bring
-- proconfig back to null, matching the live pre-092 F0-D snapshot exactly.
alter function public.chat_query(text) reset all;

alter function public.chat_query(text) owner to postgres;
revoke all on function public.chat_query(text) from public;
revoke all on function public.chat_query(text) from anon;
revoke all on function public.chat_query(text) from authenticated;
revoke all on function public.chat_query(text) from service_role;
grant execute on function public.chat_query(text) to public;
grant execute on function public.chat_query(text) to anon;
grant execute on function public.chat_query(text) to authenticated;
grant execute on function public.chat_query(text) to service_role;

commit;
