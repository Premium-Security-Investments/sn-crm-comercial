-- Corrección de la 134: `psi_list_tender_closure_acta_pending` usaba
-- `psi_public_tenders.nombre`, columna que NO existe. La tabla la llama `title`.
--
-- Por qué no se detectó antes: `create function` en plpgsql no valida las columnas
-- del cuerpo, así que la 134 se aplicó sin error y la función sólo falla al
-- ejecutarse; y el fixture de la prueba en PGlite declaraba `nombre` porque lo
-- escribió el mismo agente que escribió la función. El fixture ahora declara las
-- columnas reales de producción.
--
-- Síntoma en producción: POST /api/tender-closure-acta/worker/run devolvía
-- 503 AGT002_CLOSURE_ACTA_UNAVAILABLE.
begin;

create or replace function public.psi_list_tender_closure_acta_pending(p_limit int)
returns table (opportunity_id uuid, tender_id uuid, closure_kind text, closing_note text, tender_name text, analysis_result jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then raise exception 'El límite debe estar entre 1 y 50.' using errcode = '22023'; end if;
  return query
  select o.id, t.id, public.psi_tender_closure_kind(o), note.note, coalesce(t.title, o.company_name), run.result
  from public.psi_sales_opportunities o
  join public.psi_public_tenders t on t.converted_opportunity_id = o.id
  cross join lateral (select public.psi_tender_closure_note(o.id) as payload) closing
  cross join lateral (select closing.payload ->> 'note' as note) note
  left join lateral (
    select r.result from public.psi_tender_analysis_runs r
    where r.opportunity_id = o.id and r.tender_id = t.id
    order by r.created_at desc, r.id desc limit 1
  ) run on true
  where public.psi_tender_closure_kind(o) is not null
    and note.note is not null
    and not exists (select 1 from public.psi_tender_closure_acta a where a.opportunity_id = o.id)
  order by coalesce(o.archived_at, o.updated_at) desc nulls last, o.id asc
  limit p_limit;
end;
$$;
revoke all on function public.psi_list_tender_closure_acta_pending(int) from public, anon, authenticated, service_role;
grant execute on function public.psi_list_tender_closure_acta_pending(int) to service_role;

commit;
