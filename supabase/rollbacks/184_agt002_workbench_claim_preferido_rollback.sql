-- Reversa de la 184 (en el libro, `181_agt002_workbench_claim_preferido`): quita la función de reclamo con pedido preferido. El código cae solo a
-- `psi_claim_agt002_workbench_job` (048) cuando la función no existe.
begin;
drop function if exists public.psi_claim_agt002_workbench_job_preferido(uuid,text,integer,integer,integer);
commit;
