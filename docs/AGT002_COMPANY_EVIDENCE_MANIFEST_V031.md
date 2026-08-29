# Manifiesto documental de evidencia empresarial AGT-002 — v0.3.1-approved-20260829

## 1. Qué es este manifiesto

`agt002-company-evidence-documental-manifest.js` es una proyección explícita, versionada
y auditable de la revisión documental real del corpus corporativo (**22 clases
documentales distintas**) sobre el catálogo técnico cerrado de **17 clases**
(`agt002-company-evidence-classes.js`, sembrado por la migración `061`).

No es un renombrado silencioso ni una fusión decidida en tiempo de lectura: cada grupo
técnico declara explícitamente qué clases documentales lo componen, si está `complete`,
su `existence_status`, su `hash` (o `null` si no corresponde reportar uno) y notas de
gobernanza. La migración `075` lleva esta misma proyección a
`psi_agt002_company_evidence_registry`.

Este módulo **no escribe ni lee la base de datos**, **no se conecta a `server/index.js`
ni a `api/[...path].js`** y **no afirma cumplimiento, suficiencia, aplicabilidad ni
aprobación** de ningún documento. Es sólo la proyección documental → técnica.

## 2. La proyección 22 → 17

- **13 clases** se proyectan **1:1** sobre su misma clase técnica (el id documental es
  igual al id técnico): `supervigilancia_operating_license`, `rup`, `rut`,
  `uniforms_resolution`, `no_fines_sanctions_certificate`, `authorized_weapons_list`,
  `rce_policy`, `collective_life_policy`, `accredited_experience`, `bank_certificate`,
  `legal_representative_vault`, `personnel_credentials_vault`,
  `differential_scoring_support`.
- **4 grupos técnicos** consolidan varias clases documentales o quedan parciales/vacíos
  (ver §3).

## 3. Los cuatro cambios frente a v0.2

Estos son los únicos cuatro grupos técnicos cuyo contenido cambió realmente en la
revisión v0.3.1 (los otros 13 preservan hash y `existence_status` de v0.2 sin
alteración):

1. **`communications_license`** — consolida **5 clases TIC** (`radio_spectrum_permit`,
   `radio_network_technical_profile`, `rutic_registration`,
   `telecom_service_contract`, `telecom_commercial_reference`) en un compuesto
   `complete: true`, `existence_status: 'reported'`, con `hash` determinístico
   (sha256 de los 5 hashes de origen unidos por `|`, en ese orden exacto):
   `8e1f0b37b48d1de7128e2b7f4b29a29ac308f6baceb5c555b9554ce5d9881ace`.
   Las notas de gobernanza (`review_focus`) señalan explícitamente los gates aún no
   confirmados: **firmeza, titularidad y territorio**. El compuesto no afirma por sí
   solo que esos gates estén satisfechos.
2. **`financial_and_tax_pack`** — sólo se observó `corporate_tax_return` (una única
   clase documental). El pack completo (estados financieros, declaración de renta,
   certificaciones y anexos) no está en el corpus revisado, por lo que el grupo queda
   `complete: false`, `existence_status: 'not_verified'`, `hash: null` — aun cuando
   `corporate_tax_return` sí tiene un hash individual real. Reportar un hash de grupo
   aquí representaría el pack como verificado, cuando no lo está.
3. **`overtime_authorization`** — no se localizó ninguna autorización vigente del
   Ministerio del Trabajo en el corpus revisado. El grupo queda vacío
   (`documental_class_ids: []`), `complete: false`, `existence_status: 'not_verified'`,
   `hash: null`. El hash que existía en v0.2 para este archivo **no se reafirma** como
   evidencia en v0.3.1.
4. **`corporate_background_checks`** — consolida **3 certificados de antecedentes
   corporativos** (`corporate_disciplinary_certificate`, `corporate_fiscal_certificate`,
   `corporate_corrective_measures_rnmc_certificate`) en un compuesto `complete: true`,
   `existence_status: 'reported'`, `hash`:
   `5cf1e715b51d18dc6a4643308447f7c238c0c73471c8eb81598f39da7dcf90bf`. Las tres consultas
   están fechadas `2026-06-01`, con una ventana observada de `89` días hasta el
   `expiry` registrado `2026-08-29`. Esta ventana es una fecha observada del corpus, no
   una afirmación de vigencia contractual para un caso específico.

## 4. Qué NO cambia con esta revisión

- Todos los registros v0.3.1 (los 17, incluidos estos 4) mantienen
  `human_review_status = 'pending_human_review'` y
  `applicability_status = 'pending_case_validation'`.
- `decision_humana`, `decision_humana_fecha` y `estado_posterior_decision` permanecen
  `null` en todos los casos.
- Esta revisión **no otorga ni deniega ningún GO/NO GO**; es una versión-forward del
  manifiesto documental, no un resultado de decisión.
- El posicionamiento de uso (`internal_decision_support = true`,
  `external_submission_authority = false`, `automatic_final_approval = false`) se
  conserva igual que en v0.2 para las 17 clases.

## 5. Migración 075 y su rollback

