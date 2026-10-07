# Contrato de entrega para Hermes — correo semanal de AGT-003

Capacidad `agt003.weekly_digest` · contrato `agt003-weekly-digest-v1`.

**Reparto de responsabilidades**

- **El CRM (AGT-003) construye** cada correo completo: destinatarios, copia, asunto, HTML y texto. Lo hace con reglas
  fijas, sin IA, y lo deja en un archivo ("outbox"). El CRM nunca envía correo.
- **Hermes sólo envía** esos correos tal cual, desde el buzón de Juan (`juanbotero@premiumsecurity.ai`), y deja
  constancia de lo que envió ("recibos"). Hermes nunca redacta, resume, corrige, traduce ni agrega nada.

## Horario

| Qué | Cuándo (UTC) | Hora Bogotá | Quién |
| --- | --- | --- | --- |
| Generación real | lunes 11:45 | 6:45 a.m. | CRM (`agt003-weekly-digest.timer`) |
| Envío real | lunes 12:00 | 7:00 a.m. | Hermes |
| Prueba (una vez) | jueves 2026-10-08 11:45 | 6:45 a.m. | CRM (`agt003-weekly-digest-preview.service`, arranque manual) |
| Envío de la prueba | jueves 2026-10-08 12:00 | 7:00 a.m. | Hermes (trabajo de una sola vez) |

## Archivos

Directorio: `/var/lib/agt003-weekly-digest/` (lo crea systemd; dueño `psi-comercial`, permisos `0755`, archivos
`0644`: Hermes, que corre como root, puede leerlos).

| Archivo | Para qué |
| --- | --- |
| `outbox-latest.json` | Outbox **real** (modo `live`) más reciente. Es el que Hermes envía los lunes. |
| `outbox-preview-latest.json` | Outbox **de prueba** (modo `preview`) más reciente. Sólo para trabajos de prueba. |
| `outbox-latest.txt`, `outbox-preview-latest.txt` | Resumen legible (para personas; Hermes no lo usa). |
| `outbox-<run_id>.json` | Copia inmutable de cada corrida (auditoría). |
| `receipts/<run_id>.json` | Recibos que **escribe Hermes** (ver abajo). El CRM nunca los escribe ni los borra. |

Los archivos `outbox-*` se escriben de forma atómica (temporal + renombrar): Hermes nunca ve un archivo a medias.
Una prueba nunca pisa el outbox real: tienen archivos distintos.

El directorio `receipts/` lo crea el generador. Si no existiera, Hermes lo crea (`mkdir -p`, permisos `0755`). Hermes
corre como root, así que puede escribir en él aunque el directorio sea de `psi-comercial`.

## Formato del outbox (lo que Hermes lee)

```json
{
  "contract": "agt003-weekly-digest-v1",
  "capability": "agt003.weekly_digest",
  "agent": "AGT-003",
  "run_id": "2026-10-12-live-20261012T114500Z",
  "generated_at": "2026-10-12T11:45:03.120Z",
  "generated_day_bogota": "2026-10-12",
  "mode": "live",
  "sample": null,
  "sender": "juanbotero@premiumsecurity.ai",
  "week": { "timezone": "America/Bogota", "last_week_start": "2026-10-05", "last_week_end": "2026-10-11", "this_week_start": "2026-10-12", "this_week_end": "2026-10-18" },
  "rules": { "recipients": "recipients-v1", "behavior": "behavior-v1" },
  "manager_profile_id": "…",
  "excluded_recipients": [{ "profile_id": "…", "name": "…", "reason": "area_comercial_solo_licitaciones" }],
  "messages": [
    {
      "id": "64 caracteres hexadecimales (clave de idempotencia)",
      "kind": "salesperson",
      "to": ["comercial@seguridadnacional.co"],
      "cc": ["directorfisica@seguridadnacional.co"],
      "subject": "Su semana en el CRM — Ana (semana del 5 al 11 de octubre)",
      "text": "versión de texto plano",
      "html": "<!DOCTYPE html>…",
      "recipient_profile_id": "…",
      "real_to": ["comercial@seguridadnacional.co"],
      "real_cc": ["directorfisica@seguridadnacional.co"]
    }
  ]
}
```

`id` = sha256(`agt003-weekly-digest-v1|modo|lunes de la semana|tipo|perfil destinatario`). Si el CRM vuelve a generar
el mismo lunes, los `id` no cambian: así Hermes sabe qué ya envió. `real_to`/`real_cc` son sólo informativos
(en la prueba muestran a quién iría el correo real); **Hermes envía a `to` y `cc`, nunca a `real_to`/`real_cc`.**

## Validaciones antes de enviar (si una falla, no se envía NADA)

1. El archivo existe y es JSON válido.
2. `contract` es exactamente `agt003-weekly-digest-v1` y `capability` es `agt003.weekly_digest`.
3. `mode` coincide con el trabajo: `live` para el trabajo de los lunes (lee `outbox-latest.json`), `preview` para el
   de prueba (lee `outbox-preview-latest.json`).
4. El outbox es de hoy: `generated_day_bogota` es la fecha de hoy en Bogotá **y** `generated_at` tiene menos de 12
   horas. En modo `live`, además, `week.this_week_start` es la fecha de hoy (lunes). Un outbox viejo nunca se envía.
5. `sender` es `juanbotero@premiumsecurity.ai` y Hermes va a enviar desde ese mismo buzón.
6. `messages` no está vacío; cada mensaje tiene `id` (64 hexadecimales, sin repetir), `to` con al menos un correo,
   `subject`, `html` y `text` no vacíos.
