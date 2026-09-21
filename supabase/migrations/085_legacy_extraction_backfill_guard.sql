begin;

-- Atomic, service-role-only write path for the one-time legacy backfill
-- (scripts/agt002-backfill-legacy-document-extractions.mjs): migrates the
-- pre-AGT-002 `psi_tender_document_versions.extracted_text` column into the
-- governed psi_tender_document_extractions register. The extractor identity
-- ('legacy-version-register@1' / 'legacy-version-column'), status ('ok') and
-- gap_reason (null) are fixed server-side so the caller can never mislabel a
-- legacy column copy as a real parser run, and can never smuggle a gap
-- through this path.
create or replace function public.psi_backfill_legacy_tender_document_extraction(
  p_opportunity_id uuid,
  p_tender_id uuid,
  p_document_version_id uuid,
  p_extracted_text text,
  p_text_hash text,
  p_char_count integer,
  p_text_byte_count integer,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.psi_tender_document_versions%rowtype;
begin
  select * into v_version from public.psi_tender_document_versions where id = p_document_version_id for update;
  if not found then raise exception 'La versión documental no existe.' using errcode = 'P0002'; end if;

  if v_version.opportunity_id is distinct from p_opportunity_id or v_version.tender_id is distinct from p_tender_id then
    raise exception 'La versión documental no coincide con la oportunidad y licitación indicadas.' using errcode = '22023';
  end if;

  if v_version.current is distinct from true then
    raise exception 'La versión documental no es la versión vigente.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.psi_sales_profiles p
    where p.id = p_actor_id and p.active = true and coalesce(p.identity_type, 'human') = 'human'
  ) then
    raise exception 'El actor debe ser un perfil humano activo.' using errcode = '42501';
  end if;

  return public.psi_record_tender_document_extraction(
    p_opportunity_id => p_opportunity_id,
    p_tender_id => p_tender_id,
    p_document_version_id => p_document_version_id,
    p_extractor_version => 'legacy-version-register@1',
    p_status => 'ok',
    p_parser => 'legacy-version-column',
    p_extracted_text => p_extracted_text,
    p_text_hash => p_text_hash,
    p_char_count => p_char_count,
    p_text_byte_count => p_text_byte_count,
    p_metadata => jsonb_build_object('source', 'legacy_extracted_text_backfill'),
    p_gap_reason => null,
    p_actor_id => p_actor_id
  );
end;
$$;

revoke all on function public.psi_backfill_legacy_tender_document_extraction(
  uuid, uuid, uuid, text, text, integer, integer, uuid
) from public, authenticated, anon, service_role;
grant execute on function public.psi_backfill_legacy_tender_document_extraction(
  uuid, uuid, uuid, text, text, integer, integer, uuid
) to service_role;

commit;
