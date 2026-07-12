# QA navegación — Plataforma CRM / SIIO Gerencial — Reporte v1

Fecha: 2026-07-12
Preview evaluado: `https://seguridad-nacional-1j6c9scf3-jmb-maxs-projects.vercel.app`
Ruta foco inicial: `#/siio`

## 1. Loop QA definido

**Goal:** revisar detenidamente que la navegación de la plataforma, pestañas y botones sea útil y entendible.

**Doer:** Hermes.

**Checker principal:** mecánico/read-only:
- inventario desde código,
- build,
- HTTP 200,
- consola JS,
- navegador/snapshot,
- conteos Supabase,
- matriz de rutas/botones.

**Auditor externo:** no requerido todavía. Solo sería necesario para decisiones mayores de arquitectura, seguridad, dominio, UX estratégica final, documentos cliente o cambios productivos.

**Límite:** no producción, no merge a main, no cambios destructivos, no correos/documentos cliente, no acciones irreversibles.

**Stop condition:** dejar inventario + QA pre-login + matriz autenticada para validar con Juan/equipo.

---

## 2. Estado confirmado

### Build / deploy
- Branch: `feature/siio-f2-mvp`.
- Última preview activa para QA:
  `https://seguridad-nacional-1j6c9scf3-jmb-maxs-projects.vercel.app`
- Build local pasó en el loop anterior.
- API SIIO protegida: `/api/siio/bootstrap` devuelve `401` sin sesión, correcto.

### Pre-login SIIO
Ruta probada:
`#/siio`

Resultado visual:
- Título navegador: `SIIO Gerencial | Plataforma PSI`.
- Pantalla muestra:
  - `PLATAFORMA PSI`
  - `Ingreso a SIIO Gerencial`
  - Texto: `Ingresa con tu usuario autorizado para revisar control gerencial, fuentes, decisiones y junta.`
- Botones visibles:
  - `Ingresar`
  - `Olvidé mi clave`
- Consola JS: sin errores.

Evaluación:
- ✅ Ya no comunica “CRM Comercial” en el pre-login de SIIO.
- ✅ El propósito gerencial se entiende mejor.
- ⚠️ Falta probar post-login para verificar sidebar, pestañas internas y flujo real.

---

## 3. Inventario de rutas detectadas

Rutas principales del frontend:

| Ruta | Propósito probable | QA requerido |
|---|---|---|
| `#/dashboard2` | Dashboard gerencial comercial actual | Revisar si se confunde con SIIO Gerencial |
| `#/siio` | SIIO Gerencial | Foco principal |
| `#/alerts` | Alertas comerciales | Validar filtros y lectura |
| `#/opportunities` | Oportunidades | Validar tabla, filtros, edición |
| `#/tenders?view=radar` | Radar licitaciones | Validar subnavegación y acciones |
| `#/tenders?view=seguimiento` | Seguimiento licitaciones | Validar claridad |
| `#/tenders?view=expedientes` | Expedientes licitaciones | Validar flujo documentos |
| `#/tenders?view=perfiles` | Perfiles búsqueda | Validar botones guardar/aplicar/eliminar |
| `#/vig-ia` | Vig-IA reportes gerenciales | Validar si nombre/ubicación se entiende |
| `#/new` | Crear oportunidad | Validar formulario |
| `#/goals` | Metas y cumplimiento | Validar enfoque comercial |
| `#/users` | Usuarios y permisos | Validar rol admin |
| `#/detail/:id` | Detalle oportunidad | Validar botones y acciones sensibles |
| `#/edit/:id` | Editar oportunidad | Validar permisos/cambios |

---

## 4. Inventario inicial de botones/acciones críticos

### Shell general
- `Actualizar datos`
- `Cerrar sesión`
- `Nueva oportunidad` — oculto ya en ruta `#/siio`, correcto.

### Login
- `Ingresar`
- `Olvidé mi clave`

### SIIO Gerencial
Tabs internas detectadas:
- `Inicio`
- `Frentes`
- `Registro gerencial`
- `Decisiones/Bloqueos`
- `Fuentes F4`
- `Junta mensual`

Botón sensible:
- `Generar borrador del mes`

QA necesario:
- Ver si cada tab tiene contenido útil.
- Ver si los nombres son entendibles para gerencia.
- Confirmar si `Generar borrador del mes` debe pedir confirmación antes de escribir datos.

### Licitaciones
Botones/acciones relevantes:
- `Sincronizar fuentes oficiales`
- `Recargar vista`
- `Crear oportunidad`
- `En revisión`
- `Descartar`
- `Importar/Reintentar documentos oficiales`
- `Analizar documentos`
- `Aprobar preparación de oferta`
- `Guardar nota para el asistente`

QA necesario:
- Clasificar cuáles son read-only vs escritura vs externo/SharePoint.
- Para acciones SharePoint/oficiales aplicar política: auditoría + aprobación humana.

### Oportunidades / CRM comercial
Botones/acciones:
- `Crear oportunidad`
- `Guardar cambios`
- `Editar`
- `Sacar de oportunidad`
- `Guardar seguimiento`
- `Limpiar`
- filtros y ordenamientos de tablas.

