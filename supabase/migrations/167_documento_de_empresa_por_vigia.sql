-- 167 — Vig-IA puede registrar un documento de empresa, y la ficha queda SIEMPRE pendiente de confirmación humana.
--
-- Decisión de Juan Botero, 2026-10-30, escogiendo entre tres caminos: "RPC propia para Vig-IA". El problema que
-- resuelve: los documentos corporativos (BASC, las tres ISO, los antecedentes, las resoluciones de agencia) están en
-- SharePoint y la única forma de meterlos al CRM era la pantalla, con la sesión de una persona. Eso atascó la carga
-- tres veces el mismo día.
--
-- Por qué no servía la función que ya existe: `psi_record_company_procurement_document` exige que quien carga sea un
-- **perfil humano activo con custodia** (`psi_profile_has_tender_custody`, migración 029), y la ruta web además
-- **aprueba la ficha en el mismo acto** (`recordUploadAsVerification`), con el argumento de que quien escoge el bloque
-- y sube el archivo ya verificó. Las dos cosas son correctas para una persona y ninguna lo es para un agente: firmar
-- con la cédula de alguien pondría su nombre en un acto que no hizo, y aprobar en su nombre borraría la puerta humana
-- que la 061 y la 158 protegen.
--
-- Qué hace esta migración:
--
--   1. Extrae el cuerpo de la función viva a `psi_record_company_procurement_document_core`, **sin el control de
--      actor**, para que las dos puertas compartan exactamente las mismas validaciones y no puedan separarse con el
--      tiempo (mismo patrón guardado de la 163).
--   2. Redefine `psi_record_company_procurement_document` como lo que siempre fue: la custodia humana, y después el
--      núcleo. Su comportamiento no cambia en nada.
--   3. Agrega `psi_record_company_procurement_document_as_agent`, que exige lo contrario —una identidad **de agente**
--      activa— y, además, que el bloque exista vigente en el registro de evidencia: un agente no inventa tipos.
--
-- Lo que esta migración NO hace, a propósito: **no escribe el registro de evidencia**. Ninguna de las dos funciones
-- lo toca; la aprobación la sigue registrando una persona desde la pantalla. Un documento cargado por Vig-IA deja su
-- bloque en `pending_human_review`, que es lo que la pantalla lee como "Falta confirmar". Eso es el punto, no una
-- limitación.

begin;

