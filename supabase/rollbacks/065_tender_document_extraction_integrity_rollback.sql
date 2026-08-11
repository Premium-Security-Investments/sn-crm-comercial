begin;

-- Non-destructive rollback: disable the write interface only. The extractions table, its
-- rows, indexes, append-only trigger and RLS/ACL stay exactly as 065 left them, so every
-- persisted extraction (ok text + hash, or a typed gap) is never lost — only the ability
-- to record new extractions through this RPC is withdrawn. This mirrors 052's own rollback
-- discipline and explicitly protects non-empty production data: the table is never dropped
-- and no row is ever removed or wiped anywhere in this file, so it is always safe to run
-- regardless of how many rows the table holds.
revoke all on function public.psi_record_tender_document_extraction(
  uuid, uuid, uuid, text, text, text, text, text, integer, integer, jsonb, text, uuid
) from public, authenticated, anon, service_role;
drop function if exists public.psi_record_tender_document_extraction(
  uuid, uuid, uuid, text, text, text, text, text, integer, integer, jsonb, text, uuid
);

commit;
