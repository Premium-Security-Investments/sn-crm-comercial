-- 159 — La verificación queda amarrada al documento que la sustenta.
--
-- La 158 abrió la decisión humana, pero la decisión vive en el registro y el documento en
-- `psi_company_procurement_documents`, y nada las unía. Consecuencia viva: la póliza RCE quedó
-- aprobada el 2026-10-26; el día que entre la póliza del año siguiente, el renglón seguiría
-- diciendo "Aprobado" sobre un documento que nadie miró.
--
-- Con esta columna, la decisión nombra el documento contra el que se tomó. Cuando entra una versión
-- nueva el identificador cambia, deja de coincidir, y la pantalla vuelve a pedir confirmación. La
-- aprobación no se hereda.
--
-- `on delete set null`: si el documento desaparece, la decisión se conserva pero pierde su ancla,
-- que es justo lo que debe ocurrir — vuelve a quedar por confirmar en vez de mentir.
--
-- Se mantiene el candado de 061: sin INSERT, sin DELETE, y escritura sólo por columna.

alter table public.psi_agt002_company_evidence_registry
  add column if not exists decision_support_document_id uuid
  references public.psi_company_procurement_documents(id) on delete set null;

comment on column public.psi_agt002_company_evidence_registry.decision_support_document_id is
  'Documento contra el que se tomó la decisión humana. Si el documento vigente del bloque es otro, la decisión quedó atrás y hay que confirmar de nuevo.';

grant update (decision_support_document_id)
  on table public.psi_agt002_company_evidence_registry to service_role;