- Migración: `supabase/migrations/075_agt002_company_evidence_manifest_v031.sql`.
- Rollback: `supabase/rollbacks/075_agt002_company_evidence_manifest_v031_rollback.sql`.
- Ambas son **append-only**: nunca se hace `DELETE`/`TRUNCATE`/`DROP TABLE`. La
  migración desactiva (`current = false`) las 17 filas `v0.2-provisional-20260801` y
  agrega 17 filas nuevas `version = 2`, `current = true`,
  `source_manifest_version = 'v0.3.1-approved-20260829'` (copiando verbatim las 13
  clases sin cambios, y sobreescribiendo sólo los 4 grupos de §3). El rollback hace lo
  inverso: desactiva las filas v0.3.1 y restaura las v0.2 como `current`, sin borrar
  nunca las filas v0.3.1 (quedan inactivas, listas para un re-apply seguro).
- Ambas son **idempotentes** y **fail-closed**: un re-run de la migración no crea
  `version = 3`; si alguna fila `current` del alcance de 17 clases trae un
  `source_manifest_version` desconocido (ni v0.2 ni v0.3.1), la migración y el rollback
  se **rehúsan a tocar nada** para no pisar una versión futura o ajena en el tiempo.
- La migración cierra exigiendo exactamente `17` filas `current` en
  `v0.3.1-approved-20260829`; si el conteo no cuadra, falla explícitamente.

## 6. Idempotencia ligada a la identidad de evidencia

La idempotencia de una corrida de análisis ya **no** depende sólo de la identidad de
snapshot/contexto existente: `agt002-company-evidence-identity.js` construye una
identidad de evidencia de tres campos —

```
{ source_snapshot_hash, preview_artifact_hash, source_manifest_version }
```

— a partir de las 17 filas `current` del catálogo cerrado. `source_snapshot_hash` es un
hash canónico (orden-independiente) de las filas mismas; `preview_artifact_hash` es un
hash canónico del artefacto tipado real `{classes, coverage}` que esas mismas filas
producen; `source_manifest_version` es la versión compartida por todas las filas (falla
si están mezcladas).

Como consecuencia directa: cuando la migración `075` promueve las 17 filas de
`v0.2-provisional-20260801` a `v0.3.1-approved-20260829`, los tres campos cambian, por
lo que una corrida re-ejecutada contra el mismo expediente **no reutiliza
silenciosamente** una corrida vieja basada en evidencia v0.2 — se dispara una corrida
fresca ligada a la evidencia v0.3.1 real.

## 6bis. `evidenceAsOf`, congelamiento en el job y frontera segura en runtime

- `deriveAgt002CompanyEvidenceAsOf` (`agt002-company-evidence-identity.js`) deriva
  `evidenceAsOf` como el **inicio de día UTC** que contiene el `updated_at` más reciente
  entre las 17 filas `current` del catálogo cerrado — nunca lee el reloj de pared
  (`new Date()`). La misma evidencia produce siempre el mismo `evidenceAsOf`, y el mismo
  `evidenceAsOf` alimenta a `buildAgt002CompanyEvidenceIdentity`, de modo que misma
  evidencia ⇒ misma identidad triple.
- En el enqueue (`loadAgt002IntegralV3GovernanceIfEnabled`, `server/index.js` /
  `api/[...path].js`), `evidenceAsOf` e `evidenceIdentity` se derivan **una sola vez** y
  se congelan juntos dentro del `integral_v3_governance` del job durable
  (`buildAgt002FrozenEngineInput`, `agt002-reanalysis-input.js`). El motor
  (`agt002-reanalysis-executor.js`) reutiliza exactamente ese `evidenceAsOf` congelado
  (`governance.evidenceAsOf`) al ejecutar — nunca re-deriva ni vuelve a leer el reloj —
  eliminando cualquier ventana TOCTOU entre el momento de encolar y el momento de
  ejecutar.
- Esa misma identidad triple exacta (`source_snapshot_hash`, `preview_artifact_hash`,
  `source_manifest_version`), re-validada siempre con
  `validateAgt002CompanyEvidenceIdentity` y nunca aceptada verbatim, se persiste tanto en
  la versión de contexto (`registerAgt002ContextVersion`) como en el bloque
  `company_evidence_identity`, server-owned, del resultado persistido
  (`agt002-preview-persistence.js`) — sólo los tres campos opacos hash/versión, sin PII
  ni filas crudas del registro.
- Un registro ausente, incompleto, mixto (`source_manifest_version` no unánime) o
  malformado hace fallar `deriveAgt002CompanyEvidenceAsOf` /
  `buildAgt002CompanyEvidenceIdentity`, y esa falla se traduce en la frontera segura
  `AGT002_RUNTIME_COMPANY_EVIDENCE_INVALID` (HTTP 503, sin PII) — nunca en un
  `rules_fallback` silencioso.
