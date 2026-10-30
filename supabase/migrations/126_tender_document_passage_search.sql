-- AGT-002 · Canal con Vig-IA: buscar en los documentos vigentes del proceso (Juan, 2026-10-13).
-- El chat respondía solo con la lista de tareas y el análisis, que puede tener huecos (p. ej. perdió el
-- cronograma de la Resolución 00390). Esta función devuelve, por documento vigente, el fragmento que más
-- términos de la pregunta reúne, para que Vig-IA responda citando el documento. Solo lectura; el llamador
-- ordena por puntaje y se queda con los mejores.
create or replace function public.psi_search_tender_document_passages(
  p_opportunity_id uuid,
  p_terms text[]
) returns table (document_version_id uuid, name text, excerpt text, score integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_doc record;
  v_text text;
  v_term text;
  v_terms text[];
  v_pos integer;
  v_from integer;
  v_hits integer;
  v_window text;
  v_best_score integer;
  v_best_start integer;
  v_found integer;
  v_start integer;
begin
  -- Términos (raíces) normalizados (minúsculas, sin tildes), entre 3 y 60 caracteres, máximo 12.
  select coalesce(array_agg(distinct t), '{}') into v_terms from (
    select translate(lower(btrim(x)), 'áéíóúüñ', 'aeiouun') t from unnest(coalesce(p_terms, '{}')) x
  ) s where length(t) between 3 and 60;
  v_terms := v_terms[1:12];
  if array_length(v_terms, 1) is null then return; end if;

  for v_doc in
    select v.id, v.name, v.extracted_text
    from public.psi_tender_document_versions v
    join public.psi_public_tenders pt on pt.id = v.tender_id
    where pt.converted_opportunity_id = p_opportunity_id and v.current and v.extracted_text is not null
  loop
    v_text := translate(lower(v_doc.extracted_text), 'áéíóúüñ', 'aeiouun');
    v_best_score := 0; v_best_start := null;
    -- Cada aparición (hasta 40 por término) propone una ventana; gana la que reúne más términos distintos.
    foreach v_term in array v_terms loop
      v_from := 1; v_found := 0;
      loop
        v_pos := strpos(substr(v_text, v_from), v_term);
        exit when v_pos = 0 or v_found >= 40;
        v_pos := v_pos + v_from - 1;
        v_found := v_found + 1;
        v_start := greatest(1, v_pos - 150);
        v_window := substr(v_text, v_start, 950);
        -- Puntaje: cada término distinto presente vale 10; cada aparición extra suma 1 (hasta 5 por término).
        select coalesce(sum(case when strpos(v_window, t) > 0
          then 10 + least(5, (length(v_window) - length(replace(v_window, t, ''))) / length(t) - 1) else 0 end), 0)
          into v_hits from unnest(v_terms) t;
        if v_hits > v_best_score then v_best_score := v_hits; v_best_start := v_start; end if;
        v_from := v_pos + length(v_term);
      end loop;
    end loop;
    if v_best_start is not null then
      document_version_id := v_doc.id;
      name := v_doc.name;
      excerpt := regexp_replace(substr(v_doc.extracted_text, v_best_start, 950), '\s+', ' ', 'g');
      score := v_best_score;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.psi_search_tender_document_passages(uuid, text[]) from public;
revoke all on function public.psi_search_tender_document_passages(uuid, text[]) from anon;
revoke all on function public.psi_search_tender_document_passages(uuid, text[]) from authenticated;
grant execute on function public.psi_search_tender_document_passages(uuid, text[]) to service_role;
