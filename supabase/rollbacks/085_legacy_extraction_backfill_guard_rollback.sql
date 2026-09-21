-- Rollback for supabase/migrations/085_legacy_extraction_backfill_guard.sql.
--
-- Strictly the inverse of 085 and nothing more: drops the one-time legacy backfill
-- write path (psi_backfill_legacy_tender_document_extraction). The governed extraction
-- register (psi_tender_document_extractions) and psi_record_tender_document_extraction
-- are untouched — 085 only added a guarded caller in front of them.
begin;

revoke all on function public.psi_backfill_legacy_tender_document_extraction(
  uuid, uuid, uuid, text, text, integer, integer, uuid
) from public, authenticated, anon, service_role;
drop function if exists public.psi_backfill_legacy_tender_document_extraction(
  uuid, uuid, uuid, text, text, integer, integer, uuid
);

commit;