QA necesario:
- Verificar que navegación no obligue a entender el CRM comercial para usar SIIO.
- Revisar botones peligrosos y permisos.

### Usuarios / permisos
Botones:
- `Guardar usuario` / `Actualizar usuario`
- `Editar`

QA necesario:
- Solo admin.
- Confirmar labels y efectos antes de cambios.

---

## 5. Hallazgos iniciales

### H1 — Riesgo de confusión “Dashboard gerencial” vs “SIIO Gerencial”
**Severidad:** Media  
**Categoría:** UX / Navegación

Hay dos conceptos que pueden sonar parecidos:
- `Dashboard gerencial` actual del CRM comercial.
- `SIIO Gerencial`.

Riesgo: Juan/equipo puede interpretar que ambos son lo mismo o que SIIO es solo una pestaña más del dashboard comercial.

Recomendación:
- En navegación futura separar por grupos:
  - `Gerencia`: SIIO Gerencial
  - `Comercial`: Dashboard comercial, Alertas, Oportunidades, Metas
  - `Licitaciones`: Radar, Seguimiento, Expedientes, Perfiles
  - `Administración`: Usuarios

### H2 — Pre-login SIIO ya comunica bien, pero falta post-login
**Severidad:** Baja  
**Categoría:** UX

Pre-login ya dice `Ingreso a SIIO Gerencial`, no CRM comercial. Falta validar después del login si sidebar/topbar siguen consistentes.

### H3 — Botones sensibles mezclados con botones simples
**Severidad:** Media  
**Categoría:** UX / Seguridad operativa

Hay botones de distinto riesgo visualmente parecidos:
- acciones simples: filtros, limpiar, recargar,
- escrituras internas: guardar seguimiento, crear oportunidad,
- acciones sensibles: sincronizar fuentes oficiales, importar documentos, aprobar preparación de oferta, generar borrador mensual.

Recomendación:
- Clasificar visualmente acciones:
  - secundarias/read-only,
  - escritura interna,
  - acción sensible/oficial.
- Agregar confirmación a acciones sensibles.

### H4 — QA autenticado es el siguiente bloqueo real
**Severidad:** Alta para continuar QA  
**Categoría:** Bloqueo operativo

Sin sesión real no se puede validar navegación completa ni botones internos.

Usuario validado para acceso:
- `juanbotero@premiumsecurity.ai`
- rol: `admin`

---

## 6. Matriz QA autenticado propuesta

Cuando Juan/equipo entre con sesión:

### A. Navegación principal
1. Login en `#/siio`.
2. Confirmar que cae en SIIO, no dashboard comercial.
3. Revisar sidebar completo.
4. Ver si cada pestaña tiene nombre claro.
5. Identificar dónde se siente “comercial” y dónde se siente “gerencial”.

### B. SIIO Gerencial
1. Tab `Inicio`.
2. Tab `Frentes`.
3. Tab `Registro gerencial`.
4. Tab `Decisiones/Bloqueos`.
5. Tab `Fuentes F4`.
6. Tab `Junta mensual`.
7. Probar `Generar borrador del mes` solo si Juan aprueba, porque escribe en base de datos.

### C. Comercial
1. `Dashboard gerencial` actual.
2. `Alertas comerciales`.
3. `Oportunidades`.
4. `Metas y cumplimiento`.
5. `Crear oportunidad`.
6. Confirmar si esos nombres deben decir explícitamente “Comercial”.

### D. Licitaciones
1. Radar.
2. Seguimiento.
3. Expedientes.
4. Perfiles.
5. Botones sensibles deben revisarse con cuidado:
   - sincronizar fuentes,
   - importar documentos,
   - analizar documentos,
   - aprobar preparación.

### E. Administración
1. Usuarios y permisos.
2. Confirmar si el admin entiende qué cambia antes de guardar.

---

## 7. Recomendación de siguiente iteración

No empezaría rediseñando todo. Primero haría una mejora estructural pequeña:

### Iteración recomendada: “Navegación agrupada por dominios”

Convertir el menú lateral de lista plana a grupos:

```text
Gerencia
  SIIO Gerencial

Comercial
  Dashboard comercial
  Alertas comerciales
  Oportunidades
  Crear oportunidad
  Metas y cumplimiento

Licitaciones
  Radar
  Seguimiento
  Expedientes
  Perfiles de búsqueda

Administración
  Usuarios y permisos
```

Motivo:
- Reduce confusión.
- Deja SIIO como gerencial sin sacarlo todavía del repo/app.
- Hace la navegación más entendible para nuevos usuarios.

---

## 8. Próximo paso

Pedir a Juan que entre con `juanbotero@premiumsecurity.ai` en la preview actual y revise `#/siio`.

URL:
`https://seguridad-nacional-1j6c9scf3-jmb-maxs-projects.vercel.app/?x-vercel-set-bypass-cookie=true&x-vercel-protection-bypass=IO4EkxwopgsO6PI028MzXOWyegeTV3XK#/siio`

Después de eso:
- capturar feedback de navegación real,
- hacer cambios de agrupación del sidebar,
- volver a correr build/deploy/checker.
