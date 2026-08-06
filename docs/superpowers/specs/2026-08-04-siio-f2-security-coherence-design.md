# SIIO F2 — Diseño de saneamiento de seguridad y coherencia

**Fecha:** 2026-08-04
**Estado:** aprobado por Juan Botero
**Base auditada:** `origin/main` en `e30ef635fd3782b8b9e4d603cacd09b7e59507a4`
**Alcance:** fase general F2 — Gestión Gerencial y Control

## 1. Propósito

Dejar la base existente de F2 segura, coherente y verificable antes de añadir funciones operativas visibles. Este bloque corrige contradicciones entre navegación, permisos, estados y datos entregados por el backend. No crea formularios ni implementa todavía el ciclo completo de Junta.

## 2. Decisiones aprobadas

1. Este primer bloque es saneamiento interno y no agrega funciones visibles.
2. `admin` y `gerencia` continúan usando SIIO como hoy.
3. `director` deja de ser elegible para SIIO, no ve su navegación y recibe `403` si intenta entrar por URL directa. Su acceso se difiere hasta existir alcance canónico por área.
4. Junta nunca consume el snapshot vivo de SIIO. Sólo puede consultar reportes cuyo `status` sea `presentado`.
5. El vocabulario canónico de reportes permanece en español: `borrador`, `en_revision`, `aprobado`, `presentado`.
6. No se agrega una columna redundante `publication_status`.
7. Las filas de nómina agregada con `visibility_level = 'restringido'` no se entregan por defecto. `admin` y `gerencia` reciben únicamente niveles `gerencia` y `junta_agregado` durante este bloque.
8. Junta no recibe filas crudas de nómina por el endpoint vivo; cualquier agregado para Junta deberá formar parte de un reporte `presentado` en el futuro.
9. AGT-002, AGT-003 y Mesa Vig-IA quedan fuera de alcance.
10. No se ejecutan migraciones productivas, push ni deploy sin gate humano posterior y evidencia fresca.

## 3. Hechos del sistema actual

### 3.1 Acceso

- El frontend considera elegibles para `modulo_siio_gerencial` a `admin`, `gerencia`, `director` y `junta` mediante `module-access.js`.
- La navegación usa esa elegibilidad y permisos explícitos para mostrar SIIO.
- El backend bloquea expresamente a `director` en `requireSiioEndpointAccess` porque los registros F2 no tienen alcance canónico por área.
- Resultado actual: Director puede ver navegación para una ruta que el servidor rechaza.

### 3.2 Junta

- `siio_monthly_board_reports.status` acepta `borrador`, `en_revision`, `aprobado` y `presentado`.
- La autorización actual construye un recurso con `publication_status: 'published'`.
- El filtro intenta leer `row.publication_status ?? row.status`, pero la política espera `published`.
- Resultado actual: un reporte `presentado` no satisface la política de lectura de Junta.
- El botón “Preparar informe de Junta” sólo construye un borrador local e imprime/exporta mediante `window.print()`.
- No existen endpoints para aprobar, presentar, retirar o versionar reportes. Eso se mantiene diferido.

### 3.3 Datos y base

- Las diez tablas fundacionales SIIO tienen RLS habilitada.
- No existen políticas RLS que permitan acceso directo a `anon` o `authenticated`; por defecto, ese acceso queda denegado.
- El backend usa `service_role`, que evita RLS, por lo que el control efectivo de cada solicitud reside en los guards del servidor.
- `visibility_level` en nómina admite `gerencia`, `junta_agregado` y `restringido`, pero el bootstrap actual no aplica ese valor como filtro para `admin`/`gerencia`.
- `optionalSiioList` convierte una tabla fundacional ausente en una colección vacía, lo que puede ocultar una falla de esquema como si no hubiera datos.

### 3.4 Escritura

Existen endpoints protegidos para crear o actualizar registros, decisiones y fuentes. La UI actual no los consume. Este bloque no los elimina ni les agrega interfaz porque eso sería una función operativa nueva y requiere diseño separado.

