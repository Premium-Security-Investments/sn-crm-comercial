# Gerencia: fuentes financieras externas

Este incremento prepara lecturas de un libro diario en Drive/SharePoint y balances
por cuenta desde Avancys/Odoo. Los tres adaptadores son ejecutables y están probados
con respuestas simuladas. No hay fuente real conectada ni sincronización programada
activada. No sustituye la revisión humana ni la carga manual desplegada con PR #345.

## Configuración pendiente

Copiar `config/siio-financial-sources.example.json` fuera del repositorio, a una ruta
privada del operador. Las fuentes vienen deshabilitadas. No poner secretos en JSON:
los campos terminados en `Env` contienen nombres de variables, nunca sus valores.

```bash
node scripts/siio-financial-source.mjs check-config \
  --config config/siio-financial-sources.example.json
```

Este comando no usa la red. `configured_unverified` significa configuración presente,
no acceso comprobado. Para un operador con acceso se puede leer y preparar un corte:

```bash
node scripts/siio-financial-source.mjs stage \
  --config /ruta/privada/fuentes.json \
  --source finanzas-drive \
  --period 2026-04-01 --cutoff 2026-04-15 \
  --output /ruta/privada/cortes-financieros
```

`--period` y `--cutoff` son fechas contables explícitas. No se deducen de la fecha de
modificación de un archivo ni de la fecha del servidor. El ejemplo no indica que abril
sea el periodo diario actual: el operador debe elegir el periodo del libro real.

## Drive

- Completar `fileUrl` con el enlace del archivo binario XLSM o `fileId` con su ID estable.
  Se aceptan enlaces `drive.google.com/file/d/...`, `open?id=...` y `uc?id=...`.
- El `resourcekey` de un enlace se conserva en la consulta, cuando existe.
- Usar OAuth con refresh token (`google_refresh`), con permiso de lectura al archivo,
  o un proveedor externo que renueve `access_token` antes de cada ejecución.
- Metadatos/versiones se leen antes y después del contenido. Se comprueba tamaño y
  MD5 cuando Drive lo proporciona. Versiones distintas se rechazan y no avanzan el corte.
- Google Sheets y XLSX no están soportados por el parser contable actual. Para esos
  formatos se requiere un incremento con pruebas; no renombrar el archivo para forzarlo.

## SharePoint

- Completar `shareUrl` con un enlace directo al archivo dentro de `/sites/...` o `/teams/...`
  (también admite `/:x:/r/sites/...`). El conector busca el sitio y su biblioteca, con
  paginación, y resuelve el archivo por ruta mediante consultas de lectura.
- Alternativamente completar `driveId` y `itemId`. No combinar IDs con `shareUrl`.
- Un enlace opaco `/:x:/s/...` requiere obtener IDs o un enlace con ruta. No se usa
  `/shares` ni `Prefer: redeemSharingLink`, para no necesitar permisos de escritura
  ni alterar el acceso compartido.
- `microsoft_client_credentials` renueva el token de la aplicación. La autorización de
  Microsoft debe dar lectura a los sitios/archivos requeridos; preferir acceso acotado
  al sitio y comprobar los endpoints elegidos. El conector no concede permisos.
- Se comprueba eTag antes/después. La descarga preautenticada sólo admite hosts de
  SharePoint y nunca recibe el bearer token de Microsoft Graph.

## Avancys/Odoo

Completar URL HTTPS raíz de Avancys, nombre de base, ID de empresa y referencia a la
API key de una cuenta de integración de sólo lectura. Para `jsonrpc`, completar además
el usuario. Para `json2`, la identidad proviene de la API key y se envía la base en
`X-Odoo-Database`.

Hay dos protocolos explícitos, no fallback automático:

- `jsonrpc`: endpoint estándar `/jsonrpc`, authenticate y execute_kw. Compatible con
  versiones que aún ofrezcan el RPC externo de Odoo.
