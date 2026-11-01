# AGT-002 Radar — reconciliación diaria de fuente (SECOP II) — runbook local

Proceso **bajo demanda, sin `.timer` propio**, que recorre toda la página durable de
`psi_public_tenders` con `source = 'SECOP II'` y `process_id` no nulo, la contrasta contra el
registro vivo de datos.gov.co para el mismo `id_del_proceso`, y aplica un **refresco técnico
exclusivamente**: sólo puede tocar `deadline_at`, `status`, `raw` y `last_seen_at`. Nunca toca
identidad (`id`, `process_id`, `source`, `stable_key`), nunca toca campos humanos/de negocio
(`title`, `entity`, `section`, `reviewed_by`, `reviewed_at`), y nunca toca campos de conversión.

Este artefacto **no convierte licitaciones en oportunidades, no registra GO/NO-GO, y no modifica
`internal_status` ni `converted_opportunity_id`**.

**Convertidas (decisión del dueño, 2026-10-09):** una licitación convertida en oportunidad
(`internal_status: 'convertida_oportunidad'`) cuya oportunidad NO está activa (NO GO, estado de
oferta terminal, descartada o perdida) no se consulta ni se escribe aquí: ningún proceso automático
la toca. El resultado informa cuántas se omitieron (`skipped_inactive_converted`). Las convertidas
ACTIVAS ("Por decidir" / "En curso" de la bandeja) sí se siguen conciliando (estado, cierre, datos
crudos): la revisión programada de fases sólo las ve si encuentra su familia en datos.gov.co
(entidad + referencia y cierre de los últimos 120 días), y esta conciliación nunca toca enlace ni
proceso, así que no deshace lo que deja la revisión. Una licitación sacada de la oportunidad y
devuelta al Radar (`nueva`) vuelve a ser una fila normal y sí se concilia.

## Cuándo corre

Sin `.timer`: este directorio no instala ningún temporizador. Se invoca:

- desde `ops/agt002-radar-scan/run-agt002-radar-daily-export.sh`, el wrapper diario versionado,
  inmediatamente después de un `agt002-radar-scan.service` exitoso y antes del arranque del
  pipeline de preanálisis;
- a mano, durante QA controlada, con `systemctl start agt002-radar-reconciliation.service` (unidad
  ya instalada) o ejecutando directamente `run-agt002-radar-reconciliation.mjs` con las variables
  de entorno de `env.example` cargadas en el shell local.

## Selección determinística ante duplicados de Socrata

Para cada `id_del_proceso`, Socrata puede devolver más de un registro (una corrección, una
republicación). El registro autoritativo es el de `fecha_de_ultima_publicaci` más reciente. Si dos
registros empatan en esa fecha de publicación y además discrepan en el estado resuelto
(`estado_resumen` > `fase` > `estado_del_procedimiento`) o en `fecha_de_recepcion_de`, el proceso
**no adivina**: deja ese proceso sin parchear en esta corrida (queda `ambiguous`) en vez de aplicar
un dato arbitrario.

## Fallo cerrado ante IDs inesperadamente ausentes

Si algún `process_id` durable solicitado no vuelve en la respuesta de Socrata (`missing > 0`) o si
alguna escritura falla (`failed > 0`), el resultado de `runOnce()` nunca es `success` -- no existe
una lista blanca de IDs "esperablemente ausentes". El runner de este directorio sale `1` en
cualquier estado que no sea `success`, igual que ante una excepción o configuración inválida.

### Lo que NO es un fallo: el dato sucio de la fuente (`ambiguous`)

`ambiguous` se cuenta aparte de `missing` y **no** hace fallar la corrida. La diferencia no es de
severidad sino de hecho:

- `missing` — la fuente **dejó de traernos** un proceso que nosotros tenemos. Es un hueco de
  adquisición y es nuestro problema: falla cerrado.
- `ambiguous` — la fuente **sí lo trajo**, pero publicó dos filas empatadas que se contradicen, y
  nosotros nos negamos a adivinar. Es un defecto del dato de SECOP.

Un `ambiguous` se repite en cada corrida hasta que la entidad corrija su publicación, así que
contarlo como fracaso deja el trabajo en **rojo permanente** — y un rojo permanente no se
distingue de un rojo nuevo, que es lo mismo que no tener alarma.

