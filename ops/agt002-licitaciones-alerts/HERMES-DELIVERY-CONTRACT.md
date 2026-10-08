# Contrato de entrega para Hermes — avisos de Vig-IA Licitaciones (AGT-002)

Capacidad `agt002.licitaciones_alerts` · contrato `agt002-licitaciones-alerts-v1`.

**Reparto de responsabilidades**

- **El CRM (Vig-IA Licitaciones, AGT-002) construye** cada correo completo, con reglas fijas y sin IA: destinatarios,
  asunto, HTML y texto. Lo deja en un archivo ("outbox"). **El CRM nunca envía correo.**
- **Hermes sólo envía** esos correos tal cual, desde el buzón de Juan (`juanbotero@premiumsecurity.ai`), y deja
  constancia ("recibos"). Hermes nunca redacta, resume, corrige ni agrega nada.
- Más adelante el CRM podrá enviar directo por Microsoft leyendo este mismo outbox: el contenido, los destinatarios y
  los `id` no cambian; sólo cambia quién lo envía.

## Qué cuenta el correo

Cuando SECOP publica una fase nueva (por ejemplo, el pliego definitivo) de una licitación convertida en oportunidad y
que está **por decidir o en curso**, el CRM revisa, en este orden: el enlace nuevo, los documentos nuevos, los que pasan
a historial porque quedaron obsoletos (proyecto de pliego, anexo técnico o formatos reemplazados), el reanálisis
automático y su resultado, y lo que falló o requiere revisión humana. Cada licitación se identifica por **entidad y
valor**, con el enlace a la oportunidad en el CRM. Sólo hay correo si hubo novedad.

## Horario (hora Bogotá, America/Bogota)

| Revisión del CRM (`agt002-phase-change-review.timer`) | Envío de Hermes |
| --- | --- |
| lunes a viernes 9:00, 14:00 y 19:00 | 9:30, 14:30 y 19:30 |
| sábado y domingo 14:00 | 14:30 |

En UTC: 9:30 = 14:30 UTC, 14:30 = 19:30 UTC, 19:30 = 00:30 UTC **del día siguiente**.

## Archivos

Directorio: `/var/lib/agt002-licitaciones-alerts/` (dueño `psi-agt002`, permisos `0755`, archivos `0644`; Hermes, que
corre como root, puede leerlos y escribir recibos).

| Archivo | Para qué |
| --- | --- |
| `outbox-<run_id>.json` | Un correo por revisión con novedad (inmutable, auditoría). **Es lo que Hermes envía.** |
| `outbox-latest.json` / `outbox-latest.txt` | Copia del más reciente (el `.txt` es para personas). |
| `receipts/<run_id>.json` | Recibos que **escribe Hermes**. El CRM nunca los escribe ni los borra. |
| `reported-keys.json` | Estado interno del CRM (qué novedades ya se pusieron en un outbox). Hermes no lo usa ni lo toca. |

Todo se escribe de forma atómica (temporal + renombrar): Hermes nunca ve un archivo a medias. Una revisión sin novedad
no escribe nada.

## Formato del outbox

```json
{
  "contract": "agt002-licitaciones-alerts-v1",
  "capability": "agt002.licitaciones_alerts",
  "agent": "AGT-002",
  "run_id": "2026-10-13-0900-20261013T140003Z",
  "generated_at": "2026-10-13T14:00:03.120Z",
  "generated_day_bogota": "2026-10-13",
  "slot": "09:00",
  "sender": "juanbotero@premiumsecurity.ai",
  "item_keys": ["docs:…", "link:…"],
  "messages": [
    {
      "id": "64 caracteres hexadecimales (clave de idempotencia)",
      "kind": "licitaciones_alert",
      "to": ["juanbotero@premiumsecurity.ai", "directora.licitaciones@seguridadnacional.co"],
      "cc": [],
      "subject": "Vig-IA Licitaciones: novedades en SECOP — FONDO ÚNICO DE TECNOLOGÍAS… — $4.250.000.000",
      "text": "versión de texto plano",
      "html": "<!DOCTYPE html>…",
      "opportunities": [{ "opportunity_id": "…", "name": "…", "url": "https://seguridad-nacional-crm.vercel.app/#/detail/…" }]
    }
  ]
}
```

`id` = sha256(`agt002-licitaciones-alerts-v1` + las claves de novedad del correo). Cada novedad entra en un solo outbox,
así que un mismo correo nunca se arma dos veces; si el CRM reintentara una revisión, el `id` sería el mismo.

## Validaciones antes de enviar (si una falla, ese outbox NO se envía)

1. El archivo es JSON válido; `contract` es exactamente `agt002-licitaciones-alerts-v1` y `capability` es
   `agt002.licitaciones_alerts`.
2. `generated_at` tiene **menos de 24 horas**. Un outbox más viejo nunca se envía (ver "Outbox viejo").
3. `sender` es `juanbotero@premiumsecurity.ai` y Hermes envía desde ese mismo buzón.
4. Hay exactamente un mensaje; su `id` tiene 64 hexadecimales; `to` es exactamente
   `["juanbotero@premiumsecurity.ai", "directora.licitaciones@seguridadnacional.co"]` (en cualquier orden), `cc` vacío;
   `subject`, `html` y `text` no vacíos; el asunto empieza por `Vig-IA Licitaciones:`.