- `json2`: `/json/2/{model}/{method}`, API incorporada en Odoo 19. Elegir según la versión
  e interfaces habilitadas de Avancys; no asumirlas por estar basado en Odoo.

El cliente sólo permite métodos de lectura cerrados sobre `account.move.line`,
`account.account` y `res.company`. Filtra empresa explícita, asientos contabilizados y
fecha de corte. Extrae saldo anterior al mes, débitos/créditos del mes y saldo final,
en moneda de la empresa. No pide nombres de terceros, empleados, conceptos de asientos,
facturas individuales ni nómina. Reconoce tipos de columnas antes de extraer.

Los grupos se limitan a 5.000 cuentas: exceder el límite falla, nunca trunca silenciosamente.
Se comparan recuento y última escritura antes/después de las lecturas. Este mecanismo
detecta cambios habituales, pero no equivale a una transacción multiconsulta aislada;
Avancys puede ofrecer una exportación o método transaccional más fuerte en otro incremento.

Los montos normalizados se conservan como decimales de cuatro posiciones. Los controles
de apertura/movimientos/cierre usan tolerancia explícita de 0,0100 y requieren confirmación
de Contabilidad para el esquema monetario de Avancys. No se produce un PYG ejecutivo
desde códigos de cuentas sin el mapeo aprobado. Estos cortes quedan `mapping_required`.

## Historial y ejecución recurrente

La ejecución de una vez es apta para invocarse desde el scheduler autorizado cuando
estén configuradas la fuente, fechas contables y credenciales. Este PR no crea cron,
timer, worker productivo ni rutas públicas nuevas.

- Snapshots inmutables por fuente, periodo, corte y hash; sólo datos financieros
  seleccionados, sin guardar el libro original con posibles hojas privadas.
- Archivos 0600 y directorios nuevos 0700; conservarlos en almacenamiento privado y
  definir retención/backup antes de activar trabajos recurrentes.
- Hash repetido produce `unchanged`; el corte efectivo queda en la fecha del snapshot
  anterior. No se presenta un archivo viejo como actualizado al nuevo día solicitado.
- Recepción, estructura, resultado y fallos quedan en bitácoras por corrida. La salida
  del comando contiene sólo un recibo, no líneas contables ni credenciales.
- Un lock por fuente impide concurrencia dentro del mismo directorio de trabajo.
  Una caída puede dejar `.sync-lock/`: verificar que su PID/corrida ya no vive antes de
  retirar ese lock. No hay recuperación automática ni lock distribuido entre servidores.
- Un fallo no avanza el checkpoint. Un snapshot existente no se sobrescribe.

## Paso siguiente en SIIO

`stage` deja datos descargados y verificados para revisión. No invoca el RPC de importación,
validación ni publicación del CRM. La integración de este staging con SIIO requerirá
un actor de ingesta de servicio, procedencia durable y permisos separados de la persona
que valida; no se utiliza ni se suplanta a Juan como uploader automático.

Al disponer de las fuentes: probar cada interfaz real, confirmar formato y corte,
construir esa promoción a SIIO y su vista de seguimiento, y activar la programación.
La validación humana y publicación de cierres siguen siendo pasos explícitos.

## Pruebas y referencias

```bash
corepack pnpm run test:siio-financial-sources
corepack pnpm run check:siio-financial-sources
```

- [Odoo JSON-2](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html).
- [Odoo RPC externo](https://www.odoo.com/documentation/19.0/developer/reference/external_rpc_api.html).
- [Google Drive files](https://developers.google.com/workspace/drive/api/reference/rest/v3/files).
- [Microsoft Graph: lectura del archivo](https://learn.microsoft.com/en-us/graph/api/driveitem-get?view=graph-rest-1.0).
- [Microsoft Graph: descarga](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0).
- [Microsoft Graph: sitio por ruta](https://learn.microsoft.com/en-us/graph/api/site-getbypath?view=graph-rest-1.0).
- Handoff del incremento: `/root/handoffs/2026-10-10-AGT-001-conectores-financieros-construidos.md`.
