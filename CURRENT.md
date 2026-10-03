# CURRENT — SIIO Comercial / Licitaciones / Vig‑IA

**Corte autoritativo:** 2026-08-06 08:33 COT · 2026-08-06 13:33 UTC

**Repositorio verificado:** `/root/worktrees/siio-vigia-phase1-gpt`

**Rama de trabajo:** `fix/agt002-canonical-current`

**HEAD verificado:** `2904efb` — `test(agt002): cover missing worker secret fail-closed (#79)`

**Base:** `origin/main` en el mismo commit

**Producción canónica:** https://seguridad-nacional-crm.vercel.app

**Estado productivo del rediseño integral:** no desplegado; la versión exacta de producción y los flags deben verificarse nuevamente antes de cualquier rollout.

## 1. Regla funcional vigente

El encargado de Licitaciones selecciona manualmente un caso del Radar y lo convierte en **Oportunidad**. Esa conversión humana es el gate para entrar al pipeline durable.

Vig‑IA debe analizar y organizar evidencia; nunca debe:

- analizar indiscriminadamente todo el Radar;
- convertir procesos en oportunidades;
- decidir GO/NO GO;
- firmar, enviar o presentar ofertas;
- convertir presencia documental en cumplimiento automático;
- inventar responsables nominales, fechas, vigencia o aplicabilidad.

Orden operativo obligatorio del análisis:

1. alertas de descarte;
2. habilitantes jurídicos y empresariales;
3. requisitos técnicos;
4. capacidad financiera y riesgos de ejecución;
5. conveniencia comercial y estratégica.

La decisión GO/NO GO permanece humana y trazable. `CT-02B` continúa en `NO_GO` hasta una nueva decisión humana explícita.

## 2. Estado confirmado al corte

### 2.1 Caso Pereira corregido

Se completó el reanálisis corregido de Rama Judicial Pereira 2026 sobre un snapshot inmutable de 17 documentos.

- oportunidad: `54190e51-15fb-46af-b0aa-8f13461a3110`;
- snapshot: `c33159a5-defe-4a6f-8fa4-68c5ceb60e59`;
- contexto corregido: `2f11db30-0165-4a24-bd80-e2b655caf7ab`;
- run histórico preservado: `50f798f0-a526-421f-bd26-7b0e5dd0d5da`;
- run corregido: `df57f945-79ea-49dd-8300-9005f3da9c60`;
- política: `agt002-preview-policy-v2`;
- estado: `completed`.

La licencia de SuperVigilancia ya no se trata como ausente. El análisis reconoce la Resolución `20214100005697`, con vigencia observada hasta `2029-05-10`. La duda pendiente se limita correctamente a su aplicabilidad contractual: servicio armado, medios/armas autorizados y cobertura territorial exigida al cierre.

La validación visual de Pereira confirmó que no se inventaron respuestas humanas ni se solicitó volver a cargar la licencia.

### 2.2 Evidencia empresarial disponible

La migración `061_agt002_company_evidence_registry.sql` registra 17 clases de evidencia de Base Maestra. Todas permanecen como información reportada, pendientes de revisión humana y validación de aplicabilidad por proceso.

Límite estructural confirmado:

- sólo la licencia de SuperVigilancia se transporta como campo empresarial específico;
- las otras 16 clases se comprimen dentro de `recurring_documents`;
- esa compresión mezcla RUP, RUT, comunicaciones, uniformes, sanciones, armas, pólizas, experiencia, financieros, certificación bancaria, horas extras, antecedentes, representantes, personal y criterios diferenciales;
- la presencia del metadato no prueba contenido, vigencia, suficiencia, aplicabilidad ni cumplimiento.

### 2.3 SharePoint / Base Maestra

No existe evidencia de una sincronización directa y completa de SharePoint en cada análisis. El enlace directo auditado no fue accesible desde este entorno y la documentación original ubicaba SharePoint fuera del MVP.

Por tanto, no se debe afirmar que Vig‑IA “usó todo SharePoint”. El estado honesto es:

- registro provisional de 17 clases disponible;
- cobertura documental completa no demostrada;
- reconciliación idempotente SharePoint → registro → dossier/contexto pendiente;
- PII, armas, banca y anexos nominales deben permanecer segregados en bóvedas restringidas.

### 2.4 Contrato, prompt y UI actuales

La auditoría confirmó:

- el contrato v2 produce recomendación, resumen y listas narrativas;
- no obliga a incluir impacto, evidencia faltante, responsable, hito, escalamiento, subsanabilidad ni condición de cierre;
- la política evita alucinaciones y GO/NO GO automático, pero no obliga a convertir hallazgos en trabajo priorizado;
- la recuperación documental se concentra en frentes `legal`, `financial` y `technical`;
- faltan dominios explícitos para capacidad organizacional, experiencia, operación, SST/personal, seguros/garantías, evaluación comercial y estrategia;
- la UI compactada eliminó la presentación jurídica sin reemplazarla por una vista operativa integral;
- persisten códigos internos que deben traducirse a lenguaje de Licitaciones.

### 2.5 Corpus jurídico

El corpus auditado contiene seis fuentes. Al corte de la revisión, sólo una era elegible como fuente jurídica verificada; las demás exigían abstención por vigencia, modificación o aplicabilidad no confirmadas.

Debe preservarse el comportamiento fail-closed. Las normas serán soporte desplegable de cada requisito, no una lista principal ni una conclusión automática.

### 2.6 Auditoría independiente con Claude Opus

La auditoría propia comercial, jurídica, documental, técnica y de arquitectura está realizada. La revisión independiente nueva con Claude Opus **no se ejecutó**.

Todos los intentos recientes fueron bloqueados antes de llamar a Claude por:

```text
Heavy-work concurrency limit reached. Active category=dynamic-execution, pid=2366109.
```

El PID corresponde al gateway permanente de Hermes, no a una prueba o revisor hijo visible. No se reinició ni detuvo el gateway sin autorización. No se debe atribuir a Claude ninguna opinión inexistente.

## 3. Evaluación del análisis actual

El análisis vigente aporta diagnóstico preliminar, pero todavía no funciona como sistema operativo de Licitaciones.

Problemas principales:

1. mezcla evidencia reportada con fortalezas comprobadas;
2. agrupa demasiados frentes en recomendaciones generales;
3. no prioriza bloqueadores, subsanables, validaciones internas, consultas externas y riesgos de ejecución;
4. obliga a la encargada a deducir tareas, responsables y fechas;
5. no muestra con precisión qué condición habilita solicitar la decisión humana;
6. no acredita cobertura completa de las fuentes empresariales;
7. no integra el fundamento jurídico con el requisito y la acción.

Conclusión: el rediseño debe ser estructural —contrato, contexto, política, persistencia y UI—, no un ajuste cosmético del prompt o una restauración literal del panel jurídico anterior.

## 4. Diseño objetivo acordado como base de revisión

Cada requisito del pliego debe conectar:

> requisito → evidencia del proceso → evidencia empresarial → estado → impacto → conclusión → acción → responsable sugerido → fecha/hito → criterio de escalamiento → condición de cierre → soporte jurídico.

Dominios mínimos:

- descarte;
- jurídico/habilitante;
- financiero;
- organizacional;
- experiencia;
- técnico;
- operativo;
- SST y personal;
- seguros y garantías;
- comercial;
- estratégico.

Estados de cumplimiento operativos:

- cumplimiento comprobado;
- evidencia encontrada pendiente de validación;
- pendiente documental;
- requiere aclaración;
- posible incumplimiento;
- no aplica.

Impactos que deben permanecer separados:

- inhabilitante o de descarte;
- subsanable;
- previo a presentar;
- afecta puntaje;
- obligación contractual o riesgo de ejecución;
- riesgo comercial;
- sin impacto actual en habilitación.

La UI objetivo será compacta y ordenada así:

1. recomendación condicionada y estado de preparación;
2. bloqueadores críticos y tiempo/hito próximo;
3. matriz priorizada por requisito;
4. plan de acción derivado;
5. riesgos de participación y ejecución;
6. evidencia, cobertura y normas en desplegables;
7. decisión humana separada.

## 5. Próximos pasos determinados

### P0 — Cerrar la revisión antes de código

1. Resolver el bloqueo de concurrencia de Hermes mediante reinicio controlado del gateway, sólo con autorización.
2. Ejecutar Claude Code CLI con `--model opus` en modo read-only.
3. Contrastar tres alternativas:
   - parche UI/prompt;
   - contrato integral versionado sobre fuentes verificables;
   - integración completa de SharePoint antes del rediseño.
4. Consolidar recomendación y obtener aprobación humana del diseño.

