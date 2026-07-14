# SIIO F6 — Catálogo Institucional de Agentes

**Fecha:** 2026-07-14

**Rama:** `feature/siio-main-integration`

**PR:** #12

## Objetivo

Crear el primer catálogo gobernado de capacidades tipo agente dentro de SIIO. El catálogo informa qué existe, qué está parcialmente operativo y qué continúa en diseño; registrar una capacidad no la vuelve autónoma ni amplía sus permisos.

## Contrato de gobierno

Cada entrada debe declarar:

- identificador estable y nombre;
- estado real;
- responsable institucional;
- propósito;
- frentes y fuentes autorizadas;
- acciones permitidas;
- acciones prohibidas;
- revisión humana obligatoria;
- prohibición de escritura automática en producción;
- canal;
- regla de auditoría;
- capacidad actual;
- siguiente gate.

El validador F6 rechaza IDs duplicados, identidades incompletas, ausencia de fuentes, ausencia de límites, escritura automática o falta de auditoría.

## Catálogo inicial

| ID | Capacidad | Estado |
|---|---|---|
| AGT-001 | Agente Gerencial SIIO | Piloto |
| AGT-002 | Copiloto de Licitaciones | Operativo parcial |
| AGT-003 | Vig-IA Comercial | Operativo parcial |
| AGT-004 | Asistente de Junta | Diseño |

Los estados se basan en capacidades verificadas en el repo. Ninguna entrada se presenta como agente autónomo completo.

## Controles sensibles

- Toda entrada exige revisión humana.
- Ninguna puede escribir automáticamente en producción.
- AGT-001 prohíbe exponer nómina individual o datos personales.
- AGT-002 mantiene confirmaciones para descartar, convertir o preparar acciones sensibles.
- AGT-003 funciona en lectura y recomendación comercial.
- AGT-004 no puede aprobar cifras ni publicar informes.

## Interfaz

La vista F6 muestra:

- resumen por estado;
- propósito y responsable;
- capacidad actual;
- fuentes y frentes autorizados;
- acciones permitidas y prohibidas;
- auditoría y siguiente gate;
- badges explícitos de revisión humana y no escritura.

## Verificación

```text
node scripts/check_siio_agent_catalog.mjs          PASS
node tests/siio-agent-catalog-static.test.mjs      PASS
npm run check:permissions                          PASS
npm run build                                      PASS
Pruebas *.test.mjs                                 33 PASS / 1 FAIL heredado
```

La falla heredada sigue siendo `tests/tender-company-profile-editable-static.test.mjs`; también falla en `main` y no está relacionada con F6.

## Límites

- El catálogo está versionado en código; todavía no tiene tabla editable propia.
- No se aplicó una nueva migración de base de datos.
- No se desplegó la aplicación a producción.
- La edición administrativa del catálogo queda para un incremento posterior, después de validar el modelo con los responsables institucionales.