create or replace function public.psi_record_company_procurement_document_core(
  p_document_type text,
  p_display_name text,
  p_issued_at date,
  p_expires_at date,
  p_content_hash text,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes bigint,
  p_uploaded_by uuid,
  p_replace_document_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_document_type text := lower(btrim(p_document_type));
  v_document public.psi_company_procurement_documents%rowtype;
  v_replaced public.psi_company_procurement_documents%rowtype;
  v_version integer;
begin
  if nullif(v_document_type, '') is null or nullif(btrim(p_display_name), '') is null
     or p_issued_at is null or nullif(btrim(p_mime_type), '') is null then
    raise exception 'El tipo, nombre, fecha de expedición y MIME son obligatorios.' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at < p_issued_at then
    raise exception 'Las fechas del documento no son válidas.' using errcode = '22023';
  end if;
  if p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'El hash del documento debe ser SHA-256 hexadecimal en minúscula.' using errcode = '22023';
  end if;
  if p_storage_path is null or btrim(p_storage_path) <> p_storage_path
     or p_storage_path not like 'company-profile/%'
     or p_storage_path like '%..%' then
    raise exception 'La ruta del documento debe pertenecer a company-profile/.' using errcode = '22023';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 50 * 1024 * 1024 then
    raise exception 'El tamaño del documento debe estar entre 1 byte y 50 MB.' using errcode = '22023';
  end if;

  -- Low-volume corporate uploads serialize as one transaction so retries and
  -- version assignment cannot race across document types.
  lock table public.psi_company_procurement_documents in share row exclusive mode;

  select * into v_document
  from public.psi_company_procurement_documents
  where document_type = v_document_type
    and content_hash = p_content_hash;
  if found then
    return jsonb_build_object(
      'id', v_document.id,
      'document_type', v_document.document_type,
      'version', v_document.version,
      'current', v_document.current,
      'issued_at', v_document.issued_at,
      'expires_at', v_document.expires_at,
      'created_at', v_document.created_at
    );
  end if;

  if p_replace_document_id is not null then
    select * into v_replaced
    from public.psi_company_procurement_documents
    where id = p_replace_document_id
    for update;
    if not found or v_replaced.document_type is distinct from v_document_type or not v_replaced.current then
      raise exception 'El documento a reemplazar no existe, no es la versión actual o no corresponde al tipo indicado.' using errcode = '22023';
    end if;
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.psi_company_procurement_documents
  where document_type = v_document_type;

  if v_document_type = 'rup' then
    update public.psi_company_procurement_documents
    set current = false
    where document_type = 'rup' and current;
  elsif p_replace_document_id is not null then
    update public.psi_company_procurement_documents
    set current = false
    where id = p_replace_document_id;
  end if;

  insert into public.psi_company_procurement_documents (
    document_type, display_name, issued_at, expires_at, version, content_hash,
    storage_path, mime_type, size_bytes, current, uploaded_by
  ) values (
    v_document_type, btrim(p_display_name), p_issued_at, p_expires_at, v_version, p_content_hash,
    p_storage_path, btrim(p_mime_type), p_size_bytes, true, p_uploaded_by
  ) returning * into v_document;

  return jsonb_build_object(
    'id', v_document.id,
    'document_type', v_document.document_type,
    'version', v_document.version,
    'current', v_document.current,
    'issued_at', v_document.issued_at,
    'expires_at', v_document.expires_at,
    'created_at', v_document.created_at
  );
end;
$$;

-- El núcleo no es una puerta: sólo lo llaman las dos funciones de abajo, que sí controlan quién entra.
revoke all on function public.psi_record_company_procurement_document_core(text, text, date, date, text, text, text, bigint, uuid, uuid) from public;
revoke all on function public.psi_record_company_procurement_document_core(text, text, date, date, text, text, text, bigint, uuid, uuid) from anon;
revoke all on function public.psi_record_company_procurement_document_core(text, text, date, date, text, text, text, bigint, uuid, uuid) from authenticated;
revoke all on function public.psi_record_company_procurement_document_core(text, text, date, date, text, text, text, bigint, uuid, uuid) from service_role;

-- La puerta de la persona. Mismo contrato y mismo comportamiento que antes: custodia humana y luego el núcleo.
create or replace function public.psi_record_company_procurement_document(
  p_document_type text,
  p_display_name text,
  p_issued_at date,
  p_expires_at date,
  p_content_hash text,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes bigint,
  p_uploaded_by uuid,
  p_replace_document_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.psi_sales_profiles p
    where p.id = p_uploaded_by
      and p.active = true
      and coalesce(p.identity_type, 'human') = 'human'
      and public.psi_profile_has_tender_custody(p.id)
  ) then
    raise exception 'El actor que carga el documento debe ser un perfil humano activo.' using errcode = '42501';
  end if;
  return public.psi_record_company_procurement_document_core(
    p_document_type, p_display_name, p_issued_at, p_expires_at, p_content_hash,
    p_storage_path, p_mime_type, p_size_bytes, p_uploaded_by, p_replace_document_id
  );
end;
$$;

-- La puerta del agente. Carga el archivo y NADA MÁS: la ficha del bloque queda como estaba, pendiente de que una
-- persona la confirme en la pantalla.
create or replace function public.psi_record_company_procurement_document_as_agent(
  p_document_type text,
  p_display_name text,
  p_issued_at date,
  p_expires_at date,
  p_content_hash text,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes bigint,
  p_agent_profile_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_document_type text := lower(btrim(p_document_type));
begin
  -- Exactamente lo contrario de la puerta humana: una identidad de agente activa, nunca una persona. Así el
  -- inventario muestra "Vig-IA" como quien cargó y nadie queda firmando lo que no hizo.
  if not exists (
    select 1 from public.psi_sales_profiles p
    where p.id = p_agent_profile_id
      and p.active = true
      and coalesce(p.identity_type, 'human') = 'agent'
  ) then
    raise exception 'Esta carga es para una identidad de agente activa.' using errcode = '42501';
  end if;
  -- Un agente no inventa tipos: el bloque tiene que existir vigente en el registro de evidencia. Los tipos legados
  -- (por ejemplo `certificado`) y `otro` quedan fuera de esta puerta a propósito.
  if not exists (
    select 1 from public.psi_agt002_company_evidence_registry r
    where r.entry_id = v_document_type and r.current = true and r.integration_active = true
  ) then
    raise exception 'El bloque % no existe vigente en el registro de evidencia empresarial.', v_document_type using errcode = '22023';
  end if;
  return public.psi_record_company_procurement_document_core(
    p_document_type, p_display_name, p_issued_at, p_expires_at, p_content_hash,
    p_storage_path, p_mime_type, p_size_bytes, p_agent_profile_id, null
  );
end;
$$;

revoke all on function public.psi_record_company_procurement_document_as_agent(text, text, date, date, text, text, text, bigint, uuid) from public;
revoke all on function public.psi_record_company_procurement_document_as_agent(text, text, date, date, text, text, text, bigint, uuid) from anon;
revoke all on function public.psi_record_company_procurement_document_as_agent(text, text, date, date, text, text, text, bigint, uuid) from authenticated;
grant execute on function public.psi_record_company_procurement_document_as_agent(text, text, date, date, text, text, text, bigint, uuid) to service_role;

commit;
