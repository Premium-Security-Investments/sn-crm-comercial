# Recibo de autorización continua — AGT-002 C1A a R1

**Fecha:** 2026-10-04  
**Autoridad:** instrucción explícita del propietario del producto en la sesión de continuidad  
**Estado:** `ACTIVE`  
**Fin automático:** emisión verificada de `AGT002_INCREMENTAL_E2E_ACCEPTED`, revocación explícita o stop-on-fail no corregible dentro del alcance

## 1. Instrucción recibida

El propietario ordenó avanzar sin nuevas solicitudes de aprobación hasta terminar R1 y detenerse
antes de Fase 2 de Plataforma Agentes. Esta decisión posterior sustituye, sólo para el programa aquí
delimitado, los gates del plan que figuraban como pendientes de una nueva confirmación humana.

La autorización no convierte un gate técnico en un resultado aprobado: permite ejecutar el trabajo
cuando sus precondiciones objetivas estén demostradas y obliga a conservar evidencia, reversión,
readback y stop-on-fail.

## 2. Alcance autorizado

En el orden obligatorio `C1A -> C2 -> C3 -> C4 -> C5 -> C6 -> C7 -> C8`:

1. revisión, integración y preparación de release de INITIAL;
2. migraciones y despliegue de INITIAL con flags `OFF`, workers apagados y readback exacto;
3. selección gobernada de casos, un canario INITIAL y la cohorte F1 de diez oportunidades únicas;
4. diagnóstico y corrección local de REANALYSIS, incluida la regresión exacta del fallo Cali;
5. una única nueva recuperación de Cali, sólo después de corrección desplegada, readback conforme y
   precondiciones del runbook; el timer permanece apagado y rige concurrencia uno;
6. freeze de diseño R1 y materialización de sus contratos;
7. implementación R1 C4-C6 en rama/worktree aislado;
8. verificación no productiva C7;
9. despliegue R1 con flags `OFF`, un canario R1 separado y aceptación E2E C8.

No se requiere volver a solicitar al propietario los gates humanos intermedios del programa. Cada
gate debe emitir un recibo que identifique el SHA, entorno, caso exacto cuando aplique, precondiciones,
comando o mecanismo, resultado, readback y disposición de rollback.

## 3. Límites no autorizados

- Fase 2 de Plataforma Agentes y P3.2;
- cambios en AGT-003 u otros agentes;
- encendido general de timers, procesamiento masivo o recuperación de colas históricas;
- más de un canario a la vez o repetición automática de un intento incierto;
- uso de REANALYSIS para crear la primera corrida canónica;
- GO/NO-GO, firma, envío, publicación o cualquier decisión/acción comercial automática;
- exposición de documentos, prompts, evidencia o datos del dominio AGT-002 a Plataforma Agentes.

## 4. Controles vinculantes

- secuencia y fronteras del plan integrado AGT-002/R1;
- estado real y source authority comprobados antes de cada mutación;
- respaldo/restore o rollback probado cuando el cambio lo requiera;
- flags fail-closed y ejecución apagada como estado inicial de todo despliegue;
- identidad exacta del target y precondiciones leídas inmediatamente antes de cada operación;
- lectura posterior desde el sistema autoritativo, no inferida de un exit code;
- detención ante el primer fallo, salida ambigua, pérdida de linaje o diferencia de SHA/configuración;
- ninguna declaración de aceptación sin job, run, linaje, publicación y reporte canónico verificables.

## 5. Aplicación al incidente Cali

La autorización aplica únicamente a la oportunidad
`5f65461c-f25a-45da-ba9f-82b59dd5d80d` y licitación
`1d354467-e84c-4f40-9836-13ff1501535d`, para un solo intento nuevo posterior a la corrección.
No autoriza reutilizar a ciegas el job original ni la generación 2, ni ejecutar otra oportunidad.

Antes de consumir ese intento deben existir, como mínimo:

1. reproducción y corrección de `v4_discovered_input_assembly_failed` cuando el manifiesto final es vacío;
2. prueba de regresión exacta y suites transversales en PASS;
3. despliegue del SHA corregido con flags/timer apagados;
4. readback del SHA, configuración, ausencia de worker activo y estado durable del caso;
5. identidad única del nuevo job/workset y rollback/disposición terminal definidos.

Si cualquiera de estas condiciones falla o no puede comprobarse, el intento no se ejecuta y la
autorización permanece sin consumir.

## 6. Punto de detención

El programa termina al aceptar R1 E2E (`AGT002_INCREMENTAL_E2E_ACCEPTED`). En ese momento debe
detenerse: este recibo no abre `C9`, `PLATAFORMA_PHASE_2_AUTHORIZED` ni P3.2.
