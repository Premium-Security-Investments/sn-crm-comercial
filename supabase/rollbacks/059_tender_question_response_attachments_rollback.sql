begin;

drop function if exists public.psi_record_tender_question_response_with_attachments(uuid,uuid,uuid,text,text,text,text,text,uuid,jsonb);
drop trigger if exists psi_tender_question_response_attachments_immutable on public.psi_tender_question_response_attachments;
drop function if exists public.psi_tender_question_response_attachments_prevent_mutation();
drop table if exists public.psi_tender_question_response_attachments;

commit;
