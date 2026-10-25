# ADR 2026-10-24 — Fronteras técnicas del repositorio del SIIO

**Estado:** `propuesto`. Requiere aprobación de Juan Botero.
**Fecha:** 2026-10-24 · **Decisiones de:** Juan Botero, conversación de arquitectura del 2026-10-24.
**Ámbito:** repositorios, carpetas, esquemas, migraciones, acceso a datos y trabajos largos.

## Qué decide este ADR y qué no

Este documento cubre **sólo lo que amarra código**. El mapa institucional —qué aplicaciones existen,
quién es dueño de cada dato, dónde vive cada agente y cómo entra lo nuevo— es documentación
institucional y vive en el SharePoint de Innovación, en
`06_Productos_PSI/SIIO/00 Dirección y Gobierno/ADR-008-mapa-de-aplicaciones-y-fronteras-de-despliegue.md`,
donde están los demás ADR del SIIO.

Este ADR **no** cambia estados institucionales, dueños ni definiciones de agentes, y es consistente
con el ADR-005 institucional (`Aceptado/Vigente`): arquitectura agent-first, Plataforma Agentes como
plano de control, SecurityOps como sistema fuente de la operación y ARA Control Tower como capa de
torre de control. Tampoco decide el plan ni el cronograma del traslado a AWS, que se maneja aparte.

## Contexto medido (commit `6458eaf`, 2026-10-24)

- **278 archivos `.js` en la raíz**: 167 `agt002-`, 56 `tender-`, 27 `agt003-`, 7 `siio-`,
  5 `platform-`, 2 `vigia-`. Licitaciones es el 80% del código.
- AGT-001 y AGT-004 **no tienen prefijo propio**: viven como `siio-*` y `src/siio/`.
- El backend está **duplicado byte a byte**: `server/index.js` y `api/[...path].js`, 8.757 líneas cada
  uno, con `scripts/check_backend_parity.mjs` obligándolos a ser idénticos.
- Acceso a datos: **287 `.from()`**, **44 `.rpc()`**, **48 `storage.from()`** con 8 `createSignedUrl`,
  y **7 migraciones** que dependen de `auth.uid` / `auth.users` / `auth.jwt`.
  `@supabase/supabase-js` es el único cliente de base en `dependencies`.