- `source_manifest_version` es aditivo y opcional únicamente para artefactos
  históricos/legacy (p. ej. un job congelado antes de que `evidenceAsOf` existiera, que
  `agt002-reanalysis-executor.js` sigue tolerando sin ese campo). La identidad
  productiva v0.3.1 exige las 17 filas `current` compartiendo una única versión de
  manifiesto; una mezcla de versiones falla cerrado.

## 7. Orden de despliegue y autorizaciones

El orden operativo para llevar este manifiesto a producción es:

1. **Migración** (`075`, contra la base real) — requiere su propia autorización.
2. **Aplicación** (`app`, el código que consume el manifiesto/catálogo) — requiere su
   propia autorización, posterior a la migración.
3. **QA** — verificación post-deploy antes de cualquier ejecución operativa.
4. **Exactamente un (1) job Pereira**, y **sólo con autorización expresa** — no forma
   parte de este cierre documental ni se ejecuta automáticamente junto con los pasos
   anteriores. Cada paso de esta secuencia es una autorización distinta y separada de
   las demás; ninguna autoriza implícitamente a la siguiente.

Este documento **no ejecuta, ni ordena ejecutar**, ninguno de estos pasos: es
exclusivamente la documentación del manifiesto v0.3.1 y su cobertura de pruebas.

## 8. Alcance explícitamente excluido: Procuraduría

Este manifiesto y la migración `075` **no ejecutan ninguna consulta ni integración con
la Procuraduría**. `corporate_disciplinary_certificate` (uno de los tres certificados
que consolida `corporate_background_checks`, §3.4) es evidencia **ya observada y
fechada en el corpus revisado**, no una llamada en vivo a un sistema externo. Ninguna
llamada a un servicio de la Procuraduría se dispara por cargar este módulo, aplicar la
migración `075` ni correr sus pruebas.

## 9. Sin PII, rutas ni URLs

La superficie segura exportada (`AGT002_COMPANY_EVIDENCE_DOCUMENTAL_MANIFEST`) sólo
contiene identificadores, etiquetas legibles en español y huellas sha256 ya seguras de
exponer — nunca ruta de almacenamiento (SharePoint u otro), URL firmada, contenido
crudo, OCR ni secreto. Los mismos hashes ya son del tipo que
`agt002-company-evidence-classes.js` expone hoy. La cobertura de pruebas (§10) verifica
explícitamente que la serialización JSON de esa superficie no contiene patrones de
SharePoint, URLs firmadas ni claves como `content`/`secret`/`password`/`token`/`pii`.

## 10. Cómo probar

Prueba focal de este módulo (proyección documental → técnica, hashes de grupo,
builder fail-closed, hash de identidad, superficie segura):

```bash
node tests/agt002-company-evidence-documental-manifest.test.mjs
```

Prueba focal de la migración `075` y su rollback (estático + ciclo completo en PGlite:
apply → apply/apply idempotente → rollback → rollback/rollback idempotente → reapply,
más los dos casos fail-closed de `source_manifest_version` desconocido):

```bash
node tests/agt002-company-evidence-manifest-v031-migration-static.test.mjs
```

Prueba focal del catálogo técnico cerrado de 17 clases (sin la proyección documental):

```bash
node tests/agt002-company-evidence-classes.test.mjs
```

Prueba focal de la identidad de evidencia empresarial (idempotencia §6):

```bash
node tests/agt002-company-evidence-identity.test.mjs
```

Prueba focal de `evidenceAsOf`/identidad congelados en el job durable, ejecutados sin
TOCTOU, y de la frontera segura de runtime (enqueue en `server/index.js` /
`api/[...path].js`, motor en `agt002-reanalysis-executor.js`, entrada congelada en
`agt002-reanalysis-input.js`):

```bash
node tests/agt002-company-evidence-identity-server-wiring.test.mjs
node tests/agt002-reanalysis-input.test.mjs
node tests/agt002-reanalysis-executor.test.mjs
```

Prueba focal de la persistencia server-owned de `company_evidence_identity` (contexto y
resultado) y del contrato del adaptador de análisis:

```bash
node tests/agt002-preview-persistence.test.mjs
node tests/agt002-tender-analysis-contract.test.mjs
```

Prueba de paridad de backend (mismo comportamiento en `server/index.js` y
`api/[...path].js`, incluida la frontera `AGT002_RUNTIME_COMPANY_EVIDENCE_INVALID`):

```bash
node tests/backend-parity.test.mjs
```

Todas juntas, en una sola invocación:

```bash
node --test \
  tests/agt002-company-evidence-documental-manifest.test.mjs \
  tests/agt002-company-evidence-manifest-v031-migration-static.test.mjs \
  tests/agt002-company-evidence-classes.test.mjs \
  tests/agt002-company-evidence-identity.test.mjs \
  tests/agt002-company-evidence-identity-server-wiring.test.mjs \
  tests/agt002-reanalysis-input.test.mjs \
  tests/agt002-reanalysis-executor.test.mjs \
  tests/agt002-preview-persistence.test.mjs \
  tests/agt002-tender-analysis-contract.test.mjs \
  tests/backend-parity.test.mjs
```

Este documento no reporta resultados de ninguna de estas ejecuciones: sólo los
comandos exactos a correr.
