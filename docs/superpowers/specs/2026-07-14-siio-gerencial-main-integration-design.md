# Integración de SIIO Gerencial en `main`

**Fecha:** 2026-07-14
**Estado:** Diseño aprobado para especificación
**Base:** `main` en `937aed5`
**Fuente funcional a recuperar:** `feature/siio-main-integration` en `d1f1052`

## 1. Problema y causa raíz

La navegación productiva creó un grupo **Gerencia**, pero su enlace principal apunta a `#/dashboard2`, que renderiza el dashboard comercial histórico. El SIIO Gerencial real no fue eliminado: permanece en una rama paralela que nunca se integró en `main`.

La rama SIIO contiene 21 commits no presentes en `main`. A su vez, `main` contiene las correcciones QA del PR #13 que no existen en la rama SIIO. Fusionar o reemplazar archivos completos desde la rama antigua podría revertir paginación, deduplicación, responsive y otras correcciones ya desplegadas.

## 2. Objetivo

Recuperar el SIIO Gerencial existente como vista gerencial oficial, conservando intacto el CRM comercial y las correcciones del PR #13.

La navegación final debe distinguir claramente:

- **Gerencia → SIIO Gerencial** (`#/siio`).
- **Comercial → Dashboard comercial** (`#/dashboard2`).

## 3. Alcance

### Incluido

1. Recuperar la ruta, UI, API, modelos, permisos y pruebas del SIIO existente.
2. Mantener el Dashboard comercial actual como módulo separado.
3. Cambiar la identidad del sidebar a **SIIO**.
4. Compactar el sidebar y darle scroll interno independiente.
5. Conservar el drawer móvil y su cierre por backdrop, navegación y tecla Escape.
6. Verificar las migraciones SIIO existentes antes de cualquier escritura de base de datos.
7. Ejecutar QA local, preview y smoke test autenticado antes de producción.

### No incluido

- Rediseñar desde cero el SIIO ya construido.
- Eliminar el dashboard comercial.
- Usar la Junta como fuente de datos.
- Exponer nómina individual, salarios, identificaciones u otros datos personales.
- Aplicar migraciones o semillas productivas sin inspección y autorización explícita.
- Revertir o reemplazar las correcciones del PR #13.

## 4. Arquitectura de integración

### 4.1 Estrategia Git

La integración parte del `main` actual. No se hará merge ciego de `feature/siio-main-integration`.

Se portarán de manera controlada:

- `src/navPermissions.ts`
- `src/siioExecutive.ts`
- `src/siioAgents.ts`
- tipos y componentes SIIO necesarios de `src/main.tsx`
- estilos SIIO específicos de `src/styles.css`
- rutas autenticadas `/api/siio/*` en frontend serverless y servidor local
- migraciones `014`, `015` y `016`
- pruebas y checkers SIIO
- documentación técnica y de QA necesaria

Cada incorporación deberá resolverse sobre la versión vigente de los archivos, preservando los cambios actuales.

### 4.2 Navegación final

**Gerencia** — visible solo para `admin`, `gerencia` y `director`:

- SIIO Gerencial
- Vig-IA

**Comercial**:

- Dashboard comercial — visible para roles gerenciales
- Alertas comerciales
- Oportunidades

**Licitaciones** — según permisos actuales:

- Radar de oportunidades
- Seguimiento
- Expedientes
- Perfiles de búsqueda

**Administración**:

- Metas y cumplimiento
- Usuarios y permisos — solo `admin`

El acceso directo a `#/siio` también debe validar permisos; ocultar el enlace no es control suficiente.

### 4.3 Identidad y sidebar

Encabezado:

- Organización: `Seguridad Nacional Ltda`
- Producto: `SIIO`
- Descriptor accesible: `Sistema Interno de Inteligencia Operativa`

Comportamiento:

- ancho desktop aproximado: 232–240 px;
- altura: viewport;
- contenedor flex vertical con `overflow: hidden`;
- navegación central con `min-height: 0` y `overflow-y: auto`;
- espaciado y tipografía más compactos;
- bloque de sesión y acciones reducido, sin botones altos que desplacen la navegación;
- en móvil: drawer desplazable, sin overflow del documento, con cierre por backdrop y Escape.

