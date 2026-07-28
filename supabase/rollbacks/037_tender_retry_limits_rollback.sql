begin;

drop function if exists public.psi_record_tender_import_item(
  uuid, text, text, text, text, text, boolean, uuid, text, text, timestamptz
);

-- La firma previa de 10 argumentos, creada por 035, permanece instalada y
-- vuelve a ser la única resolución disponible para clientes anteriores.
revoke all on function public.psi_record_tender_import_item(uuid, text, text, text, text, text, boolean, uuid, text, text) from public, authenticated, anon;
grant execute on function public.psi_record_tender_import_item(uuid, text, text, text, text, text, boolean, uuid, text, text) to service_role;

commit;
