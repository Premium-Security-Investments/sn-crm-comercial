begin;

-- Non-destructive rollback: disable the write interface only. The chunks table,
-- its rows, indexes, append-only trigger and RLS stay exactly as 052 left them, so
-- persisted document-chunk evidence is never lost — only the ability to record new
-- chunks through this RPC is withdrawn.
revoke all on function public.psi_record_tender_document_chunk(
  uuid, uuid, uuid, uuid, text, text, text, text, integer, text, integer, integer, integer, text, text, boolean, text, boolean, uuid
) from public, authenticated, anon, service_role;
drop function if exists public.psi_record_tender_document_chunk(
  uuid, uuid, uuid, uuid, text, text, text, text, integer, text, integer, integer, integer, text, text, boolean, text, boolean, uuid
);

commit;
