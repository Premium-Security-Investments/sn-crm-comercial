# AGT-003 — correo semanal del CRM comercial (`agt003.weekly_digest`)

Contrato `agt003-weekly-digest-v1`. Cada lunes el CRM arma los correos de la semana y Hermes los envía desde el buzón
de Juan. El CRM **nunca envía correo**: deja un outbox auditable en `/var/lib/agt003-weekly-digest/` y Hermes lo
entrega según [HERMES-DELIVERY-CONTRACT.md](./HERMES-DELIVERY-CONTRACT.md).

## Qué hay aquí

| Archivo | Qué es |
| --- | --- |
| `../../src/vigia/weekly-digest.js` (+ `.d.ts`) | Regla pura: arma el outbox. Sin red, sin base de datos, sin IA. |
| `run-agt003-weekly-digest.mjs` | Runner: lee Supabase (sólo lectura), llama la regla y escribe el outbox. Nunca envía. |
| `agt003-weekly-digest.service` | Generación real (`--mode=live`). Oneshot, usuario `psi-comercial`, endurecido como el radar. |
| `agt003-weekly-digest.timer` | Lunes 11:45 UTC (6:45 a.m. Bogotá), `Persistent=true`. |
| `agt003-weekly-digest-preview.service` | Prueba manual (`--mode=preview --sample=1`): todo va a Juan. Sin timer. |
| `env.example` | Variables opcionales (`/etc/psi-comercial/agt003-weekly-digest.env`). |
| `render-fixture-samples.mjs` | Renderiza los correos de datos ficticios a `tmp-samples/` para revisarlos. |
| `HERMES-DELIVERY-CONTRACT.md` | Qué lee Hermes, qué valida, cómo envía, recibos y mensaje listo para Hermes. |

## Reglas (decisiones del dueño, 2026-10-07)

- **Quién recibe correo personal:** cada perfil activo, humano, con rol `comercial`. Se excluye por regla (no por
  nombre) al comercial cuya área comercial es sólo licitaciones: todas sus asignaciones con `area_code = 'comercial'`
  tienen `subarea_code = 'licitaciones'` (su trabajo es AGT-002). Admin, gerencia y director no reciben correo
  personal aunque tengan oportunidades. Juan no recibe copias.
- **Gerente comercial:** `AGT003_DIGEST_MANAGER_EMAIL` (por defecto `directorfisica@seguridadnacional.co`), validado
  contra un perfil activo y humano. Recibe el resumen del equipo y va en copia de cada correo personal.
- **Semana:** lunes a domingo, hora de Bogotá. "La semana pasada" (seguimientos y decisiones) es la anterior a la
  semana en que se genera; "Para esta semana" es la semana en curso. Los asuntos nombran la semana pasada.
- **Estado, pendientes, agenda, último ingreso:** `buildCommercialBehavior()` (`behavior-v1`), la misma regla de
  "¿Quién necesita ayuda?" del Dashboard. Por decidir: `pendingDecisions()`. Meta: `monthlyGoalCompliance()`.
- **Sólo pipeline comercial privado de AGT-003** (`commercial-scope.js`). Nunca se leen notas de seguimientos ni
  observaciones; no hay ids internos en el contenido.
- **Prueba (`--mode=preview`)**: todo va a `juanbotero@premiumsecurity.ai`, sin copia, asunto con `[PRUEBA] ` y un
  aviso arriba con los destinatarios reales. `--sample=N` deja N comerciales (los de más oportunidades activas) más el
  resumen del gerente (del equipo completo). En `live` no existe la muestra: el envío real nunca es parcial.

## Runner

```
node ops/agt003-weekly-digest/run-agt003-weekly-digest.mjs --mode=preview|live [--sample=N] [--out-dir=DIR] [--dry]
```

- Credenciales: `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` del `EnvironmentFile` del radar
  (`/etc/psi-comercial/agt002-radar-scan.env`). Sólo hace `select`.
- `ENV_FILE=/ruta` carga un archivo `KEY=VALUE` para corridas manuales (no imprime su contenido).
- Salida: `outbox-<run_id>.json` y, por modo, `outbox-latest.json`/`.txt` (live) u
  `outbox-preview-latest.json`/`.txt` (preview), escritos de forma atómica. Crea `receipts/` para Hermes.
- `--dry`: imprime el resumen y escribe en un directorio temporal (o en `--out-dir`).
- Código de salida: `0` bien; `1` error de lectura/escritura; `2` uso incorrecto; `3` validación (sin destinatarios,
  correo inválido, gerente no encontrado, URL no https, `--sample` en live). Si sale distinto de `0`, no se toca
  ningún puntero `latest` y Hermes, al ver un outbox viejo, no envía nada.

Prueba local sin producción: `node ops/agt003-weekly-digest/render-fixture-samples.mjs` (datos ficticios →
`tmp-samples/*.html`, ignorado por git).

