# AGT-002 Radar — exploración diaria (scan) — runbook local

Proceso **bajo demanda, sin `.timer` propio**, que ejecuta `esu_refresh → fetch → gate → ledger →
enqueue` sobre la página acotada de `psi_public_tenders` (hasta `maxTendersPerRun`, 250 por
defecto) **una vez por invocación**. Nunca reclama un job de la cola y nunca invoca al proveedor
AGT-002: esos dos verbos no existen en la firma de `createAgt002RadarScan`, así que ninguna llamada
futura accidental puede colarlos aquí. El drenado de la cola (`claim` → preanálisis) vive en el
proceso vecino, `ops/agt002-radar-pipeline/` (el worker de 15 minutos), documentado por separado.

Este artefacto **no convierte licitaciones en oportunidades**, no registra GO/NO-GO y no modifica
`internal_status` ni `converted_opportunity_id`.

## Cuándo corre

Sin `.timer`: este directorio no instala ningún temporizador. Se invoca:

- desde `ops/agt002-radar-scan/run-agt002-radar-daily-export.sh`, el wrapper diario versionado que
  encadena `export → systemctl start agt002-radar-scan.service → systemctl start
  agt002-radar-pipeline.service` tras cada exportación de fuente exitosa del cron de Hermes;
- a mano, durante QA controlada, con `systemctl start agt002-radar-scan.service` (unidad ya
  instalada) o ejecutando directamente `run-agt002-radar-scan.mjs` con las variables de entorno de
  `env.example` cargadas en el shell local.

## Estado seguro por defecto

`env.example` mantiene:

```dotenv
AGT002_RADAR_GATE=false
```

Con `AGT002_RADAR_GATE=false`, el runner responde `disabled` sin consultar base de datos, refrescar
ESU, ni encolar nada. Sólo los literales `'true'`/`'1'` (con `trim`, sin distinción de mayúsculas)
lo encienden; cualquier otro valor lo deja apagado. `AGT002_RADAR_GATE` sigue gobernando ambos
procesos (scan y worker) a la vez: no se introdujo un flag nuevo para separarlos.

## Privilegio mínimo — por qué este `env.example` es más corto que el del worker

El scan nunca llama al puente Hetzner ni al modelo de preanálisis, así que su `EnvironmentFile`
**no** declara `AGT002_HETZNER_BRIDGE_URL`, `AGT002_HETZNER_BRIDGE_HMAC_SECRET`,
`AGT002_RADAR_PREANALYSIS_MODEL` ni `AGT002_RADAR_PREANALYSIS_TIMEOUT_MS`. Sólo necesita las dos
credenciales de Supabase y el flag. El refresco ESU tampoco necesita variables adicionales:
`esu-direct-crawl.js` no lee `process.env`.

## Código de salida — asimetría deliberada frente al worker

El runner de este directorio sale `1` no sólo ante configuración inválida o excepción, sino también
cuando `runOnce()` devuelve `status:'unavailable'` (fallo de `fetch`/`gate`/`ledger`). Sin eso, la
unidad quedaría `active (exited)` con código 0 pese al fallo, `systemctl start` devolvería 0 y el
wrapper diario reportaría un día bueno mientras no se encoló nada — y el siguiente intento sería al
día siguiente, no en 15 minutos. El runner del worker (`ops/agt002-radar-pipeline/`) **no** tiene
esta asimetría: para él, `stale_input` es un desenlace normal del drenado, no un motivo para marcar
la unidad como fallida.

## Instalación (fuera de alcance local — autorización separada)

`agt002-radar-scan.service` es un artefacto de deployment. Copiar secretos a la ruta protegida fuera
del repositorio (`agt002-radar-scan.env`) y la unidad a su destino habitual de `systemd`, y recargar
la configuración de unidades. **No se habilita**: esta unidad no tiene `.timer` propio y sólo
arranca cuando algo la invoca explícitamente (el wrapper diario, o un operador a mano en QA).
Instalar, recargar y —si algún día se decidiera— habilitar requieren una **autorización separada**,
igual que las demás activaciones de este árbol. Ningún artefacto de este directorio ejecuta
`systemctl` por sí mismo, salvo el wrapper diario, que sólo arranca (`start`) unidades ya
instaladas, nunca las instala ni cambia su estado de habilitación.

## QA manual

```bash
systemctl start agt002-radar-scan.service
journalctl -u agt002-radar-scan.service -n 50 --no-pager
```

Revisar en el log una línea JSON con `status` en `{'disabled','completed','unavailable'}` — nunca
`claim`/`agt`/`persist` en `stages`: este proceso no los tiene. Con `AGT002_RADAR_GATE=true`,
confirmar que `stages` termina en `enqueue` y que `evaluated`/`survivors`/`enqueued`/`satisfied`/
`rejected` son coherentes con la corrida.

Todos los logs de este proceso quedan en el journal de la unidad, no en la salida del cron:
`journalctl -u agt002-radar-scan.service`.

## Rollback

1. Ante error persistente, poner `AGT002_RADAR_GATE=false` en
   `/etc/psi-comercial/agt002-radar-scan.env` para detener nuevas evaluaciones/encolados de este
   proceso (no afecta al drenado del worker sobre lo ya encolado).
2. El ledger de gate y la cola son append-only/durables: un fallo de scan no pierde evidencia ni
   jobs ya encolados; sólo pospone el próximo encolado hasta la siguiente invocación exitosa.
3. Re-ejecutar `systemctl start agt002-radar-scan.service` a mano es seguro e idempotente: el corto
   circuito `satisfied` del encolado y la clave diaria del ledger de gate evitan duplicar trabajo.
4. Si se hubiera instalado la unidad y hiciera falta revertir, desinstalarla y recargar `systemd`
   bajo la misma autorización operativa que la instaló; el módulo `agt002-radar-scan.js` y este
   directorio permanecen en el árbol como artefacto versionado.

Nunca almacene credenciales en este directorio. Copie `env.example` a la ubicación protegida del
environment file y complete secretos fuera de control de versiones.
