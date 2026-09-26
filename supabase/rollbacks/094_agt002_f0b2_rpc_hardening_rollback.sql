-- CERO APPLY. Repo-only evidence. Do NOT `supabase db push`. Do NOT `psql` against
-- prod/staging. Do NOT run this remotely. This file exists so the TDD suite can
-- prove, against a local isolated PGlite instance, that migration 094 is reversible
-- to the live post-092 grant/search_path matrix.
--
-- Does not restore chat_query. Does not touch 093 / psi_sales_clients.

alter function public.handle_new_user() reset all;
alter function public.get_my_profile() reset all;
alter function public.registrar_uso_ia(uuid, integer, integer, text) reset all;

revoke all on function public.psi_admin_acquire_profile_lock(uuid) from public, anon, authenticated, service_role;
grant execute on function public.psi_admin_acquire_profile_lock(uuid) to anon;
grant execute on function public.psi_admin_acquire_profile_lock(uuid) to service_role;

revoke all on function public.psi_admin_release_profile_lock(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.psi_admin_release_profile_lock(uuid, uuid) to anon;
grant execute on function public.psi_admin_release_profile_lock(uuid, uuid) to service_role;

revoke all on function public.psi_admin_bind_profile_auth(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.psi_admin_bind_profile_auth(uuid, text, uuid) to anon;
grant execute on function public.psi_admin_bind_profile_auth(uuid, text, uuid) to service_role;

revoke all on function public.psi_admin_persist_profile_access(text, uuid, jsonb, jsonb, jsonb, jsonb, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.psi_admin_persist_profile_access(text, uuid, jsonb, jsonb, jsonb, jsonb, uuid, uuid) to anon;
grant execute on function public.psi_admin_persist_profile_access(text, uuid, jsonb, jsonb, jsonb, jsonb, uuid, uuid) to service_role;

revoke all on function public.psi_profile_has_tender_permission(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.psi_profile_has_tender_permission(uuid, boolean) to anon;
grant execute on function public.psi_profile_has_tender_permission(uuid, boolean) to service_role;

revoke all on function public.psi_record_tender_analysis_run(uuid, uuid, uuid, text, text, text, jsonb, integer, text, text, text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.psi_record_tender_analysis_run(uuid, uuid, uuid, text, text, text, jsonb, integer, text, text, text, text, jsonb) to anon;
grant execute on function public.psi_record_tender_analysis_run(uuid, uuid, uuid, text, text, text, jsonb, integer, text, text, text, text, jsonb) to service_role;

revoke all on function public.psi_assert_tender_dossier_go(uuid) from public, anon, authenticated, service_role;
grant execute on function public.psi_assert_tender_dossier_go(uuid) to public;
grant execute on function public.psi_assert_tender_dossier_go(uuid) to anon;
grant execute on function public.psi_assert_tender_dossier_go(uuid) to authenticated;

revoke all on function public.psi_assert_tender_dossier_actor(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.psi_assert_tender_dossier_actor(uuid, boolean) to public;
grant execute on function public.psi_assert_tender_dossier_actor(uuid, boolean) to anon;
grant execute on function public.psi_assert_tender_dossier_actor(uuid, boolean) to authenticated;

revoke all on function public.psi_sales_current_profile_id() from public, anon, authenticated, service_role;
grant execute on function public.psi_sales_current_profile_id() to public;
grant execute on function public.psi_sales_current_profile_id() to anon;
grant execute on function public.psi_sales_current_profile_id() to authenticated;

revoke all on function public.psi_sales_current_profile_role() from public, anon, authenticated, service_role;
grant execute on function public.psi_sales_current_profile_role() to public;
grant execute on function public.psi_sales_current_profile_role() to anon;
grant execute on function public.psi_sales_current_profile_role() to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;
grant execute on function public.handle_new_user() to public;
grant execute on function public.handle_new_user() to anon;
grant execute on function public.handle_new_user() to authenticated;

revoke all on function public.get_my_profile() from public, anon, authenticated, service_role;
grant execute on function public.get_my_profile() to public;
grant execute on function public.get_my_profile() to anon;
grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.get_my_profile() to service_role;

revoke all on function public.registrar_uso_ia(uuid, integer, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.registrar_uso_ia(uuid, integer, integer, text) to public;
grant execute on function public.registrar_uso_ia(uuid, integer, integer, text) to anon;
grant execute on function public.registrar_uso_ia(uuid, integer, integer, text) to authenticated;
grant execute on function public.registrar_uso_ia(uuid, integer, integer, text) to service_role;
