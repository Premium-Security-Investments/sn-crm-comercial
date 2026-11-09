-- 195 — La cobertura de la licencia de comunicaciones en la ficha de la empresa (F12 reabierto, punto 4 del diagnóstico
-- de AGT-002 del 2026-11-09).
--
-- En Fiscalía (Quibdó) y en la SIC (Bogotá) Vig-IA dio la licencia TIC por cumplida (AVAILABLE) porque la ficha no decía
-- dónde cubre: el bloque `communications_license` sólo traía «vigencia no determinable». Decisión de Juan (2026-11-09):
-- Vig-IA la lee de la resolución y la escribe directo, en un formato que pueda comparar con cada pliego.
--
-- Fuente: Resolución MinTIC 01535 del 22 de abril de 2026 (`01_RESOLUCION_MINTIC_01535_2026.pdf`, 63 páginas, SharePoint),
-- artículo 1 (renovación por 10 años desde el 1-ene-2026, expediente 97001262) y el cuadro «Área de servicio» de la red
-- 29062. Se agrega como versión nueva del bloque (el registro versiona por `entry_id`); la anterior queda como historial.
begin;

do $$
declare
  v_cur public.psi_agt002_company_evidence_registry%rowtype;
  v_new public.psi_agt002_company_evidence_registry%rowtype;
  v_juan constant uuid := '60b26173-1226-476b-a958-cf2917661432';
begin
  select * into v_cur from public.psi_agt002_company_evidence_registry where entry_id = 'communications_license' and current for update;
  if not found then raise notice 'No hay bloque vigente communications_license; no se cambia nada.'; return; end if;
  if v_cur.source_reference like 'Resolución MinTIC 01535%' then raise notice 'La cobertura ya estaba cargada.'; return; end if;
  update public.psi_agt002_company_evidence_registry set current = false where id = v_cur.id;
  v_new := v_cur;
  v_new.id := gen_random_uuid();
  v_new.version := v_cur.version + 1;
  v_new.current := true;
  v_new.vigencia_text := 'Res. MinTIC 01535 del 22-abr-2026: permiso de espectro renovado por 10 años, del 2026-01-01 al 2035-12-31 (expediente 97001262). '
    || 'COBERTURA (área de servicio, red 29062): Red 1 — departamental: todo RISARALDA; municipal: Caldas (Belalcázar, Palestina, San José), '
    || 'Quindío (Armenia, Circasia, Filandia, La Tebaida, Montenegro, Quimbaya, Salento), Valle del Cauca (Alcalá, Ansermanuevo, Cartago, El Águila, Toro, Ulloa). '
    || 'Red 2 — departamental: RISARALDA; municipal: Valle del Cauca (Ansermanuevo, Cartago). '
    || 'NO cubre otros departamentos ni municipios (por ejemplo Bogotá, Chocó/Quibdó, Antioquia, Caldas fuera de los tres municipios citados): '
    || 'si el pliego exige cobertura donde no está, la alternativa es la certificación de un operador nacional.';
  v_new.expiry := date '2035-12-31';
  v_new.notes := '{"cobertura_tic":{"resolucion":"MinTIC 01535 del 2026-04-22","vigente_hasta":"2035-12-31","redes":[{"red":1,"departamentos":["Risaralda"],"municipios":{"Caldas":["Belalcázar","Palestina","San José"],"Quindío":["Armenia","Circasia","Filandia","La Tebaida","Montenegro","Quimbaya","Salento"],"Valle del Cauca":["Alcalá","Ansermanuevo","Cartago","El Águila","Toro","Ulloa"]}},{"red":2,"departamentos":["Risaralda"],"municipios":{"Valle del Cauca":["Ansermanuevo","Cartago"]}}]}}';
  v_new.source_reference := 'Resolución MinTIC 01535 del 22-abr-2026 (01_RESOLUCION_MINTIC_01535_2026.pdf), art. 1 y cuadro de área de servicio';
  v_new.existence_status := 'verified';
  v_new.human_review_status := 'approved';
  v_new.decision_humana := 'Cobertura leída de la Res. MinTIC 01535/2026 y cargada por Vig-IA por decisión de Juan Botero del 2026-11-09.';
  v_new.decision_humana_fecha := date '2026-11-09';
  v_new.decision_humana_por := v_juan;
  v_new.created_by := v_juan;
  v_new.created_at := now();
  v_new.updated_at := now();
  insert into public.psi_agt002_company_evidence_registry select v_new.*;
end;
$$;

commit;