## 4. Objetivos

1. Alinear navegación y backend para el rol Director.
2. Alinear autorización de Junta con el estado canónico `presentado`.
3. Reforzar el default-deny de acceso directo a tablas SIIO mediante privilegios SQL explícitos.
4. Aplicar en runtime el nivel de visibilidad de nómina agregada.
5. Distinguir una tabla fundacional ausente de una tabla válida sin filas.
6. Mantener paridad funcional entre `server/index.js` y `api/[...path].js`.
7. Añadir pruebas negativas y positivas que demuestren las garantías anteriores.

## 5. No objetivos

Este bloque no:

- construye formularios de registros, decisiones, fuentes o compromisos;
- implementa borrador persistente, revisión, aprobación, presentación, retiro o histórico de Junta;
- habilita acceso de Director por área;
- crea un permiso para nómina restringida;
- modifica el catálogo o la funcionalidad de agentes;
- cambia datos reales;
- ejecuta migraciones remotas;
- publica ni despliega automáticamente.

## 6. Contrato de comportamiento

### 6.1 Matriz de acceso

| Actor | Navegación SIIO | Bootstrap vivo | Reportes de Junta | Nómina viva |
|---|---:|---:|---:|---:|
| Admin activo con permiso SIIO | Sí | Sí | Sí, para gestión | `gerencia` y `junta_agregado` |
| Gerencia activa con permiso SIIO | Sí | Sí | Sí, para gestión | `gerencia` y `junta_agregado` |
| Director | No | No (`403`) | No (`403`) | No |
| Junta activa con permiso SIIO | Sí | No recibe snapshot gerencial | Sólo `presentado` | No recibe filas crudas |
| Comercial/colaborador/otro | No | No (`403`) | No (`403`) | No |
| Usuario inactivo o sin permiso | No | No (`403`) | No (`403`) | No |
| Sin sesión válida | No | No (`401`) | No (`401`) | No |

### 6.2 Reportes de Junta

- `status` es la única fuente de verdad para publicación.
- La acción `BOARD_PUBLICATION_VIEW` acepta exclusivamente `status = 'presentado'`.
- La API filtra en servidor; el frontend nunca recibe borradores o reportes en revisión cuando el actor es Junta.
- Una colección sin reportes `presentado` produce estado vacío legítimo, no error.
- No se cambia todavía el ciclo de estados ni se permite transición desde la UI.

### 6.3 Nómina agregada

- Para `admin` y `gerencia`, el backend filtra antes de serializar y sólo incluye `visibility_level IN ('gerencia', 'junta_agregado')`.
- `restringido` queda fail-closed: no se entrega hasta que exista un permiso explícito diseñado y aprobado.
- Junta no recibe `payrollAggregates` en el bootstrap.
- El filtro se aplica tanto en servidor local como en la función API productiva.
- La ausencia de filas visibles produce `[]` sin revelar que existen filas ocultas.

### 6.4 Tablas fundacionales

Las tablas creadas por la fundación F2 son requeridas para el bootstrap. Si una relación requerida no existe o la consulta falla:

- el servidor registra el error sin exponer secretos;
- responde con error controlado;
- la UI muestra que SIIO no pudo cargar;
- no convierte la falla en un tablero vacío.

Una consulta exitosa con cero filas sigue siendo un estado vacío normal.

## 7. Arquitectura propuesta

### 7.1 Capa de elegibilidad

`module-access.js` elimina `modulo_siio_gerencial` del techo del rol `director`. Esta única fuente de elegibilidad debe gobernar:

- permisos seleccionables en administración;
- visibilidad de navegación;
- acceso de ruta en frontend.

El bloqueo explícito de Director en el backend se conserva como defensa independiente hasta que se implemente alcance por área.

### 7.2 Capa de autorización SIIO

En `server/index.js` y `api/[...path].js`:

- el recurso publicado usa `status: 'presentado'`;
- el filtro de reportes usa `row.status`;
- no se acepta el alias inglés;
- la política de Junta permanece limitada a endpoints `board-published`;
- no se amplía el acceso de Director.

### 7.3 Capa de consulta

El bootstrap separa dos conceptos:

1. consulta requerida de tablas fundacionales;
2. resultado válido sin filas.

La consulta de nómina aplica su filtro de visibilidad en el servidor. No se delega al frontend.

### 7.4 Capa de base de datos

Se crea una migración forward-only con el siguiente prefijo numérico libre disponible al iniciar implementación y el sufijo `siio_f2_security_coherence.sql`.

La migración:

- conserva RLS habilitada;
- revoca privilegios directos sobre tablas SIIO a `public`, `anon` y `authenticated`;
- concede a `service_role` sólo las operaciones que el backend existente necesita;
- no crea políticas permisivas para clientes;
- no modifica ni borra filas;
- no cambia el vocabulario de estados existente;
- no agrega columnas.

El número no se congela en este diseño porque `main` recibe migraciones concurrentes; se debe calcular inmediatamente antes de crear el archivo para evitar colisiones.

## 8. Tratamiento de errores

| Condición | Respuesta esperada |
|---|---|
| Token ausente o inválido | `401` |
| Perfil inactivo, sin permiso o rol no autorizado | `403` |
| Director entra por URL directa | `403` |
| Junta solicita endpoint gerencial vivo | `403` |
| Junta consulta y no hay reportes presentados | `200` con lista vacía |
| Tabla fundacional ausente | Error controlado; nunca `200` vacío engañoso |
| Tabla válida sin filas | `200` con lista vacía |
| Sólo existen filas de nómina restringidas | `200` sin esas filas |
| Error interno | Mensaje público genérico y detalle sólo en log seguro |

## 9. Archivos previstos

### Modificar

- `module-access.js`
- `src/navPermissions.ts`
- `server/index.js`
- `api/[...path].js`
- `tests/siio-area-scope-blocker.test.mjs`
- `tests/siio-manager-navigation-selectors.test.mjs`
- `tests/siio-manager-navigation-static.test.mjs`
- `tests/siio-board-readonly-ui.test.mjs`
- `tests/siio-main-integration-static.test.mjs`
- `tests/siio-migration-source-dependencies.test.mjs`

### Crear

- una migración SQL con el siguiente número libre y sufijo `siio_f2_security_coherence.sql`;
- pruebas específicas adicionales si las suites existentes no permiten demostrar aislamiento, visibilidad y fallas de esquema sin acoplamiento excesivo.

No deben modificarse archivos de AGT-002, AGT-003 o Mesa Vig-IA.

## 10. Estrategia TDD y QA

La implementación seguirá RED–GREEN–REFACTOR.

### 10.1 Elegibilidad Director

1. Prueba roja: Director no es elegible para `modulo_siio_gerencial`.
2. Prueba roja: no aparece navegación SIIO aunque conserve un grant histórico.
3. Prueba roja: URL directa recibe `403`.
4. Implementación mínima.
5. Regresión de demás módulos de Director.

### 10.2 Estado Junta

1. Prueba roja: Junta no puede ver `borrador`, `en_revision` ni `aprobado`.
2. Prueba roja: Junta sí puede ver `presentado`.
3. Prueba roja: el alias `published` no es canónico.
4. Implementación mínima en servidor y API.
5. Verificación de paridad.

### 10.3 Visibilidad de nómina

1. Prueba roja con filas de los tres niveles.
2. Verificar que Gerencia/Admin reciben sólo `gerencia` y `junta_agregado`.
3. Verificar que Junta recibe cero filas crudas.
4. Verificar que actores no autorizados reciben `403`, no una lista filtrada.
5. Implementación mínima antes de serializar.

### 10.4 Base de datos

1. Prueba de migración local que confirma RLS y privilegios revocados para clientes.
2. Confirmar operaciones mínimas requeridas para `service_role`.
3. Confirmar que la migración no altera datos.
4. Confirmar idempotencia según el patrón del repositorio.

