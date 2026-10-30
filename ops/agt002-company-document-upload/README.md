# AGT-002 — cargar a la ficha de empresa un documento, sin navegador

Herramienta a pedido, no un servicio: no tiene timer. Carga a la ficha de empresa un archivo que ya está en el
servidor y lo registra con la **misma función núcleo** que la ruta web (migración 167): mismas validaciones de tipo,
fechas, hash SHA-256, ruta y tamaño, y el mismo versionado por contenido.

## Lo que NO hace, y es el punto

**No aprueba la ficha del bloque.** La ruta web sí lo hace, porque allí una persona escogió el bloque y subió el
archivo; aquí lo hace un agente, así que el bloque queda `pending_human_review` y la pantalla de Empresa lo muestra
como **"Falta confirmar"** hasta que una persona lo confirme. La decisión humana sobre la evidencia de la empresa no
se delega: es lo que protegen las migraciones 061, 158 y 159.

Tampoco firma con la cédula de nadie: quien carga es la identidad técnica de Vig-IA, y así queda en el inventario.

## Por qué existe

El 2026-10-30 la carga de documentos corporativos se atascó tres veces en el mismo día —los antecedentes de la
empresa y del representante legal, que existían en SharePoint desde septiembre, y los BASC e ISO—, con Terminal
cerrando el 4-nov y 250 de sus 1.000 puntos dependiendo de cuatro de esos archivos. El cuello de botella no era la
credencial: era que no existía una vía que respetara el gobierno de la ficha. Juan escogió este camino el mismo día,
entre tres.

## Uso

```sh
node ops/agt002-company-document-upload/run-agt002-company-document-upload.mjs \
  --block <entry_id> \
  --file "<ruta del archivo>" \
  --issued-at AAAA-MM-DD \
  [--expires-at AAAA-MM-DD] \
  [--name "<nombre visible>"] \
  [--dry-run]
```

- `--block` es el `entry_id` del registro de evidencia (`quality_certifications`, `agency_authorizations`,
  `chamber_of_commerce`, `rup`, `rce_policy`…). La migración 167 exige que exista **vigente**: un agente no inventa
  bloques, y los tipos legados (`certificado`) y `otro` quedan fuera de esta puerta a propósito.
- `--issued-at` es obligatorio y no se adivina: es la fecha con la que los pliegos cuentan la antigüedad del
  documento, y la que el puente ficha de empresa → expediente usa para decir "al cierre tendrá N días".
- `--expires-at` sólo cuando el documento vence. Es **la fecha que manda** en cada oferta: el `expiry` del bloque es
  la foto del manifiesto y no se puede corregir desde la aplicación.
- `--dry-run` lee el archivo, comprueba el bloque y calcula hash, ruta y tamaño sin escribir nada.

Necesita `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. En el servidor de tareas se corre con el mismo archivo de
entorno del worker de análisis inicial:

```sh
systemd-run --quiet --wait --pipe --collect \
  -p EnvironmentFile=<archivo de entorno del worker de análisis inicial> \
  -p WorkingDirectory=/opt/psi-comercial/current \
  /usr/bin/node ops/agt002-company-document-upload/run-agt002-company-document-upload.mjs …
```

## De SharePoint al CRM, completo

```sh
# 1. bajar de SharePoint (sitio Innovación)
python3 /root/.vigia-graph/bajar.py "<ruta remota>" /tmp/entrada/BASC_V6.pdf
# 2. confirmar sin escribir
node ops/agt002-company-document-upload/run-agt002-company-document-upload.mjs \
  --block quality_certifications --file /tmp/entrada/BASC_V6.pdf \
  --issued-at 2026-06-17 --expires-at 2027-06-17 --dry-run
# 3. cargar
… sin --dry-run
# 4. una persona confirma el bloque en la pantalla de Empresa
```

El paso 4 no es opcional ni decorativo: hasta que exista, el bloque dice "Falta confirmar" y el puente lo cuenta
como pendiente.

## Detalles del almacenamiento

El bucket es `tender-documents` y el objeto va bajo `company-profile/documents/<identidad que carga>/`, con el hash
del contenido en el nombre: un reintento del mismo archivo no deja dos objetos. La ruta se vuelve a validar en la
base (`company-profile/%`, sin `..`).
