# Gate 0 — Vig-IA Comercial AGT-003

**Estado:** APROBADO POR DIRECCIÓN / IMPLEMENTACIÓN AUTORIZADA
**Versión:** 1.0
**Fecha:** 2026-07-18
**Corte técnico consultado:** 2026-07-18T15:00:51Z
**Fuente:** CRM-F1 / `v_psi_sales_opportunity_enriched`
**Alcance:** lectura gobernada → Visual Gerencial Comercial existente (`#/dashboard2`) → Vig-IA Comercial (`AGT-003`)

> Juan Botero autorizó el 2026-07-18 continuar la implementación y desplegar para validación en vivo. Esta aprobación no autoriza migraciones ni escrituras productivas de Vig-IA; el corte permanece en modo de solo lectura.

## 1. Evidencia usada para definir el Gate

Consulta agregada, de solo lectura y sin exponer datos personales:

- 323 oportunidades totales.
- 219 oportunidades activas; 104 terminales.
- Última actualización visible del CRM: `2026-07-15T15:18:32.559291+00:00`.
- Etapas activas observadas: Prospecto 143, Envío de Oferta 68, Sustentación 5, Negociación 3.
- Etapas terminales observadas: Aprobado 50, Descartado 49, Perdido 5.
- 155 activas sin próxima acción.
- 35 activas con próxima acción vencida.
- 111 activas sin fecha esperada de cierre; 103 con cierre esperado vencido.
- 21 activas sin `last_interaction_at`; deben usar fallback explícito.
- 138 activas tienen valor de oferta igual a cero; “sin valor” no puede interpretarse como oportunidad de bajo valor.
- Entre las 81 activas con valor positivo: P90 ≈ $75,3M COP y P95 = $150M COP.
- Hay variantes inconsistentes de regional (mayúsculas, tildes, espacios y punto final); se normalizará para lectura sin modificar el CRM.

## 2. Dataset mínimo aprobado propuesto

El endpoint dedicado podrá leer y devolver exclusivamente:

- Identidad operativa: `id`, `owner_id`, `owner_name`, `company_name`.
- Etapa: `stage_code`, `stage_name`, `stage_order`.
- Servicio: `service_type_code`, `service_type_name`.
- Regional: `regional_nombre`.
- Valor: `offer_value`, `weighted_pipeline_value`.
- Fechas: `next_action_at`, `last_interaction_at`, `updated_at`, `created_at`, `expected_close_date`.
- Catálogo de etapas: `code`, `name`, `stage_order`, `close_probability`.

Quedan excluidos: correo, teléfono, decisores, notas, texto de interacciones, motivos de pérdida, observaciones, campos de edición, datos de licitaciones y cualquier otro campo no listado.

## 3. Fuente, corte y política de evidencia

- Fuente declarada: `CRM-F1` — CRM comercial.
- `generated_at`: fecha de generación server-side.
- `source.as_of`: máximo `updated_at` visible dentro del alcance autorizado.
- Fecha de actividad: `last_interaction_at`; si falta, `updated_at`; si falta, `created_at`.
- `next_action_at` se conserva como evidencia de agenda, no como actividad realizada.
- “Sin datos” se conserva como `null`/estado explícito; nunca se convierte automáticamente en cero.
- Un valor de oferta `0` se mostrará como **“Valor no registrado”** para las reglas de valor; no activa ni desactiva la señal de alto valor.

## 4. Mappings funcionales propuestos

### Oportunidad activa

Toda oportunidad cuya etapa no sea terminal.

### Etapas activas

- `prospecto`
- `envio_oferta`
- `sustentacion`
- `negociacion`

### Etapas terminales

- `aprobado`
- `descartado`
- `perdido`

Las oportunidades terminales no son priorizables por Vig-IA V1.

### Etapas críticas

- `sustentacion`
- `negociacion`

Una etapa crítica agrega contexto y puntaje, pero no produce por sí sola una recomendación automática de cierre.

### Servicios

Se usa el catálogo oficial sin reagrupar códigos:

- `seguridad_fisica`
- `proyecto`
- `monitoreo`
- `porteria_virtual`
- `licitacion_publica`
- `mantenimiento`
- `escoltas`

`licitacion_publica` puede existir como tipo de servicio dentro del CRM, pero Vig-IA V1 no consulta ni mezcla datos del Radar de Licitaciones.

### Regional

Normalización solo para lectura/filtro:

1. `trim` de espacios.
2. Eliminación de puntos finales repetidos.
3. Comparación sin distinción de mayúsculas, minúsculas o tildes.
4. Alias ya vigentes: Bogotá/Distrito Capital de Bogotá → Bogotá; Medellín → Medellín; Antioquia → Antioquia; Eje Cafetero → Eje Cafetero; Risaralda → Risaralda; Valle del Cauca → Valle del Cauca.
5. No fusionar Pereira, Risaralda, Caldas o Quindío dentro de “Eje Cafetero” sin decisión adicional de Dirección Comercial.
6. Valor ausente → `Regional pendiente`.

