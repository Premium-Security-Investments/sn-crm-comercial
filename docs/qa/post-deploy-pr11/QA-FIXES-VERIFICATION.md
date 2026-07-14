# Verificación de correcciones QA — PR post-deploy #11

- **Fecha:** 2026-07-13
- **Rama:** `feature/qa-postdeploy-fixes`
- **Entorno validado:** frontend y API locales con datos reales de lectura y usuario QA temporal reversible
- **Resultado:** **PASS**

## Correcciones verificadas

| Área | Corrección | Evidencia |
|---|---|---|
| Responsive | Sidebar convertido en drawer móvil; contenido principal visible desde el primer viewport | 375×844: menú visible, sidebar cerrado en `left=-300`, drawer abierto en `left=0` con backdrop |
| Responsive | Eliminado overflow horizontal del Dashboard móvil | `clientWidth=375`, `scrollWidth=375` |
| Oportunidades | Paginación de 25 registros | 216 visibles, 9 páginas; página 1 = 1–25 y página 2 = 26–50 |
| Oportunidades | Selectores restringidos a comerciales activos | 7 comerciales; sin Admin, Dirección o Gerencia |
| Oportunidades | Regiones normalizadas | Bogotá/Medellín y demás valores aparecen una sola vez |
| Radar | Paginación de 24 procesos | 89 procesos únicos, 4 páginas |
| Radar | Deduplicación por fuente, entidad y referencia canónica | El resumen diferencia procesos únicos de entradas fuente; conserva estado convertido/en revisión |
| Radar | Orden de Hooks estable | Regresión añadida; ruta carga sin error runtime React |
| Perfiles | Vista separada del Radar | `.tender-profiles-only` presente; sin board ni controles operativos |
| Perfiles | Aplicar perfil conserva filtros al abrir Radar | Se evita el reset de ruta durante la aplicación del perfil |
| Alertas | Eliminada tabla detallada duplicada de cumplimiento | 20 tarjetas; 0 tablas en bloque de cumplimiento; enlace a Metas |
| Usuarios | Roles legibles | Comercial, Directivo y Admin; no se muestran claves técnicas crudas |
| Metas | Selectores y owner inicial limitados a comerciales activos | Reutiliza `goalCommercialProfiles` |

## Checker visual

### Escritorio 1440×900

- Oportunidades: PASS, 25 filas, paginación funcional, sin overflow.
- Radar: PASS, 24 tarjetas, paginación funcional.
- Perfiles: PASS, módulo aislado.
- Alertas: PASS, resumen sin duplicación.
- Usuarios: PASS, etiquetas normalizadas.

### Móvil 390×844 (viewport CSS efectivo 375 px)

- Dashboard cerrado: PASS, contenido visible y menú accesible.
- Drawer abierto: PASS, sidebar en pantalla y backdrop activo.
- Dashboard overflow: PASS (`scrollWidth === clientWidth`).
- Oportunidades: PASS, tabla con scroll interno y documento sin overflow.
- Radar: PASS, 24 tarjetas y documento sin overflow.

Capturas: `docs/qa/post-deploy-pr11/fixes/`.

## Pruebas automatizadas

- **33 archivos de prueba:** PASS.
- `tests/qa-postdeploy-fixes-static.test.mjs`: PASS.
- `tests/tender-company-profile-editable-static.test.mjs`: PASS.
- TypeScript: PASS.
- Vite build: PASS.
- `git diff --check`: PASS.
- Advertencia no bloqueante existente: bundle principal superior a 500 kB.

## Higiene

- Usuario QA temporal eliminado de `psi_sales_profiles`: verificado.
- Usuario QA temporal eliminado de Supabase Auth: verificado.
- Backend, frontend y navegador locales cerrados.
- No se realizó deploy ni modificación comercial.