**Ya costó.** El 2026-10-30 el proceso `CO1.REQ.11235114` llegó con dos filas empatadas y
contradictorias. La corrida actualizó 2.175 de 2.176 procesos y salió `exit 1`. Como
`agt002-radar-daily.service` es un `oneshot` de cuatro `ExecStart` en orden y la reconciliación es
el tercero, systemd no ejecutó el cuarto: **el Top 5 de Discord no se envió ese día ni los
siguientes** (última corrida buena: 2026-10-29), en la semana en que cerraban dos licitaciones. Se
descubrió de casualidad.

La excepción sigue siendo visible —en el conteo `ambiguous` y en `errors`, con el `process_id` y el
motivo— y el proceso ambiguo nunca se parchea. Lo que cambia es que ya no apaga el resto de la
cadena.

## Escritura de `deadline_at` como compare-and-swap

Cuando este proceso decide actualizar `deadline_at`, la escritura queda condicionada (además del
`id` exacto) al valor de `deadline_at` observado en la lectura durable -- `eq('deadline_at', …)`,
o `is('deadline_at', null)` cuando no había plazo previo. Si otro escritor ya movió el plazo entre
la lectura y la escritura, el predicado no afecta ninguna fila, la verificación de retorno falla, y
la fila se cuenta como `failed`: nunca se sobreescribe un plazo concurrente más nuevo con un
recómputo basado en datos obsoletos.

## Privilegio mínimo

Este proceso sólo lee/escribe Supabase y consulta el endpoint público de Socrata; no llama al
puente Hetzner ni al modelo de preanálisis. Su `EnvironmentFile` **no** declara
`AGT002_HETZNER_BRIDGE_URL`, `AGT002_HETZNER_BRIDGE_HMAC_SECRET`, `AGT002_RADAR_PREANALYSIS_MODEL`
ni `AGT002_RADAR_PREANALYSIS_TIMEOUT_MS` -- sólo las dos credenciales de Supabase.

## Instalación (fuera de alcance local — autorización separada)

`agt002-radar-reconciliation.service` es un artefacto de deployment. Copiar secretos a la ruta
protegida fuera del repositorio (`agt002-radar-reconciliation.env`) y la unidad a su destino
habitual de `systemd`, y recargar la configuración de unidades. **No se habilita**: esta unidad no
tiene `.timer` propio y sólo arranca cuando algo la invoca explícitamente (el wrapper diario, o un
operador a mano en QA). Instalar, recargar y -si algún día se decidiera- habilitar requieren una
**autorización separada**, igual que las demás activaciones de este árbol. Ningún artefacto de
este directorio ejecuta `systemctl` por sí mismo, salvo el wrapper diario, que sólo arranca
(`start`) unidades ya instaladas, nunca las instala ni cambia su estado de habilitación.

## QA manual

```bash
systemctl start agt002-radar-reconciliation.service
journalctl -u agt002-radar-reconciliation.service -n 50 --no-pager
```

Revisar en el log una línea JSON con `status` en `{'success','partial','unavailable'}`,
`matched`/`patched`/`missing`/`ambiguous`/`conflicts`/`failed` coherentes con la corrida, y
confirmar que `status` nunca es `success` si `missing` o `failed` son mayores que cero. Un
`ambiguous` mayor que cero con `status: success` es lo esperado: la corrida hizo todo lo que podía
y la excepción queda nombrada en `errors`.

Todos los logs de este proceso quedan en el journal de la unidad, no en la salida del cron:
`journalctl -u agt002-radar-reconciliation.service`.

## Rollback

1. Ante error persistente, el wrapper diario ya falla cerrado en esta etapa (sale distinto de 0 y
   no arranca el pipeline siguiente); no hace falta una bandera adicional para detenerlo.
2. Esta reconciliación es idempotente: re-ejecutar `systemctl start
   agt002-radar-reconciliation.service` a mano es seguro, ya que vuelve a leer el estado durable y
   el registro vivo de Socrata en cada corrida.
3. Si se hubiera instalado la unidad y hiciera falta revertir, desinstalarla y recargar `systemd`
   bajo la misma autorización operativa que la instaló; el módulo `tender-source-reconciliation.js`
   y este directorio permanecen en el árbol como artefacto versionado.

Nunca almacene credenciales en este directorio. Copie `env.example` a la ubicación protegida del
environment file y complete secretos fuera de control de versiones.
