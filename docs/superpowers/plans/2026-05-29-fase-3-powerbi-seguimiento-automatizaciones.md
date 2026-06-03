# Fase 3 — Power BI, seguimiento comercial y automatizaciones

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task if execution is delegated. For direct execution, keep TDD/static checks and production verification after each deployable slice.

**Goal:** Convertir el MVP comercial de Seguridad Nacional en una herramienta operativa de seguimiento con reportería ejecutiva lista para Power BI y alertas accionables.

**Architecture:** Mantener Supabase/PostgreSQL como fuente principal. La app React/Vite + Express sigue como capa operativa; Power BI queda como capa gerencial; automatizaciones por correo/Teams se preparan primero con endpoints/datos y se activan cuando IT habilite Graph/SMTP/Teams.

**Tech Stack:** React, TypeScript, Vite, Express, Supabase JS, PostgreSQL views, Vercel, Power BI Desktop/Service.

---

## Estado verificado antes del plan

- `ConsultantDetail` ya existe en `src/main.tsx` y ya muestra una tabla "Oportunidades del consultor".
- `next_action_at` ya existe en el tipo `Opportunity`, en el formulario de seguimiento y en `server/index.js` al registrar interacciones.
- La alerta actual `v_psi_sales_stalled_sustentacion` existe, pero solo cubre oportunidades en `sustentacion` sin gestión por más de 5 días.
- Existe documento base de Power BI: `/root/psi-comercial/plataforma-ventas/POWERBI_readiness_psi_sales_2026-05-28.md`.
- Para Power BI faltan vistas más ejecutivas: cumplimiento contra metas, alertas por próxima acción vencida/sin agendar, snapshot por consultor.

---

## Fase recomendada de ejecución

### Task 1: Mejorar vista de oportunidades por consultor

**Objective:** Convertir la sección actual "Oportunidades del consultor" en una vista realmente usable con filtros, ordenamiento visual y acciones directas.

**Files:**
- Modify: `src/main.tsx` — `ConsultantDetail`
- Modify: `src/styles.css` — estilos de filtros/tabla/alertas
- Test: `tests/consultant-detail-static.test.mjs`

**Steps:**
1. Agregar estado local en `ConsultantDetail` para filtros: etapa, texto, solo activas, próximas acciones.
2. Derivar `filteredOpportunities` desde `opportunities`.
3. Cambiar botón "Ver listado general" por un bloque de filtros dentro del consultor.
4. Agregar columnas: `Próxima acción`, `Días sin seguimiento`, `Prioridad`.
5. Mantener click en fila hacia `#/detail/:id`.
6. Actualizar test estático con markers: `consultant-opportunity-filters`, `filteredOpportunities`, `next_action_at`.
7. Ejecutar test + build.

**Verification:**
```bash
node tests/consultant-detail-static.test.mjs && npm run build
```

---

### Task 2: Robustecer próxima acción / fecha de seguimiento

**Objective:** Hacer que `next_action_at` sea visible, editable y accionable desde oportunidad y consultor.

**Files:**
- Modify: `src/main.tsx` — `OpportunityForm`, `FollowUpForm`, `Detail`, `ConsultantDetail`
- Modify: `server/index.js` and `api/[...path].js` if endpoint aliases need parity
- Test: `tests/feedback-fixes-static.test.mjs` or new `tests/next-action-static.test.mjs`

**Steps:**
1. Verificar que `OpportunityForm` ya guarda `next_action_at` en crear/editar.
2. En `FollowUpForm`, mantener campo de próxima acción, pero mejorar copy: "Programar próxima gestión".
3. En detalle de oportunidad, mostrar estado: vencida / hoy / próxima / sin agenda.
4. En `ConsultantDetail`, resaltar próximas acciones vencidas o sin agenda.
5. Crear helper `nextActionStatus(o)` para evitar repetir lógica.
6. Crear test estático para helper/markers.
7. Ejecutar test + build.

**Verification:**
```bash
node tests/next-action-static.test.mjs && npm run build
```

---

### Task 3: Crear vistas SQL Power BI ejecutivas

**Objective:** Dejar Supabase listo para Power BI con vistas limpias, sin depender de lógica del frontend.

**Files:**
- Create: `002_powerbi_reporting_views_psi_sales.sql`
- Modify: `POWERBI_readiness_psi_sales_2026-05-28.md`

**Views propuestas:**
1. `v_psi_sales_powerbi_executive_summary`
   - pipeline total
   - forecast ponderado
   - aprobado
   - oportunidades activas
   - vencidas/sin próxima acción
2. `v_psi_sales_powerbi_commercial_performance`
   - comercial
   - pipeline
   - aprobado
   - forecast
   - conversión
   - oportunidades activas
   - oportunidades sin próxima acción
3. `v_psi_sales_powerbi_goal_compliance_monthly`
   - metas vs realizado por asesor/mes
   - cumplimiento ventas/prospectos/cotizaciones
4. `v_psi_sales_powerbi_action_alerts`
   - oportunidad
   - comercial
   - etapa
   - última interacción
   - próxima acción
   - estado alerta: vencida / sin agenda / estancada

**Steps:**
1. Escribir SQL con `create or replace view`.
2. Validar con Supabase SQL editor o script de conexión existente.
3. Actualizar documento Power BI con nueva lista de vistas.
4. Recomendar usuario de solo lectura para Power BI.

**Verification:**
```sql
select count(*) from v_psi_sales_powerbi_action_alerts;
select * from v_psi_sales_powerbi_commercial_performance limit 10;
```

---

### Task 4: Preparar automatizaciones sin depender todavía de IT

**Objective:** Dejar reglas y datos listos para alertas; activar canales cuando IT confirme correo/Teams.

**Files:**
- Create: `AUTOMATIZACIONES_comerciales_2026-05-29.md`
- Optional Create: `scripts/check-commercial-alerts.mjs`

**Alertas sugeridas:**
1. Oportunidad con próxima acción vencida.
2. Oportunidad activa sin próxima acción.
3. Oportunidad en sustentación sin seguimiento > 5 días.
4. Comercial bajo 80% de cumplimiento acumulado.

**Steps:**
1. Documentar reglas exactas.
2. Definir destinatarios por alerta: comercial, gerente, CEO.
3. Preparar consulta SQL base por alerta.
4. No enviar correos todavía hasta confirmar canal IT.

**Verification:**
- Documento con reglas listo.
- Consultas devuelven filas esperadas.

---

## Orden recomendado

1. **Vista de oportunidades por consultor** — impacto inmediato en CRM, no depende de IT.
2. **Próxima acción / seguimiento** — vuelve accionable la gestión diaria.
3. **Vistas Power BI** — deja la capa gerencial lista para publicación.
4. **Automatizaciones** — preparar reglas ahora; envío real cuando IT confirme Graph/Teams/SMTP.

## Decisión pendiente

Antes de activar envíos automáticos, definir canal oficial:

- Teams: ideal para alertas internas y gerencia.
- Correo: útil para resumen diario/semanal.
- Ambos: mejor para fase productiva, pero requiere permisos IT.