### 10.5 Fallas de esquema

1. Prueba roja: relación requerida ausente no se convierte en `[]`.
2. Prueba verde: tabla válida sin filas sí retorna `[]`.
3. Prueba de error público sin detalles internos.

### 10.6 Gates mecánicos

Como mínimo:

```bash
node --test --test-concurrency=1 tests/siio*.test.mjs
npm run build
```

Además se ejecutarán las pruebas específicas nuevas, pruebas de paridad `server/api` y validación local de la migración.

## 11. Criterios de aceptación

El bloque está técnicamente listo cuando:

1. Director no es elegible para SIIO, no ve navegación y recibe `403` directo.
2. Admin y Gerencia conservan su acceso vigente.
3. Junta recibe únicamente reportes `presentado`.
4. No existe uso de `publication_status` ni `published` en el contrato F2 de Junta.
5. Nómina `restringido` no aparece en payloads de Admin/Gerencia.
6. Junta no recibe nómina cruda.
7. Clientes `anon` y `authenticated` carecen de privilegios directos sobre tablas SIIO.
8. Una tabla fundacional ausente produce error controlado.
9. Una tabla válida vacía produce estado vacío legítimo.
10. `server/index.js` y `api/[...path].js` mantienen paridad.
11. Todas las pruebas SIIO y el build aprueban.
12. No cambia ninguna funcionalidad de agentes.
13. No se agregan funciones visibles nuevas.
14. El diff no contiene secretos ni datos reales.

## 12. Despliegue y gates humanos

1. Implementación y pruebas sólo en worktree aislado.
2. Revisión única independiente del diff completo.
3. Presentar a Juan:
   - diff resumido;
   - pruebas;
   - resultado de build;
   - validación de migración local;
   - riesgos residuales.
4. Push y PR requieren autorización humana.
5. Aplicar migración productiva requiere autorización humana separada.
6. Deploy productivo requiere autorización humana separada.
7. Después del deploy, validar con una cuenta por rol sin modificar datos reales.

## 13. Rollback

### Código

Revertir el commit de aplicación restaura la navegación y filtros anteriores. No se deben dejar frontend y backend con contratos distintos.

### Migración

Los privilegios pueden restaurarse mediante una migración forward-only explícita. No se borra la migración aplicada ni se manipula el historial remoto. Como este bloque no transforma datos ni agrega columnas, el rollback no requiere recuperar filas.

### Operación

Si aparece una regresión de acceso:

- mantener Director bloqueado;
- mantener Junta sin acceso a información viva;
- retirar temporalmente el módulo para el rol afectado antes que ampliar permisos;
- no desactivar guards para recuperar disponibilidad.

## 14. Riesgos residuales

1. `service_role` evita RLS; los guards del backend siguen siendo control crítico. Los privilegios explícitos protegen contra acceso directo de clientes, no contra un bug futuro dentro de una ruta autorizada.
2. `restringido` queda oculto sin mecanismo de excepción. Diseñar dicho permiso es trabajo posterior.
3. Los endpoints de escritura continúan sin UI y no forman un flujo operativo completo.
4. Junta seguirá sin reportes hasta construir el ciclo persistente de publicación.
5. Director seguirá sin SIIO hasta que los registros tengan área/subárea canónica.
6. La duplicación entre servidor y función API exige pruebas de paridad mientras exista.

## 15. Decisiones diferidas

Quedan para diseños separados:

- UI compacta de seguimiento gerencial;
- creación y edición de registros, decisiones, compromisos, riesgos y bloqueos;
- máquina de estados de asuntos y cierre humano;
- ciclo persistente de Junta: borrador, revisión, aprobación, presentación, retiro e histórico inmutable;
- acceso de Director por área/subárea;
- permiso excepcional para nómina restringida;
- integración viva de fuentes con SharePoint Innovación;
- cualquier cambio de AGT-002, AGT-003 o Mesa Vig-IA.