## Cómo enviar (en cada horario de envío)

1. Lista todos los `outbox-*.json` del directorio **excepto** `outbox-latest.json`, de más viejo a más nuevo.
2. Descarta los que no pasan las validaciones (los de más de 24 h, ver abajo).
3. Para cada uno: si su `id` ya aparece con `status: "sent"` en cualquier archivo de `receipts/`, no se envía (se anota
   `skipped_duplicate`). Si no, se envía desde `juanbotero@premiumsecurity.ai`:
   - Para: exactamente `to`; sin copia, sin copia oculta.
   - Asunto: exactamente `subject`.
   - Cuerpo: `html` como HTML y `text` como alternativa (multipart/alternative).
   - Sin firma automática, sin pie, sin seguimiento de apertura, sin adjuntos, sin cambiar una letra.
4. Si un envío falla, se reintenta hasta 2 veces más con unos minutos entre intentos.

Lo normal es que en un horario haya cero o un outbox nuevo (la revisión fue 30 minutos antes). Si Hermes estuvo caído,
puede haber varios del mismo día: se envían todos, en orden.

## Recibos (los escribe Hermes)

Un archivo por outbox: `receipts/<run_id>.json`, escrito de forma atómica.

```json
{
  "contract": "agt002-licitaciones-alerts-v1",
  "run_id": "2026-10-13-0900-20261013T140003Z",
  "outbox_file": "outbox-2026-10-13-0900-20261013T140003Z.json",
  "started_at": "2026-10-13T14:30:02Z",
  "finished_at": "2026-10-13T14:30:09Z",
  "results": [
    { "id": "…", "to": ["…"], "sent_at": "2026-10-13T14:30:05Z", "provider_message_id": "…", "status": "sent", "error": null }
  ]
}
```

`status`: `sent`, `failed` o `skipped_duplicate`. Un outbox que no pasa las validaciones (salvo por viejo) se anota en
`receipts/rejected-<run_id>.json` con `{ "status": "rejected", "reason": "…" }`.

## Outbox viejo

Un `outbox-<run_id>.json` de más de 24 horas sin recibo `sent` **no se envía**: Hermes escribe
`receipts/expired-<run_id>.json` con `{ "status": "expired" }` y le avisa a Juan una sola vez (asunto del correo que no
salió). Nunca se borran ni se modifican archivos `outbox-*`.

## Avisos a Juan

- **Todo bien o sin novedades: Hermes no dice nada.** (Que no haya outbox nuevo es lo normal.)
- Si un outbox es inválido, vence sin enviarse, o un correo queda `failed` tras los reintentos, Hermes le escribe a
  Juan un mensaje corto: qué pasó y qué correos no salieron (asunto). Nunca "arregla" el contenido.

## Lo que Hermes nunca hace

- Editar, resumir, traducir o completar el contenido; cambiar destinatarios o asunto.
- Enviar un outbox de más de 24 horas o que no pasó las validaciones; enviar dos veces un mismo `id`.
- Modificar o borrar archivos `outbox-*` o `reported-keys.json` (sólo escribe en `receipts/`).
- Leer la base de datos del CRM: todo lo que necesita está en el outbox.

---

## Mensaje para que Juan se lo envíe a Hermes (listo para copiar)

> Hermes, necesito un trabajo programado para enviar los avisos de Vig-IA Licitaciones. El CRM arma los correos; tú
> sólo los envías tal cual desde mi buzón juanbotero@premiumsecurity.ai. Las reglas completas están en el repositorio
> del CRM: `ops/agt002-licitaciones-alerts/HERMES-DELIVERY-CONTRACT.md`. Léelas antes de crear el trabajo.
>
> **Horario (hora Bogotá):** lunes a viernes 9:30, 14:30 y 19:30; sábado y domingo 14:30. En UTC: 14:30, 19:30 y
> 00:30 del día siguiente; fines de semana 19:30.
>
> En cada ejecución:
> 1. Mira los archivos `outbox-*.json` de `/var/lib/agt002-licitaciones-alerts/` (no `outbox-latest.json`), del más
>    viejo al más nuevo. Lo normal es que no haya ninguno nuevo: en ese caso no hagas nada ni me avises.
> 2. Envía sólo los que tengan contrato `agt002-licitaciones-alerts-v1`, se hayan generado hace menos de 24 horas y
>    vayan exactamente a juanbotero@premiumsecurity.ai y directora.licitaciones@seguridadnacional.co, sin copia.
> 3. Antes de enviar revisa `/var/lib/agt002-licitaciones-alerts/receipts/`: si el `id` del correo ya aparece como
>    enviado, no lo vuelvas a enviar.
> 4. Envía cada correo exactamente como viene (para, asunto, HTML con su versión de texto). No cambies una letra, no
>    agregues firma ni nada más.
> 5. Escribe el recibo en `receipts/<run_id>.json` (id, hora, id del proveedor, estado sent/failed/skipped_duplicate,
>    error si hubo).
> 6. Si un outbox tiene más de 24 horas y nunca se envió, no lo envíes: anota `receipts/expired-<run_id>.json` y
>    avísame una vez con su asunto.
> 7. Sólo escríbeme si algo falló, diciéndome qué correos no salieron.
>
> Confírmame cuando tengas el trabajo creado, con la fecha y hora de la próxima ejecución.
