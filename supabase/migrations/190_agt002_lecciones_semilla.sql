-- 190 — Lecciones de la empresa: carga inicial (encargo AGT-002 del 2026-11-06, PR e de cinco).
--
-- Las 21 lecciones que AGT-002 dejó verificadas en /root/handoffs/2026-11-06-AGT-002-lecciones-semilla.md entran
-- como `propuesta`, en el mismo orden (L-01 a L-21), para que Juan o Katherine las aprueben en Lecciones. Ninguna
-- queda activa: Vig-IA no las usa hasta que una persona las apruebe.
--
-- Se registran con la misma función que usa la pantalla (psi_propose_tender_lesson, 189), a nombre de Juan Botero y
-- marcadas como redactadas por Vig-IA (AGT-002). Sólo corre si todavía no hay ninguna carga inicial: volver a correrla
-- no duplica nada.
begin;

do $$
declare
  v_juan constant uuid := '60b26173-1226-476b-a958-cf2917661432';
  v_row record;
begin
  if exists (select 1 from public.psi_tender_lessons where source_kind = 'carga_inicial') then
    raise notice 'La carga inicial de lecciones ya estaba hecha; no se agrega nada.';
    return;
  end if;
  for v_row in
    select * from (values
  (1, $l$sede_agencia$l$, $l$Agencia no es sucursal. Nuestras sedes fuera de Pereira son agencias (Bogotá Res. SVSP 2020-0049297, Medellín, Cali, Manizales, Cartago); no tenemos sucursales.$l$, $l$DEAJ LP-07-2026 pide «sede principal o sucursal»; en Cali ya rechazaron una agencia.$l$, $l$Si el pliego pide sucursal, marcar inhabilitante y proponer observación a tiempo.$l$),
  (2, $l$sede_agencia$l$, $l$Presencia no es agencia: operar en una ciudad no cuenta; solo cuenta la resolución de la Supervigilancia. Armenia: pendiente de resolución.$l$, $l$Fiscalía FGN-REC-IPSE-0058-2026 (Quibdó, Armenia).$l$, $l$No dar por cumplida una sede sin resolución.$l$),
  (3, $l$sede_agencia$l$, $l$La sede principal es Pereira. Un domicilio local con antigüedad mínima no se subsana.$l$, $l$Fondo Único (Bolívar, Casanare, Nariño); Educación Cali.$l$, $l$NO-GO individual o UT con socio local.$l$),
  (4, $l$financiero$l$, $l$Liquidez 2,37 (estados a dic-2025).$l$, $l$DEAJ pide 2,73; Cali 3,06.$l$, $l$Si el pliego pide más: observar con el estudio del sector o ir en UT.$l$),
  (5, $l$precio$l$, $l$El precio se estima por el centro del mercado y se simulan los métodos de puntaje, nunca como % del techo.$l$, $l$Terminal TT-SPO-07-2026: 60 % del techo con el centro en 42 % → 202 pts, puesto 22 de 28.$l$, $l$Pedir Anexos 9 de competidores o históricos y simular antes de decidir.$l$),
  (6, $l$precio$l$, $l$En el Eje Cafetero, 2 de cada 3 licitaciones de vigilancia tienen un solo oferente y se adjudican cerca del 100 % del presupuesto.$l$, $l$Histórico SECOP 2022-2026.$l$, $l$Ahí se compite en habilitantes y puntaje; en Bogotá y en subasta, en precio.$l$),
  (7, $l$documentos_vigencias$l$, $l$En el Excel económico el techo viene con IVA y la casilla se llena sin IVA; una celda en cero es rechazo.$l$, $l$Terminal, Anexo 9: 11 casillas en cero de fábrica.$l$, $l$Revisar el Excel con el validador antes de radicar.$l$),
  (8, $l$documentos_vigencias$l$, $l$El puntaje no se subsana: frases exactas del anexo y certificados con fecha de expedición.$l$, $l$Terminal: «sin costo adicional» valía 200 de 1.000; certificado de Medellín sin fecha → 0.$l$, $l$Revisar cada anexo de puntaje palabra por palabra.$l$),
  (9, $l$documentos_vigencias$l$, $l$El RUP debe estar dentro de la ventana que pida el pliego a la fecha de cierre; una inscripción nueva queda en firme 10 días hábiles después.$l$, $l$Terminal: RUP del 28-sep con 37 días.$l$, $l$Al GO, medir la vigencia contra la fecha de cierre.$l$),
  (10, $l$documentos_vigencias$l$, $l$Los trámites con terceros (certificados de clientes, Personería, RUP, multas) se piden al registrar el GO, no la semana del cierre.$l$, $l$Terminal: ninguno llegó antes del cierre.$l$, $l$Usar los trámites que crea el GO.$l$),
  (11, $l$garantias_polizas$l$, $l$La póliza RCE vigente es de 400 SMMLV.$l$, $l$Supersalud pedía 1.000 y no se presentó; Fiscalía pide 500.$l$, $l$Si piden más, pedir la emisión al GO.$l$),
  (12, $l$garantias_polizas$l$, $l$Preguntar el cupo de la aseguradora al decidir GO cuando hay varios procesos a la vez.$l$, $l$Nov-2026: unos $7.900 M en garantías de seriedad simultáneas.$l$, $l$Sumar las garantías abiertas antes de cada GO.$l$),
  (13, $l$garantias_polizas$l$, $l$Calificamos como «empresa de mujeres» (9 de 16 cargos directivos), lo que puede bajar la garantía si el pliego lo prevé.$l$, $l$Terminal: del 12 % al 10 %, no usado por falta de tiempo.$l$, $l$Buscar el criterio en el pliego y preparar el soporte.$l$),
  (14, $l$alianzas_ut$l$, $l$Somos Gran Empresa: no aplican beneficios Mipyme, y una UT con Mipyme da poco puntaje.$l$, $l$Manizales: 0,25 pts.$l$, $l$No buscar socio Mipyme solo por puntaje.$l$),
  (15, $l$alianzas_ut$l$, $l$Las UT se llevan el 56 % del valor regional, y los contratos grandes del Eje los ganan UT.$l$, $l$Histórico SECOP 2022-2026.$l$, $l$Tener socios preseleccionados antes de que salgan los pliegos.$l$),
  (16, $l$licencias$l$, $l$La licencia de comunicaciones cubre Risaralda. Si piden cobertura nacional, la alternativa es la certificación del operador (Claro). Radicar la renovación vigente (Res. MinTIC 01535/2026).$l$, $l$Manizales pide nacional; en Terminal se radicó la de 2021, «hasta 31-dic-2025».$l$, $l$Verificar cobertura y vigencia antes de radicar.$l$),
  (17, $l$rup_unspsc$l$, $l$El RUP tiene 14 códigos UNSPSC y falta el 46101500 para procesos de tecnología. Cruzar contra la lista exacta del pliego.$l$, $l$ESU (5 de 33); Municipio de Pereira.$l$, $l$Cruce código por código.$l$),
  (18, $l$personal_habilitante$l$, $l$Coordinador con vínculo de 10 años: Duvan Gutiérrez (con SN desde 2014) cumple el vínculo; Fredy Chimbi (desde 2024) no.$l$, $l$DEAJ LP-07-2026.$l$, $l$Revisar soportes de personal antes de observar.$l$),
  (19, $l$estrategia$l$, $l$Si somos el contratista actual, no aflojar barreras en las observaciones; si somos retadores, pedir reglas claras. Comparar siempre con el proceso anterior de la misma entidad.$l$, $l$Rama Pereira LP-01-2026 frente a SA-MC-02-2026.$l$, $l$Antes de observar, revisar qué aceptamos la vez anterior.$l$),
  (20, $l$cronograma$l$, $l$La fecha de observaciones puede estar solo en la página de SECOP, no en los datos abiertos.$l$, $l$Rama Pereira: se supo el 5-nov para el 6-nov.$l$, $l$Leer el cronograma desde el aviso al registrar el proceso.$l$),
  (21, $l$competencia$l$, $l$Estatal de Seguridad tiene el 49 % de Risaralda y es el contratista del Municipio de Pereira.$l$, $l$NO-GO Municipio de Pereira 4-nov; histórico SECOP.$l$, $l$Evaluar ese municipio con esa realidad.$l$)
    ) as s(n, category, statement, rationale, how_to_apply)
    order by n
  loop
    perform public.psi_propose_tender_lesson(v_juan, jsonb_build_object(
      'statement', v_row.statement, 'rationale', v_row.rationale, 'how_to_apply', v_row.how_to_apply,
      'category', v_row.category, 'source_kind', 'carga_inicial',
      'source_ref', 'AGT-002, lecciones semilla del 2026-11-06, n.º ' || v_row.n), true);
  end loop;
end;
$$;

commit;