- **149 migraciones en una sola carpeta numerada**: el 2026-10-24 dos agentes chocaron el mismo número
  (PR #427).
- **878 archivos de prueba**; la suite completa no se puede correr entera en el contenedor.
- Acoplamiento real entre verticales: **siete** módulos de licitaciones escriben en
  `psi_sales_opportunities`; `siio-followups.js` y `siio-commercial-summary.js` leen `psi_tender_*`;
  `access-control.js` lo importan las API de las dos verticales y la UI.
- Hoy: base en Supabase y despliegue en Vercel; Programación desplegada en Amplify.
  **Destino declarado: AWS**, base y despliegue.

## Decisiones

### T1 — Un repositorio por aplicación, no por agente

| Repositorio | Aplicación | Decisión |
| --- | --- | --- |
| `sn-crm-comercial` | SIIO | único repo del SIIO; una carpeta por vertical adentro |
| `programacion-personal` | Programación | se absorbe en el repo del SIIO cuando haya una sola sesión y una sola navegación; su conector Odoo se muda con ella |
| repo de SecurityOps | SecurityOps | repo aparte: otra aplicación, otro dueño |
| `ara-control-tower-ct01` | Control Tower | repo del producto; un tenant por cliente, nunca un repo por cliente |
| `plataforma-agentes` | Plataforma Agentes | repo aparte; recibe la puerta de modelos que hoy corre en el CRM |

Fuera del mapa: `agente-it` (sin commits desde 2026-07-18; decidir archivo),
`seguridad-nacional-crm` de la cuenta personal (respaldo histórico) y los proyectos de la cuenta
personal de Vercel.

**Licitaciones no sale a repositorio propio.** Comparte la tabla de oportunidades y el control de
acceso con comercial; tres repositorios sobre una sola base no quitan ese acoplamiento, lo convierten
en un contrato entre repositorios y agregan el riesgo de DDL descoordinado sobre tablas compartidas.

### T2 — Una carpeta por vertical, con su prefijo de rutas y su módulo de acceso a datos

Las verticales son gerencial, comercial, licitaciones y administración. Ninguna vertical le habla
directo al cliente de la base: toda consulta pasa por el módulo de acceso de su vertical. Lo
compartido de verdad —control de acceso, identidad, catálogo de fuentes— queda en un lugar común y
explícito, no implícito en la raíz.

### T3 — Migraciones con espacio de nombres por vertical, dueño por carpeta y pruebas por vertical

- El choque de números del PR #427 es consecuencia de una sola carpeta numerada: cada vertical numera
  dentro de su espacio.
- Dueño declarado por carpeta, para que dos agentes no se pisen el mismo día.
- Pruebas por vertical, porque la suite completa no corre entera.

### T4 — Vertical nueva: esquema propio en la base del SIIO, nunca base nueva

Base nueva sólo cuando es otra aplicación, como la Plataforma, que tiene la suya. Programación ya es
el ejemplo correcto: esquema `programacion` en la base del SIIO, con el CRM administrando el acceso.

### T5 — El backend es un módulo con dos puntos de entrada, no dos archivos idénticos

La duplicación byte a byte sostenida por un chequeo de paridad es el síntoma, no la solución: la
lógica vive en módulos y `server/index.js` y `api/[...path].js` quedan como adaptadores de entrada.

### T6 — Nada que tarde más que unos segundos corre dentro de la petición

Va como trabajo con recibo, como ya están los workers de AGT-002 y los puentes. El límite de 29 s de
API Gateway no es un problema del proveedor: es el recordatorio de que el análisis de licitaciones, el
chat y los briefs necesitan minutos.

### T7 — Destino AWS: qué hay que proteger desde hoy

- **Capa de acceso a datos por vertical** (T2): las 331 llamadas PostgREST sueltas son el costo real
  del traslado, porque en RDS o Aurora no hay PostgREST. Si el día del traslado hay que tocar 331
  sitios, el traslado es una reescritura.
- **La identidad no se traslada, se reemplaza.** Las políticas RLS son Postgres puro y sobreviven;
  `auth.uid()` no. El proveedor de identidad debe decidirse **antes** de cortar esquemas nuevos,
  porque cada esquema escribe sus políticas contra esa función.
- **Lo portable se deja portable:** esquemas, funciones y migraciones son Postgres; los trabajos con
  recibo ya corren fuera de la petición; Storage con URL firmada tiene equivalente directo en S3
  (48 llamadas, mecánico).

## Consecuencias

- Ninguna de estas decisiones está ejecutada. Este ADR no mueve, renombra ni borra un archivo.
- La salida de una vertical a su propio repositorio queda pagada por anticipado con T2, T3 y T4: el
  día que se gradúe es una mudanza, no una reescritura.
- T1 implica, cuando Juan lo autorice, mover `platform-model-gateway.js` y `platform-model-usage.js`
  al repositorio de la Plataforma: hoy el plano de control está partido entre el CRM y la base de la
  Plataforma.

## Puntos abiertos

| # | Punto | Dueño |
| --- | --- | --- |
| 1 | Proveedor de identidad en AWS, antes de cortar esquemas nuevos | Juan / IT |
| 2 | ¿Se renombra `sn-crm-comercial` a `siio`? Es cosmético y rompe remotos | Juan |
| 3 | ¿Se archiva `agente-it`? | Juan / IT |
| 4 | Orden de ejecución de T2 y T3, que es lo único que toca código | Juan |

## Fuentes

- Commit `6458eaf05cf53c8212e2d19ed0a7df8117227d84`; conteos con `ls`, `wc`, `grep` y
  `diff server/index.js api/[...path].js` (vacío).
- Handoff de esta decisión: `/root/handoffs/2026-10-24-AGT-003-arquitectura-mapa-de-aplicaciones.md`.
- Inventario medido: `/root/handoffs/2026-10-24-AGT-003-arquitectura-general-inventario.md`.
- ADR-005 institucional, SharePoint `06_Productos_PSI/SIIO/00 Dirección y Gobierno`.
- `docs/architecture/agent-ecosystem-map.md` y `docs/architecture/agent-decision-registry.md`.

Sin secretos en este documento.