7. En `preview`: todos los `to` son exactamente `["juanbotero@premiumsecurity.ai"]`, todos los `cc` están vacíos y
   todos los asuntos empiezan por `[PRUEBA] `. En `live`: ningún asunto empieza por `[PRUEBA]`.

## Cómo enviar

Para cada mensaje, en el orden del archivo:

1. Si su `id` ya aparece con `status: "sent"` en cualquier archivo de `receipts/`, **no se envía** (se anota como
   `skipped_duplicate`).
2. Se envía desde `juanbotero@premiumsecurity.ai`, con:
   - Para: exactamente `to`; Copia: exactamente `cc`; sin copia oculta.
   - Asunto: exactamente `subject`.
   - Cuerpo: `html` como HTML y `text` como alternativa de texto plano (multipart/alternative).
   - Sin firma automática, sin pie agregado, sin seguimiento de apertura, sin adjuntos, sin cambiar una sola letra.
3. Si un envío falla, se reintenta ese mismo mensaje hasta 2 veces más (con unos minutos entre intentos). Los demás
   mensajes siguen su curso.

## Recibos (los escribe Hermes)

Un archivo por corrida: `receipts/<run_id>.json`, escrito de forma atómica (temporal + renombrar). Si el trabajo se
repite el mismo día, Hermes reescribe el archivo conservando los resultados anteriores y agregando los nuevos.

```json
{
  "contract": "agt003-weekly-digest-v1",
  "run_id": "2026-10-12-live-20261012T114500Z",
  "outbox_file": "outbox-latest.json",
  "mode": "live",
  "started_at": "2026-10-12T12:00:02Z",
  "finished_at": "2026-10-12T12:00:31Z",
  "results": [
    {
      "id": "…",
      "kind": "salesperson",
      "to": ["…"],
      "cc": ["…"],
      "sent_at": "2026-10-12T12:00:05Z",
      "provider_message_id": "id que devuelve el proveedor de correo",
      "status": "sent",
      "error": null
    }
  ]
}
```

`status` es uno de `sent`, `failed`, `skipped_duplicate`. Si el outbox no pasa las validaciones, Hermes escribe
`receipts/rejected-<fecha UTC>.json` con `{ "status": "rejected", "reason": "…" }` y no envía nada.

## Avisos a Juan

- **Todo bien: Hermes no dice nada.**
- Si el outbox falta, es viejo o es inválido, o si algún mensaje queda en `failed` después de los reintentos, Hermes
  le escribe a Juan un mensaje corto: qué pasó, cuántos correos salieron y cuáles no (por destinatario y asunto).
  Nunca reenvía por su cuenta un outbox distinto ni "arregla" el contenido.

## Lo que Hermes nunca hace

- Editar, resumir, traducir o completar el contenido; cambiar destinatarios o asunto.
- Enviar un outbox viejo, de otro modo (`preview` en vez de `live` o al revés) o que no pasó las validaciones.
- Enviar dos veces un mismo `id`.
- Modificar o borrar archivos `outbox-*` (sólo escribe en `receipts/`).
- Leer la base de datos del CRM o calcular cifras: todo lo que necesita está en el outbox.

---

## Mensaje para que Juan se lo envíe a Hermes (listo para copiar)

> Hermes, necesito que crees dos trabajos programados para enviar el correo semanal del CRM comercial. El CRM arma los
> correos; tú sólo los envías tal cual desde mi buzón juanbotero@premiumsecurity.ai. Las reglas completas están en
> el repositorio del CRM: `ops/agt003-weekly-digest/HERMES-DELIVERY-CONTRACT.md`. Léelas antes de crear los trabajos.
>
> 1. **Prueba, una sola vez: mañana jueves 8 de octubre de 2026 a las 12:00 UTC (7:00 a.m. de Bogotá).** Lee
>    `/var/lib/agt003-weekly-digest/outbox-preview-latest.json`. Verifica que el contrato sea
>    `agt003-weekly-digest-v1`, que el modo sea `preview`, que se haya generado hoy y que todos los correos vayan sólo
>    a juanbotero@premiumsecurity.ai, sin copia y con asunto que empiece por "[PRUEBA] ". Si todo está bien, envía
>    cada correo exactamente como viene (para, copia, asunto, HTML con su versión de texto). Deberían ser 2 correos:
>    un ejemplo de comercial y el resumen del gerente. Después de enviar, borra este trabajo.
>
> 2. **Recurrente: todos los lunes a las 12:00 UTC (7:00 a.m. de Bogotá).** Lee
>    `/var/lib/agt003-weekly-digest/outbox-latest.json`. Verifica que el contrato sea `agt003-weekly-digest-v1`, que
>    el modo sea `live`, que se haya generado hoy y que la semana empiece hoy. Si todo está bien, envía cada correo
>    exactamente como viene, con sus destinatarios y su copia.
>
> En los dos trabajos:
> - No cambies ni una letra del contenido, ni los destinatarios, ni el asunto. No agregues firma ni nada más.
> - Antes de enviar cada correo revisa `/var/lib/agt003-weekly-digest/receipts/`: si ese `id` ya aparece como
>   enviado, no lo vuelvas a enviar.
> - Al terminar escribe el recibo en `/var/lib/agt003-weekly-digest/receipts/<run_id>.json` con, para cada correo: id,
>   hora de envío, id del mensaje que te dé el proveedor, estado (sent, failed o skipped_duplicate) y error si hubo.
> - Si el archivo no existe, es de otro día o no pasa las validaciones, no envíes nada y avísame.
> - Si todo sale bien no me avises. Sólo escríbeme si algo falló, diciéndome qué correos no salieron.
>
> Confírmame cuando tengas los dos trabajos creados, con la fecha y hora de la próxima ejecución de cada uno.
