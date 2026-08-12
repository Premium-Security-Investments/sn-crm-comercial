# Revisión humana — mapas gobernados AGT-002 — Rama Judicial SA-24-2026

## Control

- Oportunidad: `54190e51-15fb-46af-b0aa-8f13461a3110`
- Snapshot: `c33159a5-defe-4a6f-8fa4-68c5ceb60e59`
- Borrador revisado: `docs/governance/drafts/agt002-rama-judicial-54190e51-15fb-46af-b0aa-8f13461a3110.v1.json` (`version: 2`)
- Estado de la revisión: `HUMAN_REVIEW_COMPLETE_PENDING_TECHNICAL_IMPLEMENTATION`
- Revisor humano: Juan Botero
- Inicio registrado: `2026-08-11T17:54:14Z` (`2026-08-11 12:54:14 COT`)

## Alcance y límites

Esta revisión aprueba o corrige exclusivamente la clasificación documental de requisitos y su vínculo con las clases cerradas de evidencia empresarial. No constituye una declaración de cumplimiento, suficiencia, vigencia o aplicabilidad; tampoco autoriza GO/NO-GO, canary, migración, despliegue, firma, envío o presentación de una oferta.

## Decisiones

### HR-001 — Capital de trabajo

- `requirement_id`: `financial-working-capital`
- Eje `category_override`: **APROBADO** → `habilitating`
- Eje `evidence_class_link`: **APROBADO** → `rup`
- Declaración humana recibida: “Apruebo capital de trabajo como habilitante y su validación mediante RUP”.
- Fundamento presentado al revisor: Capítulo II “Requisitos habilitantes”, §2.2 “Capacidad financiera”, secciones extraídas 408–410; evaluación financiera expresamente basada en el Registro Único de Proponentes.
- Fuentes: Estudios previos, Estudios del sector, Proyecto de pliego y Pliego definitivo SA-24-2026; ancladas por `document_version_id`, `content_hash`, `chunk_id` y `chunk_hash` en el borrador v2.
- Registrado: `2026-08-11T17:54:14Z`.
- Restricción: esta aprobación **no** determina si Seguridad Nacional alcanza el umbral de capital de trabajo ni si el RUP está vigente, revisado o es suficiente.

### HR-002 — Clasificación de pólizas

- `requirement_id`: `legal-guarantee-policy`
- Eje `category_override`: **APROBADO** → `habilitating` para las pólizas RCE y vida colectiva exigidas al proponente.
- Exclusión aprobada: las garantías posteriores de ejecución del contrato, mencionadas en la sección extraída 110, quedan fuera de esta clasificación y deberán analizarse separadamente si se modelan.
- Declaración humana recibida: “Apruebo las pólizas RCE y vida colectiva como habilitantes, excluyendo las garantías posteriores de ejecución del contrato”.
- Fundamento presentado al revisor: RCE en las secciones extraídas 350–355 y vida colectiva en las secciones 356–360 del pliego definitivo, ambas dentro del Capítulo II “Requisitos habilitantes”, corroboradas en estudios previos y proyecto de pliego.
- Registrado: `2026-08-11T17:58:46Z` (`2026-08-11 12:58:46 COT`).
- Restricción: esta aprobación no enlaza todavía una clase documental ni determina presencia, revisión, vigencia, aplicabilidad, suficiencia o cumplimiento de ninguna póliza.

### HR-003 — Desagregación RCE / vida colectiva y enlaces de evidencia

- Decisión: **APROBADO DIVIDIR** el requisito genérico `legal-guarantee-policy` antes de producir la curación real.
- Nuevo requisito propuesto: `legal-rce-policy` → `category_override: habilitating` → `evidence_class_link: rce_policy`.
- Nuevo requisito propuesto: `legal-collective-life-policy` → `category_override: habilitating` → `evidence_class_link: collective_life_policy`.
- Declaración humana recibida: “Apruebo separar RCE y vida colectiva en dos requisitos, vinculados respectivamente a rce_policy y collective_life_policy”.
- Registrado: `2026-08-11T18:12:49Z` (`2026-08-11 13:12:49 COT`).
- Efecto de gobernanza: queda **rechazado para curación** el enlace único del requisito genérico; la abstención original permanece vigente hasta que extractor, manifiesto, borrador y pruebas implementen y validen la separación.
- Trabajo técnico obligatorio antes del canary: introducir los dos `requirement_id` cerrados, preservar la exclusión de garantías posteriores a la adjudicación, regenerar citas y cobertura, ejecutar TDD y someter el resultado a verificación independiente.
- Restricción: esta aprobación del modelo no afirma presencia, revisión, vigencia, aplicabilidad, suficiencia ni cumplimiento de ninguna de las dos pólizas.

### HR-004 — Abstenciones de videovigilancia/CCTV

- `requirement_id`: `technical-video-surveillance-scope`
- Eje `category_override`: **APROBADA ABSTENCIÓN** hasta contar con un requisito contractual específico y verificable.
- Eje `evidence_class_link`: **APROBADA ABSTENCIÓN**; ninguna de las 17 clases cerradas de evidencia empresarial representa el alcance técnico de CCTV.
- Declaración humana recibida: “Apruebo mantener abstención para la categoría y la clase documental de videovigilancia/CCTV hasta contar con un requisito contractual específico y verificable”.
- Fundamento presentado al revisor: 33 citas automáticas; 27 falsos positivos verificados y 6 señales relacionadas pero no cuantificables, sin cantidad, cobertura, ubicación ni especificaciones técnicas exigidas para este contrato.
- Registrado: `2026-08-11T18:14:33Z` (`2026-08-11 13:14:33 COT`).
- Restricción: la abstención no declara que CCTV no aplique; declara que la evidencia disponible no permite modelarlo honestamente como requisito cerrado ni vincularlo con una clase documental empresarial.

## Gate

Las cuatro decisiones humanas del borrador quedaron cerradas. El borrador continúa en estado `DRAFT / HUMAN_APPROVAL_REQUIRED` hasta implementar y verificar técnicamente la separación aprobada en HR-003, regenerar los mapas y someter el resultado a una validación humana final de correspondencia. No se crearán filas curadas ni se habilitará el canary sin esa validación y una autorización separada para la curación técnica.