## Instalación (la hace una persona con sudo; Claude no la ejecuta)

Igual que las unidades del radar: el código corre desde una release inmutable
`/opt/psi-comercial/releases/<sha>` y un drop-in `10-release.conf` fija la ruta. Primero se fusiona el PR y se
prepara la release del commit de `main` con `ops/release/build-release.sh` (copia de solo lectura del commit con
sus dependencias ya enlazadas; no hay que enlazar `node_modules` a mano). En lo que sigue, `SHA` es ese commit.

```bash
SHA=<commit de main>
sudo ops/release/build-release.sh $SHA      # desde un checkout del repo; termina en RELEASE_OK
REPO=/opt/psi-comercial/releases/$SHA

# 1. Unidades
sudo install -m 0644 $REPO/ops/agt003-weekly-digest/agt003-weekly-digest.service         /etc/systemd/system/
sudo install -m 0644 $REPO/ops/agt003-weekly-digest/agt003-weekly-digest-preview.service /etc/systemd/system/
sudo install -m 0644 $REPO/ops/agt003-weekly-digest/agt003-weekly-digest.timer           /etc/systemd/system/

# 2. Drop-ins de release (mismo patrón que agt002-radar-top5.service.d/10-release.conf)
for unit in agt003-weekly-digest agt003-weekly-digest-preview; do
  args='--mode=live'; [ "$unit" = agt003-weekly-digest-preview ] && args='--mode=preview --sample=1'
  sudo mkdir -p /etc/systemd/system/$unit.service.d
  printf '[Service]\nWorkingDirectory=%s\nExecStart=\nExecStart=/usr/bin/node %s/ops/agt003-weekly-digest/run-agt003-weekly-digest.mjs %s\n' \
    "$REPO" "$REPO" "$args" | sudo tee /etc/systemd/system/$unit.service.d/10-release.conf >/dev/null
done

# 3. (Opcional) variables propias; los valores por defecto ya son los del dueño
sudo install -m 0640 -o root -g psi-comercial $REPO/ops/agt003-weekly-digest/env.example /etc/psi-comercial/agt003-weekly-digest.env

# 4. Recargar y activar SOLO el timer (no ejecuta nada ahora; la primera corrida es el lunes 11:45 UTC)
sudo systemctl daemon-reload
sudo systemctl enable --now agt003-weekly-digest.timer
systemctl list-timers agt003-weekly-digest.timer
```

### Prueba de mañana (jueves 2026-10-08)

Hermes envía la prueba a las 12:00 UTC; el outbox de prueba debe generarse antes, a las **11:45 UTC**:

```bash
sudo systemctl start agt003-weekly-digest-preview.service      # a las 11:45 UTC
cat /var/lib/agt003-weekly-digest/outbox-preview-latest.txt     # 2 mensajes, ambos para juanbotero@premiumsecurity.ai
journalctl -u agt003-weekly-digest-preview.service -n 20 --no-pager
```

Para no depender de estar despierto a esa hora, se puede programar una sola vez (temporizador transitorio, desaparece
después de correr):

```bash
sudo systemd-run --unit=agt003-weekly-digest-preview-once --on-calendar='2026-10-08 11:45:00 UTC' \
  /bin/systemctl start agt003-weekly-digest-preview.service
```

Correr la prueba otra vez el mismo día genera un outbox nuevo con los mismos `id`; si Hermes ya lo envió, no lo
repite. Para repetir el envío de prueba hay que pedírselo a Hermes explícitamente (y mover su recibo).

### Revisar una corrida real

```bash
systemctl status agt003-weekly-digest.service
journalctl -u agt003-weekly-digest.service -n 30 --no-pager
cat /var/lib/agt003-weekly-digest/outbox-latest.txt
ls /var/lib/agt003-weekly-digest/receipts/
```

## Si algo falla

- **El generador falló (código 3 = validación):** el journal dice el motivo (`agt003_weekly_digest_invalid`). No hay
  outbox nuevo y Hermes no envía nada ese lunes (outbox viejo). Corregir el dato en el CRM y correr
  `sudo systemctl start agt003-weekly-digest.service` el mismo día; luego pedirle a Hermes que envíe.
- **El servidor estuvo apagado a las 11:45:** `Persistent=true` genera al arrancar; si fue después de las 12:00,
  Hermes ya habrá avisado del outbox viejo y hay que pedirle que envíe a mano ese mismo día.
- **Apagar el correo:** `sudo systemctl disable --now agt003-weekly-digest.timer` y pedirle a Hermes que pause su
  trabajo de los lunes.
- **Desinstalar:** deshabilitar el timer, borrar las tres unidades y sus `.service.d`, `daemon-reload`. El historial
  en `/var/lib/agt003-weekly-digest/` se puede conservar como auditoría.
