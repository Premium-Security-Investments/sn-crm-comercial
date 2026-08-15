# Manifiesto integral versionado — Rama Judicial Manizales SA-24-2026

> Artefacto: `data/agt002/manizales-sa-24-2026.integral-manifest.v1.json` (regenerable con
> `node scripts/agt002-manizales-integral-manifest-generate.mjs`). Estado: **validated_candidate**,
> `human_approval_required: true`, `human_approved: false`. Generado: 2026-08-15T00:00:00.000Z.

Consolida las tres fuentes gobernadas (registro contractual, análisis pre-GO y propuestas de
sección) y el espejo de los 3 bindings de la migración 066. **No habilita, no puntúa y no afirma
cumplimiento ni suficiencia**: la aplicabilidad, la suficiencia, la subsanabilidad y el GO/NO-GO son
compuertas humanas. La categoría es metadato de gobernanza, nunca una decisión de cumplimiento.

## Cobertura

- Secciones del registro: **68**; documentos fuente: **17**.
- Propuestas curadas: **20** en **10** secciones.
- Requisitos gobernados en tiempo de ejecución: **4**; bindings 066: **3**.
- section_ledger: **15** (analyzed_candidate 10, unresolved_visible 5).
- proposal_ledger: **20** (analyzed_candidate 20).
- Entradas: **25** (analizables 20, unresolved_visible 5).

## Entradas por categoría de gobernanza

| categoría | # |
|---|---|
| habilitating | 14 |
| technical | 7 |
| financial_execution | 3 |
| null | 1 |

## section_ledger (15 secciones pre-GO)

| item_ref | fase | disposición | origen | produce |
|---|---|---|---|---|
| 1.3 | generalidad | unresolved_visible | governed_runtime | 1 |
| 1.9 | generalidad | unresolved_visible | governed_runtime | 1 |
| 2.1 | habilitante | unresolved_visible | governed_runtime | 3 |
| 2.2 | habilitante | unresolved_visible | governed_runtime | 1 |
| 2.3 | habilitante | analyzed_candidate | section_proposal | 2 |
| 2.4 | habilitante | analyzed_candidate | section_proposal | 4 |
| 2.4.1 | habilitante | analyzed_candidate | section_proposal | 4 |
| 2.5 | habilitante | analyzed_candidate | section_proposal | 1 |
| 2.6 | habilitante | unresolved_visible | governed_runtime | 1 |
| 3.1 | puntuable | analyzed_candidate | section_proposal | 2 |
| 3.2 | puntuable | analyzed_candidate | section_proposal | 1 |
| 3.3 | puntuable | analyzed_candidate | section_proposal | 1 |
| 3.4 | puntuable | analyzed_candidate | section_proposal | 1 |
| 3.5 | puntuable | analyzed_candidate | section_proposal | 1 |
| 3.6 | puntuable | analyzed_candidate | section_proposal | 3 |

## Entradas gobernadas y compuertas

| requirement_id | origen | item_ref | categoría | clase de evidencia | materialidad | analizable |
|---|---|---|---|---|---|---|
| `financial-working-capital` | governed_runtime | 2.2 | habilitating | rup | material | no |
| `legal-rce-policy` | governed_runtime | 2.1 | habilitating | rce_policy | ordinary | no |
| `legal-collective-life-policy` | governed_runtime | 2.1 | habilitating | collective_life_policy | ordinary | no |
| `technical-video-surveillance-scope` | governed_runtime | 2.1 | technical | — | ordinary | no |
| `proposal:2.3:indices-capacidad-organizacional` | section_proposal | 2.3 | habilitating | rup | ordinary | sí |
| `proposal:2.3:regla-plural-integrante-organizacional` | section_proposal | 2.3 | habilitating | — | ordinary | sí |
| `proposal:2.4:experiencia-rup-unspsc-sumatoria` | section_proposal | 2.4 | habilitating | accredited_experience | ordinary | sí |
| `proposal:2.4:anexo-8-formato-experiencia` | section_proposal | 2.4 | habilitating | accredited_experience | ordinary | sí |
| `proposal:2.4:regla-sumatoria-plural-experiencia` | section_proposal | 2.4 | habilitating | — | ordinary | sí |
| `proposal:2.4:experiencia-extranjera-traduccion` | section_proposal | 2.4 | habilitating | — | ordinary | sí |
| `proposal:2.4.1:diferencial-mujeres-experiencia` | section_proposal | 2.4.1 | habilitating | differential_scoring_support | ordinary | sí |
| `proposal:2.4.1:diferencial-mipyme-experiencia` | section_proposal | 2.4.1 | habilitating | differential_scoring_support | ordinary | sí |
| `proposal:2.4.1:diferencial-discapacidad-experiencia` | section_proposal | 2.4.1 | habilitating | differential_scoring_support | ordinary | sí |
| `proposal:2.4.1:regla-sumatoria-contratos-adicionales` | section_proposal | 2.4.1 | habilitating | — | ordinary | sí |
| `proposal:2.5:regla-subsanabilidad` | section_proposal | 2.5 | habilitating | — | ordinary | sí |
| `proposal:3.1:calidad-lenguaje-senas` | section_proposal | 3.1 | technical | — | scorable | sí |
| `proposal:3.1:calidad-capacitaciones` | section_proposal | 3.1 | technical | — | scorable | sí |
| `proposal:3.2:industria-nacional-servicios-colombianos` | section_proposal | 3.2 | technical | — | scorable | sí |
| `proposal:3.3:puntaje-discapacidad` | section_proposal | 3.3 | technical | differential_scoring_support | scorable | sí |
| `proposal:3.4:puntaje-emprendimiento-empresa-mujeres` | section_proposal | 3.4 | technical | differential_scoring_support | scorable | sí |
| `proposal:3.5:puntaje-mipyme` | section_proposal | 3.5 | technical | differential_scoring_support | scorable | sí |
| `proposal:3.6:oferta-economica-anexo-9` | section_proposal | 3.6 | financial_execution | — | economic | sí |
| `proposal:3.6:tarifa-minima-regulada` | section_proposal | 3.6 | financial_execution | — | economic | sí |
| `proposal:3.6:metodo-media-aritmetica` | section_proposal | 3.6 | financial_execution | — | economic | sí |
| `lifecycle:cierre-prorroga` | lifecycle_gate | 1.8 | — | — | ordinary | no |

## Límites probatorios

- Este manifiesto es un CANDIDATO VALIDADO para revisión humana: no habilita, no puntúa y no afirma cumplimiento ni suficiencia.
- La categoría es metadato de gobernanza (descarte/habilitante/técnico/ejecución financiera o null), nunca una decisión de cumplimiento.
- La clase de evidencia empresarial es una de las 17 clases cerradas o null; jamás se fabrica (p.ej. nunca se inventa una clase para el alcance de video).
- Los 3 bindings gobernados provienen del espejo de la migración 066; el 4º requisito gobernado mapea técnico=>technical y mantiene su clase candidata/null.
- La aplicabilidad, la suficiencia, la subsanabilidad y el GO/NO-GO son compuertas humanas; `human_approved` es siempre false y ninguna entrada se auto-aprueba.
- Rama Judicial Pereira SA-MC-02-2026 vive en las fuentes sólo como lección/provenance de método; no prueba cumplimiento de Manizales ni traslada aplicabilidad.
