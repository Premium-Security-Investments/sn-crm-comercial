# Licitaciones — flujo operativo oficial

## Decisión oficial

El flujo operativo oficial de Licitaciones es:

```text
Hermes cron diario
→ llama motor oficial
→ motor guarda en Supabase
→ CRM muestra oportunidades
→ Hermes manda resumen corto al canal Discord de PSI Comercial
```

Esta decisión evita la frase ambigua “el CRM alimenta Licitaciones”. El CRM no opera solo ni tiene vida propia: **el CRM visual muestra y gestiona los datos persistidos**. Quien dispara el proceso puede ser Hermes, un cron, un usuario o la UI.

## Responsabilidades por componente

| Componente | Responsabilidad |
|---|---|
| Hermes cron diario | Disparar el proceso de radar de licitaciones en la frecuencia definida. |
| Motor oficial de Licitaciones | Consultar fuentes, normalizar registros, clasificar oportunidades y preparar persistencia. |
| Supabase | Persistir licitaciones, estados internos y corridas del radar. |
| CRM Seguridad Nacional | Mostrar, filtrar, gestionar, marcar estado y convertir licitaciones en oportunidades comerciales. |
| Hermes resumen Discord | Enviar el resumen corto operativo al canal de PSI Comercial. |

## Fuentes del radar

El radar de licitaciones debe contemplar:

- SECOP I
- SECOP II
- TVEC / Colombia Compra

## Tablas principales en Supabase

El motor oficial debe guardar y/o actualizar información en:

```text
psi_public_tenders
psi_tender_radar_runs
```

### `psi_public_tenders`

Tabla principal de licitaciones detectadas. Debe usar `stable_key` para evitar duplicados.

Campos funcionales clave:

- `stable_key`
- `source`
- `section`
- `entity`
- `dept`
- `city`
- `ref`
- `title`
- `description`
- `value`
- `status`
- `category`
- `published_at`
- `deadline_at`
- `score`
- `reasons`
- `risks`
- `url`
- `raw`
- `internal_status`
- `converted_opportunity_id`
- `reviewed_by`
- `reviewed_at`
- `last_seen_at`

### `psi_tender_radar_runs`

Tabla de auditoría/corridas del radar.

Debe registrar, como mínimo:

- fecha/hora de corrida
- disparador (`cron`, `manual`, `ui`, etc.)
- conteo por fuente
- conteo total
- conteo por sección (`hacer`, `revisar`, `descartar`)
- errores si los hubo

## Secciones operativas

El radar debe clasificar oportunidades en:

```text
Hacer
Revisar
Descartar
```

El resumen corto para Discord debe priorizar:

```text
Hacer / Revisar / Descartar / Links
```

## Regla anti-duplicados

El motor oficial debe hacer upsert usando `stable_key`.

La clave estable debe derivarse de datos persistentes de la licitación, por ejemplo:

```text
source + ref + entity
```

El objetivo es que una licitación detectada varias veces actualice el registro existente, no cree duplicados.

## Rol del CRM

El CRM debe:

1. Leer licitaciones desde Supabase.
2. Mostrar oportunidades en el módulo Licitaciones.
3. Permitir estados internos como:
   - nueva
   - en revisión
   - descartada
   - convertida en oportunidad
4. Convertir una licitación en oportunidad comercial cuando corresponda.
5. Evitar crear oportunidades duplicadas desde la misma licitación.

El CRM **no debe describirse como el actor que alimenta Licitaciones**. La formulación correcta es:

```text
Hermes dispara el proceso; el motor oficial procesa y guarda; Supabase persiste; el CRM muestra y gestiona.
```

## Rol de Hermes

Hermes debe:

1. Ejecutar el cron diario.
2. Llamar el motor oficial.
3. Verificar que el motor guarde en Supabase.
4. Preparar y enviar el resumen corto al canal de PSI Comercial.
5. Reportar errores de ejecución si el radar falla.

## Flujo esperado de punta a punta

```text
1. Cron diario de Hermes inicia el radar.
2. El motor oficial consulta SECOP I, SECOP II y TVEC.
3. El motor normaliza, clasifica y calcula stable_key.
4. El motor hace upsert en psi_public_tenders.
5. El motor registra corrida en psi_tender_radar_runs.
6. El CRM lee las licitaciones persistidas en Supabase.
7. Hermes envía resumen corto al canal Discord de PSI Comercial.
```

## Validación pendiente / checklist de implementación

Para cerrar completamente el flujo, validar:

- [ ] El cron diario de Hermes está activo.
- [ ] El cron llama el motor oficial correcto.
- [ ] El motor guarda o actualiza filas en `psi_public_tenders`.
- [ ] El motor registra la corrida en `psi_tender_radar_runs`.
- [ ] El CRM lee datos persistidos desde Supabase.
- [ ] El CRM no depende de una consulta paralela que genere resultados distintos.
- [ ] El resumen corto llega al canal Discord de PSI Comercial.
- [ ] Los upserts evitan duplicados usando `stable_key`.
- [ ] Los errores quedan visibles para operación.

## Nota de comunicación

Usar esta frase cuando se explique la arquitectura:

```text
Hermes cron diario dispara el radar; el motor oficial guarda en Supabase; el CRM muestra y gestiona las licitaciones; Hermes reporta el resumen operativo.
```

Evitar esta frase:

```text
El CRM alimenta Licitaciones.
```
