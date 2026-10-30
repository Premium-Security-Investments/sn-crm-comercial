# AGT-002 — cargar al expediente un documento aportado, sin navegador

Herramienta a pedido, no un servicio: no tiene timer. Carga al expediente de una licitación un archivo que ya
está en el servidor, usando **la misma secuencia gobernada** que la ruta web `/api/tender-documents-upload`
(`ingestTenderDossierDocuments`): versionado por contenido, extracción tipada, nota en la línea de tiempo,
snapshot gobernado y reanálisis **incremental**. El actor es la identidad técnica de Vig-IA, no una persona.

## Por qué existe

El 2026-10-25, en Supersalud `SNS-LP-2-2026`, la entidad publicó la fase de oferta y el cronograma cambió por
completo. El cronograma **no viaja en ningún documento del expediente**: vive en el formulario de SECOP II, y la
única copia es la impresión de "Información del procedimiento". Esa impresión existía, pero la única vía para
meterla al expediente era la ruta web con la sesión de una persona, así que el análisis canónico siguió con las
fechas de la fase anterior y la inscripción a la visita técnica se venció sin que nadie lo viera.

## Uso

```sh
node ops/agt002-dossier-upload/run-agt002-dossier-upload.mjs \
  --opportunity <uuid> \
  --file "<ruta del archivo>" \
  --origin entidad|propio|tercero \
  [--document-type <tipo>] \
  [--dry-run]
```

Necesita `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en el entorno. En el servidor de tareas se corre con el
mismo archivo de entorno del worker de análisis inicial (ver `ops/agt002-initial-analysis-worker/env.example`
para los nombres de las variables; el archivo real no se versiona):

```sh
systemd-run --quiet --wait --pipe --collect \
  -p EnvironmentFile=<archivo de entorno del worker de análisis inicial> \
  -p WorkingDirectory=/opt/psi-comercial/current \
  /usr/bin/node ops/agt002-dossier-upload/run-agt002-dossier-upload.mjs …
```

`--dry-run` lee el archivo, resuelve la oportunidad y no escribe nada: sirve para confirmar nombre, tamaño y
origen antes de tocar el expediente.

## Reglas

- **`--origin` es obligatorio y no se adivina.** Declara quién produjo el documento (migración 150). Una
  impresión del formulario de SECOP II es `entidad`; un análisis nuestro es `propio`; una carta de un
  competidor es `tercero`. Sin declararlo la cadena lo trataría como `third_party`, así que se exige decirlo.
- `--document-type` es opcional: la cadena lo normaliza a partir del nombre del archivo. Conviene darlo cuando
  el nombre no lo delate.
- Un mismo contenido cargado otra vez **no** crea una versión nueva: la identidad es el contenido.
- La carga dispara un reanálisis **incremental** (decisión de Juan, 2026-10-20: lo que sube una persona se lee
  como novedad sobre el análisis vigente; el análisis completo es para el pliego definitivo, una fase nueva o el
  botón). Si falla el pedido de reanálisis, la carga no se deshace: queda registrado en el recibo.
- Los nombres de archivo se conservan, así que conviene que digan qué son: el nombre alimenta la clasificación.
