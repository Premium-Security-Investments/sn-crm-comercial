-- AGT-002 F0-B2 (migration 094): repo-only until a separate apply receipt.
-- Do not supabase db push. Do not psql prod/staging as part of this slice.
-- Does not touch chat_query (092) or psi_sales_clients (093).
--
-- Live post-092 catalog (2026-09-26T19:33:52Z, project tyfzjqzcpgwcjnxozaaf):
-- 13 SECURITY DEFINER routines still executable by anon and/or authenticated.
-- 020 already revoked public/authenticated on the four psi_admin_* RPCs but
-- left EXECUTE to anon. This migration closes that hole and hardens the
-- remaining P0/GO/backend/RLS/search_path exposures without replacing
-- function bodies.

-- P0 admin RPCs + backend-only helpers: drop leftover anon EXECUTE.
revoke all on function public.psi_admin_acquire_profile_lock(uuid) from anon;
grant execute on function public.psi_admin_acquire_profile_lock(uuid) to service_role;

revoke all on function public.psi_admin_release_profile_lock(uuid, uuid) from anon;
grant execute on function public.psi_admin_release_profile_lock(uuid, uuid) to service_role;

revoke all on function public.psi_admin_bind_profile_auth(uuid, text, uuid) from anon;
grant execute on function public.psi_admin_bind_profile_auth(uuid, text, uuid) to service_role;

revoke all on function public.psi_admin_persist_profile_access(text, uuid, jsonb, jsonb, jsonb, jsonb, uuid, uuid) from anon;
grant execute on function public.psi_admin_persist_profile_access(text, uuid, jsonb, jsonb, jsonb, jsonb, uuid, uuid) to service_role;

revoke all on function public.psi_profile_has_tender_permission(uuid, boolean) from anon;
grant execute on function public.psi_profile_has_tender_permission(uuid, boolean) to service_role;

revoke all on function public.psi_record_tender_analysis_run(uuid, uuid, uuid, text, text, text, jsonb, integer, text, text, text, text, jsonb) from anon;
grant execute on function public.psi_record_tender_analysis_run(uuid, uuid, uuid, text, text, text, jsonb, integer, text, text, text, text, jsonb) to service_role;

-- P0 GO + actor helpers: internal DEFINER-to-DEFINER, not browser RPC.
revoke all on function public.psi_assert_tender_dossier_go(uuid) from public;
revoke all on function public.psi_assert_tender_dossier_go(uuid) from anon;
revoke all on function public.psi_assert_tender_dossier_go(uuid) from authenticated;
grant execute on function public.psi_assert_tender_dossier_go(uuid) to service_role;

revoke all on function public.psi_assert_tender_dossier_actor(uuid, boolean) from public;
revoke all on function public.psi_assert_tender_dossier_actor(uuid, boolean) from anon;
revoke all on function public.psi_assert_tender_dossier_actor(uuid, boolean) from authenticated;
grant execute on function public.psi_assert_tender_dossier_actor(uuid, boolean) to service_role;

-- RLS session helpers (008/009/010): KEEP authenticated, drop PUBLIC/anon.
revoke all on function public.psi_sales_current_profile_id() from public;
revoke all on function public.psi_sales_current_profile_id() from anon;
grant execute on function public.psi_sales_current_profile_id() to authenticated;
grant execute on function public.psi_sales_current_profile_id() to service_role;

revoke all on function public.psi_sales_current_profile_role() from public;
revoke all on function public.psi_sales_current_profile_role() from anon;
grant execute on function public.psi_sales_current_profile_role() to authenticated;
grant execute on function public.psi_sales_current_profile_role() to service_role;

-- Trigger / unused helpers: pin search_path; drop unauthenticated EXECUTE.
alter function public.handle_new_user() set search_path = pg_catalog, public;
revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;

alter function public.get_my_profile() set search_path = pg_catalog, public;
revoke all on function public.get_my_profile() from public;
revoke all on function public.get_my_profile() from anon;
grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.get_my_profile() to service_role;

alter function public.registrar_uso_ia(uuid, integer, integer, text) set search_path = pg_catalog, public;
revoke all on function public.registrar_uso_ia(uuid, integer, integer, text) from public;
revoke all on function public.registrar_uso_ia(uuid, integer, integer, text) from anon;
grant execute on function public.registrar_uso_ia(uuid, integer, integer, text) to authenticated;
grant execute on function public.registrar_uso_ia(uuid, integer, integer, text) to service_role;