La navegación es el área que se desplaza; el encabezado SIIO permanece identificable y las acciones de sesión continúan accesibles.

### 4.4 SIIO Gerencial recuperado

La ruta `#/siio` reutiliza el subsistema existente:

- `SiioDashboard`
- `SiioExecutiveHome`
- Inicio ejecutivo permanente
- Frentes oficiales F1–F6
- Registro gerencial
- Decisiones y bloqueos
- Fuentes F4
- Modo Junta como vista/exportación opcional
- razonamiento determinístico F5
- catálogo gobernado de agentes F6

El inicio ejecutivo consume `/api/siio/bootstrap` y deriva una lectura segura mediante `deriveSiioExecutiveSnapshot`:

- métricas financieras agregadas y su periodo;
- nómina agregada por área y su periodo independiente;
- frescura y validación de fuentes;
- riesgos, bloqueos y decisiones pendientes;
- recomendaciones gerenciales basadas en reglas explícitas.

## 5. Datos y seguridad

1. `/api/siio/bootstrap` debe exigir sesión válida y rol gerencial.
2. Las respuestas no deben incluir nombres, identificaciones, salarios ni movimientos individuales de nómina.
3. Finanzas y nómina conservan periodos separados; no se presentarán como un periodo único falso.
4. La información pendiente de validación debe mostrarse explícitamente como tal.
5. Las acciones sensibles conservan confirmación humana.
6. Antes de aplicar migraciones `014–016`, se verificará mecánicamente su presencia y contenido en producción.
7. No se modifican fuentes oficiales de SharePoint durante esta integración.

## 6. Flujo y manejo de errores

- Mientras carga SIIO: estado descriptivo de carga.
- `401`: volver a login o informar sesión expirada.
- `403`: negar acceso con mensaje de permisos, incluso por URL directa.
- error de API: mostrar aviso recuperable y acción de reintento; no presentar ceros como si fueran datos reales.
- datasets vacíos: distinguir `sin datos` de valores numéricos en cero.
- periodos/fuentes: siempre visibles junto a la lectura ejecutiva.

## 7. Pruebas y aceptación

### Automatizadas

1. Test RED de rutas y navegación:
   - `#/siio` existe;
   - Gerencia enlaza SIIO, no Dashboard comercial;
   - Dashboard comercial aparece bajo Comercial.
2. Test RED del sidebar:
   - marca SIIO;
   - navegación con scroll interno;
   - drawer móvil conserva accesibilidad y Escape.
3. Tests de permisos de navegación y acceso directo.
4. Tests de derivación ejecutiva:
   - último periodo financiero;
   - último periodo de nómina;
   - validación/frescura;
   - privacidad y agregación;
   - insights determinísticos.
5. Tests de API autenticada y guards de rol.
6. Suite CRM completa, TypeScript y build Vite.

### QA visual autenticado

- Desktop con alturas de 768 y 900 px: menú completo o desplazable sin perder acciones.
- Móvil 390×844: drawer abre/cierra, hace scroll y no genera overflow horizontal.
- SIIO Gerencial muestra contenido ejecutivo real.
- Dashboard comercial permanece funcional bajo Comercial.
- Consola sin errores React/JavaScript.

### Gate de producción

1. Preview desplegada y validada.
2. Revisión de diff contra `main` para detectar regresiones del PR #13.
3. Confirmación explícita de merge/deploy.
4. Smoke test productivo autenticado.
5. Eliminación y verificación del usuario QA temporal.

## 8. Criterios de éxito

- El usuario puede identificar de inmediato que está en SIIO.
- Gerencia ya no abre el dashboard comercial histórico.
- El SIIO existente vuelve a estar accesible desde `main` sin perder funcionalidades actuales.
- El sidebar se puede recorrer completo en cualquier altura de pantalla.
- Gerencial y Comercial son módulos distintos en navegación, rutas y contenido.
- No se introducen escrituras productivas no autorizadas ni exposición de datos personales.
