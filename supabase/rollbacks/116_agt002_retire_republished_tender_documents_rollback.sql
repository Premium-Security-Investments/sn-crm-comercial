-- Reversa de 116: elimina la función de retiro y la de avisos en observaciones. Las versiones ya marcadas current = false siguen
-- como historial (la función nunca borró filas); el seguimiento de republicaciones deja de poder
-- retirar los documentos del aviso anterior y, sin ella, no lanza el reanálisis automático.
begin;
drop function if exists public.psi_retire_tender_document_versions(uuid, uuid, text, text[], uuid);
drop function if exists public.psi_append_opportunity_observation_line(uuid, text);
commit;
