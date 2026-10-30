-- 164 — un documento del que no se puede extraer texto vuelve a entrar al expediente.
--
-- Defecto encontrado el 2026-10-29 con la Fiscalía Eje Cafetero (`FGN-REC-IPSE-0058-2026`): SECOP publicó 13
-- documentos, el importador trajo 12, y el que faltó —`APENDICE Nº 1 Procedimiento Subasta Electronica en el SECOP
-- II.doc`, justo el procedimiento de la subasta— quedó `failed_terminal` con el código 22023 y el mensaje "La
-- oportunidad, licitación, identidad, nombre, MIME, tipo y texto extraído son obligatorios".
--
-- Causa: la migración 065 fijó el contrato de la extracción tipada —`extracted_text` es **NULL cuando hay hueco**
-- (`gap`) y no vacío cuando hay texto (`ok`)— para que un documento ilegible igual quedara versionado, guardado y
-- visible, con su hueco declarado. La 150 (origen del documento) reescribió esta función para agregar `p_origin` y,
-- al hacerlo, se trajo el bloque de validación anterior a la 065: volvió a exigir texto no vacío. Desde el 23-oct,
-- cualquier documento con extracción `gap` —un `.doc` viejo, un PDF escaneado, un paquete que no se pudo abrir
-- entero— falla de forma terminal en vez de entrar. Se ve en los datos: el último `gap` registrado es del 19-oct.
--
-- Esta migración restaura la regla de la 065 sobre la definición viva de la función (patrón guardado de la 029), sin
-- tocar nada de lo que agregó la 150. No cambia el pipeline: `tender-document-versioning.js` ya manda `null` para un
-- `gap`, y el trabajador ya sabe que un documento `gap` no aporta texto analizable (`hasText`).

do $$
declare
  v_proc regprocedure := to_regprocedure('public.psi_record_tender_document_version(uuid,uuid,text,text,text,text,text,text,bigint,text,text,text,uuid,text)');
  v_definition text;
  v_obligatorios_viejo text :=
'or nullif(btrim(p_document_type), '''') is null
     or nullif(btrim(p_extracted_text), '''') is null then
    raise exception ''La oportunidad, licitación, identidad, nombre, MIME, tipo y texto extraído son obligatorios.'' using errcode = ''22023'';';
  v_obligatorios_nuevo text :=
'or nullif(btrim(p_document_type), '''') is null then
    raise exception ''La oportunidad, licitación, identidad, nombre, MIME y tipo son obligatorios.'' using errcode = ''22023'';
  end if;
  -- Contrato de la extracción tipada (065): NULL es un hueco declarado; vacío o en blanco nunca es válido.
  if p_extracted_text is not null and nullif(btrim(p_extracted_text), '''') is null then
    raise exception ''El texto extraído debe ser NULL (gap) o no vacío (ok).'' using errcode = ''22023'';';
  v_tamano_viejo text := 'if octet_length(p_extracted_text) > 10 * 1024 * 1024 then';
  v_tamano_nuevo text := 'if p_extracted_text is not null and octet_length(p_extracted_text) > 10 * 1024 * 1024 then';
  v_hits integer;
begin
  if v_proc is null then
    raise exception 'Falta psi_record_tender_document_version; aplique primero 150.';
  end if;
  v_definition := pg_get_functiondef(v_proc);

  v_hits := (length(v_definition) - length(replace(v_definition, v_obligatorios_viejo, ''))) / length(v_obligatorios_viejo);
  if v_hits <> 1 then
    raise exception 'El bloque de campos obligatorios aparece % veces (se esperaba 1); revisión manual requerida.', v_hits;
  end if;
  v_hits := (length(v_definition) - length(replace(v_definition, v_tamano_viejo, ''))) / length(v_tamano_viejo);
  if v_hits <> 1 then
    raise exception 'El límite de tamaño del texto aparece % veces (se esperaba 1); revisión manual requerida.', v_hits;
  end if;

  v_definition := replace(v_definition, v_obligatorios_viejo, v_obligatorios_nuevo);
  v_definition := replace(v_definition, v_tamano_viejo, v_tamano_nuevo);
  execute v_definition;
  execute format('revoke all on function %s from public', v_proc);
  execute format('revoke all on function %s from anon', v_proc);
  execute format('revoke all on function %s from authenticated', v_proc);
  execute format('grant execute on function %s to service_role', v_proc);
end;
$$;

-- Comprobación: la función ya no puede exigir texto extraído, y sí debe nombrar el contrato de la 065.
do $$
declare
  v_definition text := pg_get_functiondef(to_regprocedure('public.psi_record_tender_document_version(uuid,uuid,text,text,text,text,text,text,bigint,text,text,text,uuid,text)'));
begin
  if position('tipo y texto extraído son obligatorios' in v_definition) > 0 then
    raise exception 'La función sigue exigiendo texto extraído; el hueco declarado volvería a fallar.';
  end if;
  if position('El texto extraído debe ser NULL (gap) o no vacío (ok).' in v_definition) = 0 then
    raise exception 'Falta el contrato de la extracción tipada (065).';
  end if;
end;
$$;
