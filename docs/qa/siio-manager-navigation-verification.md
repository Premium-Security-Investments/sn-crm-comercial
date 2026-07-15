# Verificación — navegación gerencial SIIO

Fecha: 2026-07-15

Commit probado: `9398cc5d2ec2291798c79aa87045060319299eb7`

Preview local autenticado: `http://127.0.0.1:4173` (Express + build de producción local)

## Resultado

**APROBADO para integración.** Las cuatro vistas, el borrador gobernado de Junta, permisos, rutas, responsive, privacidad y ausencia de escrituras desde Junta pasaron los gates automatizados y visuales.

## Regresión automatizada

- 42/42 archivos `tests/*.test.mjs`: PASS.
- `python3 tests/siio-board-source-extractor.test.py`: 3/3 PASS.
- `npm run check:siio-integration`: PASS.
- `npm run check:siio-executive`: PASS.
- `npm run check:siio-agents`: PASS.
- `npm run check:nav-permissions`: PASS.
- `npm run build`: PASS.
- `git diff --check`: PASS.
- Advertencia no bloqueante conocida: bundle minificado superior a 500 kB.

## Preview y API

- `GET /`: HTTP 200.
- `GET /api/siio/bootstrap` autenticado: HTTP 200, payload real de 105457 bytes.
- El primer intento de preview usó Vite sin backend y fue descartado; toda la evidencia final se capturó contra Express con API real.

## QA autenticado

| Rol | Resultado |
|---|---|
| Admin | Acceso a SIIO y cuatro vistas: PASS |
| Director | Acceso autenticado y cuatro vistas: PASS |
| Comercial | SIIO ausente del sidebar, ruta directa denegada y cero solicitudes a `/api/siio/bootstrap`: PASS |
| Gerencia | No existe perfil activo de QA con este rol; matriz automatizada de permisos: PASS. No se creó ni alteró un usuario productivo para simularlo. |

Las sesiones se generaron mediante enlaces temporales locales para usuarios existentes, sin cambiar contraseñas ni enviar correos. Los estados del navegador quedaron fuera del repositorio y no contienen evidencia publicada.

## Gates funcionales Playwright

Archivo de resultados: `docs/qa/siio-manager-navigation/qa-results.json`.

- 21/21 checks: PASS.
- Cuatro vistas cargan con datos reales.
- Sin overflow horizontal del documento en 1440×900 ni 390×844.
- Foco de teclado visible en cada vista y viewport.
- Drawer móvil abre completo, muestra overlay y cierra con Escape.
- Vista inválida cae en Resumen y conserva `period=2026-06-01`.
- Navegación Back funciona entre vistas.
- Drill-down “Alertas y riesgos” llega a Seguimiento con `kind=riesgos`.
- Junta abre con foco inicial en Cerrar, imprime mediante `window.print`, cierra con Escape y no genera solicitudes de escritura.

## Evidencia visual

Directorio: `docs/qa/siio-manager-navigation/`

- `resumen-desktop.png`
- `resumen-mobile.png`
- `resumen-mobile-drawer-open.png`
- `seguimiento-desktop.png`
- `seguimiento-mobile.png`
- `inteligencia-desktop.png`
- `inteligencia-mobile.png`
- `agentes-desktop.png`
- `agentes-mobile.png`
- `junta-borrador-desktop.png`
- `junta-borrador-mobile.png`
- `contact-sheet.png`

Revisión visual: sin clipping, superposición, errores de carga, KPI financiero duplicado, PII de nómina ni overflow global. Las tablas anchas mantienen scroll en su contenedor. El modal móvil ocupa el ancho disponible y conserva scroll vertical. La captura inicial del drawer estaba desactualizada; fue reemplazada por una captura fresca cuya geometría medida fue `left=0`, `width=300px`, `transform=identity`, `z-index=50`.

## Privacidad y gobierno

- Cero coincidencias para cédula, salario individual, nombre de empleado, `employee_name` o endpoints de generación persistente en `src/siio`.
- Cero coincidencias de `fetch`, `api(` o métodos POST/PUT/PATCH/DELETE en `SiioBoardDraftAction.tsx`.
- Nómina exclusivamente agregada.
- AGT-001 limita evidencia a `SRC-011`, `SRC-012`, `SRC-013`; elementos fuera de política quedan visibles solo como excluidos.
- Junta sigue siendo una acción de AGT-001, no una pestaña ni un cuarto agente.

## Estados honestos observados

- Datos financieros pendientes de validación se muestran como tales.
- Fuentes sin fecha de revisión se identifican explícitamente.
- Evidencia ausente o no autorizada no se presenta como válida.

## Declaración de alcance

No se aplicaron migraciones, no se modificó Supabase productivo, no hubo merge y no se desplegó producción durante esta verificación.