**Gate P0:** no iniciar implementación integral ni desplegar cambios de UI sin contraste y aprobación del diseño.

### P1 — Verdad de datos y canonicidad

5. Implementar con TDD la promoción transaccional del run `current/canonical`:
   - un solo canónico por oportunidad;
   - historial preservado;
   - supersesión explícita;
   - concurrencia segura;
   - idempotencia demostrada.
6. Transportar las 17 clases empresariales como objetos separados y tipados.
7. Implementar cobertura explícita: fuentes disponibles, seleccionadas, omitidas, vencidas, inaccesibles o pendientes de revisión.
8. Cerrar la reconciliación idempotente SharePoint/Base Maestra → registro → dossier/contexto, sin mover datos sensibles a la capa general.

**Gate P1:** ninguna evidencia `reported` puede aparecer como cumplimiento; dos runs nunca pueden permanecer `canonical=true` para una misma oportunidad.

### P2 — Contrato integral v3

9. Crear pruebas rojas del nuevo contrato y compatibilidad legacy.
10. Versionar esquema, política y flag fail-closed.
11. Incorporar matriz por requisito, impactos, evidencia faltante, acción, rol, hito, escalamiento y condición de cierre.
12. Integrar el corpus jurídico por requisito y conservar la abstención.
13. Derivar el plan de trabajo desde requisitos pendientes/bloqueados; no producir una segunda lista desconectada.
14. Mantener los runs históricos v2 consultables sin reescribirlos.

**Gate P2:** hallazgos sin evidencia permitida son rechazados; fechas y responsables nominales no pueden ser inventados por el modelo.

### P3 — UI operativa

15. Sustituir listas narrativas por la vista compacta integral.
16. Restituir lo jurídico dentro de cada requisito, con normas desplegables.
17. Humanizar códigos internos como `pending_case_validation` y `human_legal_review`.
18. Mostrar cobertura parcial y última reconciliación sin afirmar uso completo de SharePoint.
19. Mantener la decisión humana GO/NO GO fuera del análisis automático.

**Gate P3:** Licitaciones debe poder identificar en una sola vista qué bloquea, qué hacer, quién debe resolverlo y antes de qué hito.

### P4 — Verificación y rollout

20. Ejecutar pruebas unitarias y de contrato.
21. Ejecutar integración DB y concurrencia canónica.
22. Verificar paridad Express/Vercel.
23. Ejecutar TypeScript, build y regresión completa secuencial.
24. Validar ruta ordinaria E5 con un caso controlado.
25. Reanalizar un caso histórico sin sobrescribir versiones previas.
26. Realizar una revisión independiente única del lote.
27. QA visual autenticado operado por Juan: un paso, esperar captura y no avanzar sin validación.
28. Validar con la sesión de Katherine que Configuración permite editar la ficha y mantiene documentos en sólo lectura.
29. Desplegar gradualmente, verificar producción, observabilidad y rollback.
30. Actualizar nuevamente `CURRENT.md` con commit, deployment, flags y evidencia mecánica reales.

**Gate P4:** no declarar listo ni desplegar ampliamente sin pruebas frescas, build, revisión independiente y validación visual.

## 6. Prioridad inmediata al retomar

1. Autorizar o coordinar el reinicio controlado del gateway para liberar la revisión Opus.
2. Cerrar diseño integral y aprobación humana.
3. Implementar primero unicidad canónica y catálogo empresarial tipado.
4. Implementar contrato v3 y UI operativa con TDD.
5. Completar E5, QA visual y rollout.

## 7. Pendientes que siguen abiertos

- revisión independiente nueva con Claude Opus;
- aprobación del diseño integral;
- unicidad/promoción canónica;
- ruta ordinaria E5;
- sincronización completa SharePoint/Base Maestra;
- contrato integral v3;
- bloque jurídico accionable;
- brief operativo y nomenclatura humanizada;
- pruebas, build, revisión independiente, QA visual y deploy;
- validación visual con Katherine.

## 8. Límites y seguridad

- No se exponen credenciales, tokens, cookies, cadenas de conexión ni archivos `.env`.
- No se copian PII, inventarios de armas, cuentas bancarias o anexos nominales a la capa general.
- No se automatiza GO/NO GO, firma, envío o presentación.
- No se afirma cobertura SharePoint completa sin reconciliación demostrable.
- No se sobrescriben análisis históricos.
- No se hará deploy del rediseño hasta completar sus gates.