## 5. Fórmulas y umbrales propuestos

### Ventanas

- Estancamiento preventivo: **14 días** sin actividad.
- Estancamiento crítico: **30 días** sin actividad.
- Cierre cercano: fecha esperada entre hoy y los próximos **14 días**, inclusive.
- Cierre vencido: `expected_close_date` anterior a hoy.
- Gestión vencida: `next_action_at` anterior a hoy.
- Alto valor: `offer_value >= $75.000.000 COP`.

Justificación del alto valor: aproxima el P90 de las oportunidades activas con valor positivo y genera un conjunto manejable (9 oportunidades en el corte), sin tratar los 138 valores cero como oportunidades pequeñas.

### Pesos determinísticos

Las señales de la misma familia son mutuamente excluyentes; se aplica solo la de mayor severidad.

| Señal | Puntos |
|---|---:|
| Sin próxima acción | 25 |
| Próxima acción vencida | 30 |
| Estancamiento preventivo (14–29 días) | 15 |
| Estancamiento crítico (30+ días) | 30 |
| Etapa crítica | 15 |
| Cierre esperado vencido | 25 |
| Cierre cercano (0–14 días) | 10 |
| Alto valor | 15 |
| Valor no registrado | 10 |
| Regional pendiente | 5 |

Reglas de no duplicación:

- `Sin próxima acción` y `Próxima acción vencida` no se suman.
- `Estancamiento preventivo` y `Estancamiento crítico` no se suman.
- `Cierre esperado vencido` y `Cierre cercano` no se suman.
- “Valor no registrado” es señal de calidad de datos; no equivale a bajo valor.

### Niveles

- **Alto:** score ≥ 60.
- **Medio:** score 30–59.
- **Bajo:** score 1–29.
- **Sin prioridad:** score 0 o etapa terminal.

El score ordena revisión; no predice probabilidad de venta ni modifica la probabilidad oficial de la etapa.

## 6. Recomendaciones permitidas

Vig-IA puede sugerir únicamente acciones de revisión humana, por ejemplo:

- Programar próxima gestión.
- Revisar gestión vencida.
- Validar bloqueo de una oportunidad estancada.
- Revisar fecha esperada de cierre.
- Completar valor o regional faltante.
- Priorizar revisión gerencial de una oportunidad crítica o de alto valor.

Cada recomendación debe mostrar:

- oportunidad;
- responsable;
- nivel y score;
- regla(s) activada(s);
- evidencia y fecha observada;
- fuente `CRM-F1`;
- fecha de corte;
- texto: **“Requiere validación humana; no ejecuta acciones.”**

## 7. Feedback humano V1

Estados locales permitidos:

- `Pendiente`
- `Revisada`
- `Útil`
- `No útil`

Condiciones:

- Solo estado local de la sesión (`useState`); no backend y no `sessionStorage` en V1.
- Se pierde al recargar.
- No modifica score, CRM, responsable, agenda ni oportunidad.
- No genera auditoría productiva porque no existe escritura en este corte.

## 8. Gobierno, permisos y navegación

- Bearer Supabase obligatorio.
- Permiso explícito `modulo_vig_ia` obligatorio y sujeto al techo del rol.
- Gerencia/admin: alcance global.
- Director con área comercial: únicamente dueños dentro de sus asignaciones server-side.
- Comercial/colaborador: no se habilita Vig-IA por permiso forjado si el techo del rol no lo permite.
- La denegación ocurre antes de consultar oportunidades.
- CTA de prioridad → `#/dashboard2` existente con filtro aplicado.
- CTA individual → detalle existente y nuevamente autorizado por backend.
- No se crea dashboard paralelo y no se duplican KPIs.

## 9. Límites no negociables del corte

Fuera de alcance:

- Radar de Licitaciones, SECOP, TVEC o ESU.
- SharePoint, F3A y runtime institucional de agentes.
- IA generativa o interpretación libre de texto.
- Crear, editar o reasignar oportunidades.
- Registrar interacciones, agendas o comunicaciones.
- Persistir feedback o configuración.
- Migraciones de base de datos.
- Despliegue sin autorización explícita posterior.

## 10. Decisión

- **APROBADO Gate 0 v1.0** — implementación local con TDD y despliegue autorizado para validación en vivo.
- Vig-IA permanece sin migraciones y sin escrituras productivas en este corte.

**Aprobación:** aprobada.
**Aprobado por:** Juan Botero.
**Fecha de aprobación:** 2026-07-18.
