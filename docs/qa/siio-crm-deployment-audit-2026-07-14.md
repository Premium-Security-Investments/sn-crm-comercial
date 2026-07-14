# Auditoría de cierre — CRM Comercial + SIIO + despliegue

**Fecha de corte:** 2026-07-14  
**Repositorio:** `Premium-Security-Investments/sn-crm-comercial`  
**Producción:** `https://seguridad-nacional-crm.vercel.app`  
**PR SIIO:** [#12 · feat: integrate SIIO F1-F6 with current CRM main](https://github.com/Premium-Security-Investments/sn-crm-comercial/pull/12)  
**Rama SIIO auditada:** `feature/siio-main-integration`  
**HEAD auditado:** `d1f105242296bd57fd762cc099610aad9770ee86`  
**`main`/producción auditado:** `937aed57b75fb467b7f078537ba0dd4f8b9b8073`

## 1. Objetivo

Verificar mecánicamente:

1. el estado real del CRM comercial en producción;
2. el estado de la integración SIIO en preview;
3. la salud de Git, pruebas y builds;
4. el estado real de Supabase;
5. si la implementación sigue la arquitectura F1–F6 acordada;
6. qué brechas deben resolverse antes de llevar SIIO a producción;
7. cuál debe ser el punto exacto de reinicio el 2026-07-15.

No se realizó merge, deploy productivo ni escritura adicional en Supabase durante esta auditoría.

---

## 2. Dictamen ejecutivo

### Resultado general: **AVANCE REAL, PERO INTEGRACIÓN AÚN NO LISTA PARA PRODUCCIÓN**

La dirección propuesta sí se está siguiendo:

- F1 continúa como CRM comercial operativo;
- F2 ya tiene un Dashboard Gerencial permanente, separado conceptualmente del informe de Junta;
- F4 registra fuentes, restricciones y trazabilidad;
- F5 aplica reglas determinísticas auditables;
- F6 tiene catálogo gobernado de agentes;
- la nómina se mantiene agregada, sin nombres, cédulas ni salarios individuales;
- las acciones sensibles tienen confirmaciones y revisión humana declarada.

Sin embargo, el producto está dividido en tres estados distintos:

| Capa | Estado actual |
|---|---|
| CRM comercial | Desplegado en producción desde `main` |
| SIIO UI/API | Implementado en PR #12 y desplegado solo como preview protegido |
| Datos SIIO | Tablas y snapshot ya presentes en Supabase producción |

Todavía no existe una versión única que combine:

1. los arreglos QA del CRM comercial que ya llegaron a `main`;
2. la interfaz/API SIIO del PR #12;
3. la nomenclatura completa F1–F6 en base de datos;
4. las decisiones arquitectónicas más recientes sobre los agentes.

La prioridad para mañana no es agregar otro módulo. Es **reconciliar estas tres capas sin perder los arreglos QA de producción**.

---

## 3. Estado de Git y del PR #12

### 3.1. Rama SIIO

- Rama limpia y sincronizada con remoto.
- HEAD local = remoto: `d1f1052`.
- PR #12 abierto y en borrador.
- Diferencia contra `main`: **30 archivos**, **3.426 inserciones**, **29 eliminaciones**.

### 3.2. `main` avanzó después de crear la integración

`main` contiene el merge del PR #13:

```text
937aed5 fix: corregir hallazgos QA post-deploy (#13)
```

Ese cambio introdujo, entre otros:

- drawer móvil;
- eliminación de overflow horizontal;
- paginación de oportunidades;
- paginación y deduplicación del Radar;
- separación de Perfiles de búsqueda;
- normalización de regiones;
- filtrado de comerciales por rol;
- etiquetas de rol legibles;
- nueva prueba `qa-postdeploy-fixes-static.test.mjs`.

### 3.3. Estado de integración

GitHub reporta el PR #12 como:

```text
mergeable: CONFLICTING
mergeStateStatus: DIRTY
```

La simulación mecánica de merge detectó conflictos reales en:

- `src/main.tsx`: 4 regiones de conflicto;
- `src/styles.css`: 1 región de conflicto.

Los conflictos no son triviales porque enfrentan dos conjuntos de cambios que deben conservarse:

| Rama SIIO | `main` actual |
|---|---|
| Identidad visual SIIO, ruta, permisos y navegación gerencial | Drawer móvil y cierre de sidebar |
| Condición para ocultar “Nueva oportunidad” dentro de SIIO | Topbar móvil y botón de menú |
| Navegación SIIO por roles | Eventos de navegación que cierran el drawer |
| Estilos F2/F5/F6 | Estilos de paginación y responsive post-deploy |

**Conclusión:** no se debe resolver aceptando automáticamente “ours” o “theirs”. La resolución debe combinar ambos lados y luego repetir toda la QA.

---

## 4. Calidad técnica verificada

### 4.1. Rama SIIO `d1f1052`

| Verificación | Resultado |
|---|---:|
| Checkers de permisos y gobierno | PASS |
| Pruebas JavaScript | **34/34 PASS** |
| Pruebas Python del extractor | **3/3 PASS** |
| Build TypeScript + Vite | PASS |
| `git diff --check` | PASS |

Checkers ejecutados:

- navegación por roles;
- permisos backend;
- confirmaciones sensibles;
- confirmaciones de Licitaciones;
- contrato de frentes SIIO;
- snapshot ejecutivo;
- catálogo de agentes.

### 4.2. `main`/producción `937aed5`

| Verificación | Resultado |
|---|---:|
| Pruebas JavaScript | **33/33 PASS** |
| Build TypeScript + Vite | PASS |
| `git diff --check` | PASS |

### 4.3. Advertencias no bloqueantes

1. `package.json` no define un comando canónico `npm test`; las pruebas deben ejecutarse con:

   ```bash
   node --test tests/*.test.mjs
   ```

2. Ambos builds muestran bundle principal superior a 500 kB:

   - SIIO: aproximadamente 609 kB minificado;
   - `main`: aproximadamente 584 kB minificado.

Esto no bloquea el siguiente merge, pero conviene crear un script de prueba y planificar code splitting.

---

## 5. Estado de Vercel

### 5.1. Producción

```text
Deployment: dpl_7WhwMsRYCt4git7xHeqPGsmNZQTu
Estado: Ready
Target: production
Alias: https://seguridad-nacional-crm.vercel.app
```

Verificaciones:

- `/` responde HTTP 200;
- la pantalla de login carga correctamente;
- no se observaron problemas de legibilidad, alineación o overflow en el viewport de escritorio auditado;
- `/api/siio/bootstrap` responde 404;
- el build productivo expone únicamente `api/[...path]`.

Esto confirma que **SIIO todavía no está desplegado en producción**.

### 5.2. Preview SIIO

```text
Deployment: dpl_G7GSkZnmNVwUUjh95Z4w7TWGWfYk
Estado: Ready
Target: preview
URL: https://seguridad-nacional-qs8mn945f-jmb-maxs-projects.vercel.app
```

El preview incluye:

- `api/[...path]`;
- `api/siio/[...path]`.

Está protegido por autenticación de Vercel y el navegador anónimo fue redirigido a la página de acceso de Vercel. Por esa razón no se completó QA visual autenticado del SIIO durante esta auditoría.

### 5.3. Limitación de QA

El login público de producción se verificó visualmente, pero no se inició sesión porque no se usaron credenciales de usuario durante esta auditoría. El QA interno por roles continúa pendiente.

---

## 6. Estado real de Supabase

Se ejecutaron lecturas de conteo usando credenciales servidor, sin modificar datos.

| Tabla | Filas |
|---|---:|
| `siio_fronts` | 9 |
| `siio_sources` | 13 |
| `siio_gerencial_records` | 6 |
| `siio_decisions_commitments` | 0 |
| `siio_monthly_board_reports` | 0 |
| `siio_board_sections` | 15 |
| `siio_financial_metrics` | 9 |
| `siio_commercial_signals` | 0 |
| `siio_payroll_aggregates` | 12 |
| `siio_strategic_opportunities` | 67 |

### 6.1. Snapshot ejecutivo confirmado

**Finanzas — abril de 2026**

- 9 métricas cargadas;
- todas tienen `validated_by = null`;
- por tanto siguen pendientes de validación financiera;
- ingresos: `$51.845.041.733,93`;
- utilidad neta: `$1.266.594.904,78`;
- margen neto: `2,4430 %`.

**Nómina agregada — junio de 2026**

- 12 áreas;
- 157 personas;
- devengado agregado: `$589.005.147,00`;
- deducciones agregadas: `$80.418.102,88`;
- neto agregado: `$508.587.044,12`;
- 1 alerta de control en Agencia Medellín.

No se encontraron nombres, cédulas ni salarios individuales en la tabla agregada.

### 6.2. Seguridad de lectura

Una lectura directa usando la clave anónima retornó cero filas de `siio_financial_metrics`. Esto confirma que RLS no expone los datos SIIO anónimamente. La API servidor usa autorización de aplicación por rol.

### 6.3. Migraciones

- Fundación equivalente a migración 014: presente.
- Snapshot equivalente a migración 016: presente.
- Nomenclatura oficial de migración 015: **no reflejada completamente en los datos**.

Los registros actuales de `siio_fronts` aún usan nombres genéricos como `F1`, `F2`, `F3`, y no existe la desagregación completa F3A–F3F.

Adicionalmente existen IDs heredados:

- `SIIO`;
- `Sistema-general`.

La migración 015 disponible solo llega hasta F3A/F3B; tampoco representa todavía F3C, F3D, F3E y F3F aprobados después.

---

## 7. Comparación arquitectura propuesta vs. implementación

### 7.1. F1 — Gestión Comercial Inteligente

**Estado: OPERATIVO EN PRODUCCIÓN**

Implementado:

- CRM de oportunidades;
- pipeline y forecast;
- metas y cumplimiento;
- alertas comerciales;
- Vig-IA en modo lectura/priorización;
- Radar de Licitaciones;
- análisis documental;
- perfil corporativo/RUP;
- evaluación GO/NO GO;
- expediente de oferta;
- usuarios y permisos;
- confirmaciones de acciones sensibles.

Los arreglos del PR #13 mejoraron responsive, paginación, deduplicación, perfiles de Radar y filtros por rol.

Brechas:

- KAM/expediente completo del cliente aún no está desarrollado según la arquitectura futura;
- las señales F1 no se han materializado en `siio_commercial_signals`;
- el Dashboard Gerencial SIIO todavía no cruza automáticamente el pipeline real con finanzas.

### 7.2. F2 — Gestión Gerencial y Control

**Estado: PILOTO FUNCIONAL EN PREVIEW, AUSENTE EN PRODUCCIÓN**

Implementado en PR #12:

- centro de control permanente;
- KPIs financieros;
- nómina agregada;
- validación financiera visible;
- registros gerenciales;
- decisiones/bloqueos/riesgos;
- vigencia de fuentes;
- Modo Junta como vista separada;
- carga mediante `/api/siio/bootstrap`.

Punto positivo: la UI no usa un fixture estático. Consume el API SIIO y deriva el snapshot desde datos obtenidos de Supabase.

Brechas:

- `siio_decisions_commitments` no tiene registros;
- `siio_commercial_signals` no tiene registros;
- los 67 registros de `siio_strategic_opportunities` se cargan en bootstrap, pero la UI no los representa;
- la información de fuentes no tiene fechas de revisión o próxima revisión;
- falta QA autenticado por roles.

### 7.3. F3 — Gestión Operativa

**Estado: ARQUITECTURA/REGISTROS, NO MÓDULOS OPERATIVOS**

Existe:

- un registro F3B de reclutamiento en control gerencial;
- menciones de F3A/F3B en la interfaz;
- estructura de base genérica.

No existen todavía módulos funcionales para:

- F3A personal activo y operación diaria;
- F3B reclutamiento/selección/contratación;
- F3C riesgos;
- F3D PQR/calidad/satisfacción;
- F3E capacitación;
- F3F servicio técnico/evidencias.

La interfaz tampoco menciona F3C–F3F. Esto es coherente con una implementación progresiva, pero debe describirse como “planificado”, no “construido”.

### 7.4. F4 — Archivo Corporativo Inteligente

**Estado: INVENTARIO FUNCIONAL INICIAL**

Implementado:

- 13 fuentes registradas;
- tipo, confianza, restricciones, estado y frentes relacionados;
- fuentes sensibles marcadas como restringidas;
- referencia histórica de Junta marcada como no-fuente de verdad.

Brechas:

- no es todavía un gestor documental;
- no administra versiones, carga, archivo, checksum o aprobación desde la interfaz;
- propietarios, revisiones y vigencia están incompletos;
- varios `related_fronts` heredados están almacenados como un solo string dentro del arreglo, no como códigos normalizados separados.

### 7.5. F5 — Motor Interno de Razonamiento

**Estado: PILOTO DETERMINÍSTICO REAL**

Reglas implementadas:

1. validación financiera pendiente;
2. costos creciendo más que ingresos;
3. deterioro no operacional;
4. diferencia de control en nómina.

Fortalezas:

- reglas auditables;
- evidencia y acción recomendada;
- no modifica datos;
- no aprueba decisiones;
- no usa texto generativo opaco;
- no emite lecturas sin evidencia.

Brechas:

- todavía solo cruza finanzas y nómina;
- no consume señales comerciales, riesgos, PQR, operación ni histórico;
- no persiste las lecturas emitidas para auditoría temporal;
- el API tolera silenciosamente tablas faltantes devolviendo arreglos vacíos, lo cual evita caídas pero puede ocultar una migración incompleta.

### 7.6. F6 — Catálogo Institucional de Agentes

**Estado: CATÁLOGO GOBERNADO EN CÓDIGO, REQUIERE ACTUALIZACIÓN DE DECISIÓN**

Fortalezas:

- propósito y responsable por agente;
- estado honesto;
- fuentes y frentes autorizados;
- acciones permitidas/prohibidas;
- revisión humana obligatoria;
- escritura automática en producción deshabilitada;
- auditoría y siguiente gate;
- validador determinístico.

Brecha arquitectónica confirmada:

El código todavía contiene cuatro agentes:

1. AGT-001 Agente Gerencial SIIO;
2. AGT-002 Copiloto de Licitaciones;
3. AGT-003 Vig-IA Comercial;
4. AGT-004 Asistente de Junta.

La decisión posterior aprobada fue consolidar Junta como **Modo Junta del AGT-001**, no como agente separado. Por tanto, el catálogo, su checker, la prueba y la documentación F6 deben actualizarse antes del merge.

El catálogo está hardcodeado en `src/siioAgents.ts`; aún no tiene tabla administrativa propia.

---

## 8. Revisión de permisos y acciones sensibles

### Correcto

- Frontend: SIIO solo visible para `admin`, `gerencia` y `director`.
- Backend: todos los endpoints SIIO llaman `requireSiioAccess`.
- Comercial no tiene acceso a SIIO.
- Junta requiere confirmación visual antes de generar borrador.
- RLS impide lectura anónima.

### Pendiente de endurecer

Se usa la misma regla `canAccessSiio` para leer y para escribir:

- crear/editar registros F2;
- crear/editar decisiones;
- registrar fuentes;
- generar borrador de Junta.

Eso significa que todo `director` con acceso de lectura también tiene acceso backend de escritura. Además, la confirmación de Junta existe en la UI, pero una llamada directa al endpoint puede omitir `window.confirm`.

Antes de producción deben separarse capacidades, por ejemplo:

- `canReadSiio`;
- `canManageSiioRecords`;
- `canManageSiioSources`;
- `canGenerateBoardDraft`;
- `canApproveBoardOutput`.

Conteo actual de perfiles activos:

- 3 admin;
- 1 director;
- 7 comercial;
- 0 gerencia.

Por eso la ruta `gerencia` está cubierta estáticamente, pero no existe hoy una cuenta activa para QA real de ese rol.

---

## 9. Brechas priorizadas

### P0 — Bloqueantes antes de producción

1. Resolver conflictos PR #12 vs. `main` preservando todos los arreglos QA del PR #13.
2. Repetir pruebas de ambos lados después de la integración.
3. Actualizar F6 para eliminar AGT-004 y convertir Junta en modo/capacidad de AGT-001.
4. Definir permisos separados de lectura, edición y generación de Junta.
5. Hacer QA autenticado de admin, director y comercial; agregar o simular de forma controlada el rol gerencia.
6. Validar cifras financieras antes de tratarlas como información aprobada.

### P1 — Importantes para coherencia funcional

1. Canonicalizar `siio_fronts` y ampliar F3A–F3F.
2. Decidir tratamiento de IDs heredados `SIIO` y `Sistema-general`.
3. Conectar señales comerciales reales a F2/F5.
4. Hacer visible y útil el backlog de 67 oportunidades estratégicas o dejar de cargarlo en bootstrap.
5. Completar vigencia/propietarios de fuentes F4.
6. Persistir histórico de lecturas F5.
7. Mejorar el borrador de Junta: actualmente resume conteos, no construye todavía un informe completo validado/exportable.

### P2 — Deuda técnica

1. Agregar `npm test`.
2. Dividir el bundle principal.
3. Añadir CI obligatoria al PR; actualmente GitHub no reporta checks automáticos en #12.
4. Normalizar arreglos `related_fronts` heredados.

---

## 10. Plan exacto para comenzar mañana

### Bloque 1 — Reconciliar código

1. Crear backup/tag local de `feature/siio-main-integration`.
2. Integrar `origin/main` en la rama SIIO.
3. Resolver manualmente `src/main.tsx` combinando:
   - shell y ruta SIIO;
   - drawer móvil;
   - cierre del menú al navegar;
   - topbar SIIO/comercial;
   - permisos de navegación;
   - ocultamiento de “Nueva oportunidad” dentro de SIIO.
4. Resolver `src/styles.css` conservando tanto estilos SIIO como estilos post-deploy.
5. Incorporar la prueba QA post-deploy de `main`.

### Bloque 2 — Aplicar decisiones arquitectónicas

1. Consolidar AGT-004 dentro de AGT-001 como Modo Junta.
2. Actualizar checker, pruebas y documentación F6.
3. Separar permisos de lectura/escritura/Junta.
4. Completar el mapa canónico de frentes F3A–F3F en una migración idempotente revisable.

### Bloque 3 — Verificación integrada

Ejecutar:

```bash
npm run check:permissions
node --test tests/*.test.mjs
python3 tests/siio-board-source-extractor.test.py
npm run build
git diff --check
```

Luego hacer QA local/autenticado:

- admin escritorio y móvil;
- director escritorio y móvil;
- comercial confirmando que SIIO no aparece ni abre;
- rol gerencia cuando exista cuenta controlada;
- Licitaciones/RUP para comprobar que no hubo regresión;
- Dashboard, oportunidades y Radar para preservar QA #13.

### Bloque 4 — Nuevo preview

1. Desplegar preview combinado.
2. Verificar API `/api/siio/bootstrap` autenticada.
3. Verificar visualmente todas las pestañas SIIO.
4. Confirmar que no hay errores de consola ni overflow móvil.
5. No desplegar a producción todavía.

### Bloque 5 — Gates humanos

Antes de producción:

- validación financiera;
- aprobación de permisos SIIO;
- aprobación de la nomenclatura/migración F1–F6;
- aprobación del merge PR #12;
- autorización explícita para cualquier migración o deploy productivo.

---

## 11. Punto único de reinicio

**Mañana se debe comenzar por integrar `origin/main` en `feature/siio-main-integration` y resolver los conflictos conservando los arreglos QA del PR #13.**

No conviene empezar agregando nuevos agentes o módulos mientras el PR #12 siga en estado `CONFLICTING` y SIIO continúe separado de la versión productiva del CRM.

---

## 12. Evidencia mecánica resumida

```text
Producción main:                 937aed5
Rama SIIO:                       d1f1052
PR #12:                          OPEN / DRAFT / CONFLICTING
Conflictos simulados:            src/main.tsx, src/styles.css
Pruebas rama SIIO (JS):          34/34 PASS
Pruebas extractor SIIO (Python):  3/3 PASS
Pruebas main:                    33/33 PASS
Build rama SIIO:                 PASS
Build main:                      PASS
Vercel producción:               Ready
Vercel preview SIIO:             Ready, protegido
SIIO API en producción:          404
Métricas financieras Supabase:   9
Agregados nómina Supabase:       12 áreas / 157 personas
Alertas nómina:                  1
Fuentes F4:                      13
Registros F2:                    6
Decisiones/compromisos:          0
Señales comerciales SIIO:        0
Oportunidades estratégicas:      67, no visibles en UI
RLS lectura anónima SIIO:        0 filas
QA autenticado SIIO por roles:   pendiente
Validación financiera:           pendiente
```
