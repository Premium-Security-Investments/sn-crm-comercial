// Carga manual por URL firmada (Juan, 2026-10-23). Supersalud falló con 413: la carga mandaba todos los archivos en
// base64 dentro del JSON y una función de Vercel no admite más de 4,5 MB de cuerpo, así que el techo real eran ~3 MB
// por lote y no los 50 MB que promete el código. Ahora el navegador sube directo al almacenamiento y a la API sólo
// le llega la ruta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TENDER_MANUAL_UPLOAD_PREFIX,
  isTenderManualUploadStoragePath,
  tenderManualUploadFolder,
  tenderManualUploadStoragePath,
} from '../tender-manual-upload-path.js';

const OPP = 'd71a6299-f403-4a98-906d-ce705a7addf7'; // Pereira SMGA-LP-220-2026, la oportunidad real de la prueba
const OTRA = '021c37ec-99f0-4151-b4b0-42dfb930c5c7'; // Supersalud SNS-LP-2-2026

test('la ruta queda dentro de la carpeta de SU oportunidad y es única por carga', () => {
  const base = { opportunityId: OPP, profileId: 'perfil-1', name: 'Proyecto de pliego.pdf', size: 695134 };
  const path = tenderManualUploadStoragePath({ ...base, now: 1_761_000_000_000 });
  assert.ok(path.startsWith(`${TENDER_MANUAL_UPLOAD_PREFIX}${OPP}/`), path);
  assert.ok(path.endsWith('-Proyecto de pliego.pdf'), 'conserva el nombre para que se reconozca en el almacenamiento');
  assert.equal(path, tenderManualUploadStoragePath({ ...base, now: 1_761_000_000_000 }), 'misma entrada, misma ruta');
  // Dos cargas del mismo archivo no se pisan: la identidad por contenido la resuelve tenderManualUploadDocumentId.
  assert.notEqual(path, tenderManualUploadStoragePath({ ...base, now: 1_761_000_000_001 }));
  assert.notEqual(path, tenderManualUploadStoragePath({ ...base, profileId: 'perfil-2', now: 1_761_000_000_000 }));
  assert.notEqual(path, tenderManualUploadStoragePath({ ...base, size: 695135, now: 1_761_000_000_000 }));
});

test('la ruta que firmó esta API para esta oportunidad se acepta', () => {
  const path = tenderManualUploadStoragePath({ opportunityId: OPP, profileId: 'perfil-1', name: 'super.pdf', size: 10 });
  assert.equal(isTenderManualUploadStoragePath(path, OPP), true);
});

test('no se acepta la carpeta de otra oportunidad, ni salirse de la carpeta', () => {
  const ajena = tenderManualUploadStoragePath({ opportunityId: OTRA, profileId: 'perfil-1', name: 'super.pdf', size: 10 });
  assert.equal(isTenderManualUploadStoragePath(ajena, OPP), false, 'la carpeta de Supersalud no sirve para Pereira');
  for (const malo of [
    `${tenderManualUploadFolder(OPP)}../${OTRA}/robado.pdf`,
    `${tenderManualUploadFolder(OPP)}sub/carpeta.pdf`,
    `/${tenderManualUploadFolder(OPP)}absoluto.pdf`,
    `${tenderManualUploadFolder(OPP)}carpeta\\windows.pdf`,
    `company-profile/documents/perfil-1/rup.pdf`,
    tenderManualUploadFolder(OPP),
    '',
    null,
  ]) {
    assert.equal(isTenderManualUploadStoragePath(malo, OPP), false, String(malo));
  }
  // Un id que empieza igual que otro más largo no cuela, porque la carpeta termina en '/'.
  assert.equal(isTenderManualUploadStoragePath(`${TENDER_MANUAL_UPLOAD_PREFIX}${OPP}-bis/x.pdf`, OPP), false);
  assert.equal(isTenderManualUploadStoragePath(`${TENDER_MANUAL_UPLOAD_PREFIX}${OPP}/x.pdf`, ''), false);
});

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const ruta = name => server.match(new RegExp(`app\\.post\\('/api/${name}'[\\s\\S]*?\\n}\\);`))?.[0] || '';

test('la ruta de URL firmada existe en los dos backends, autoriza igual que la carga y respeta el techo de 50MB', () => {
  const firma = ruta('tender-documents-upload-url');
  assert.ok(firma, 'la ruta debe existir');
  assert.equal(server, api, 'server/index.js y api/[...path].js tienen que ser idénticos');
  // Misma autorización que la carga: no se puede firmar una subida a una oportunidad que no se puede tocar.
  assert.match(firma, /await ensureTenderOpportunity\(database, opportunityId, currentProfile\)/);
  assert.match(firma, /await requireTenderAnalysisFoundation\(database\)/);
  assert.match(firma, /if \(size > RUP_MAX_BYTES\) throw clientInputError/, 'el techo se valida al firmar');
  assert.match(firma, /if \(!Number\.isFinite\(size\) \|\| size <= 0\) throw clientInputError/);
  assert.match(firma, /createSignedUploadUrl\(storagePath\)/);
  assert.match(firma, /res\.json\(\{ storage_path: storagePath, token: data\.token \}\)/);
});

test('la carga acepta la ruta firmada, la vuelve a verificar y conserva el camino de base64', () => {
  const carga = ruta('tender-documents-upload');
  assert.ok(carga);
  assert.match(carga, /assertTenderManualUploadStoragePath\(storagePath, opportunityId, name\)/,
    'la ruta se verifica al procesar, no sólo al firmar: entre las dos llamadas la tiene el cliente');
  assert.match(carga, /storage\.from\(tenderDocumentBucket\)\.download\(storagePath\)/);
  assert.match(carga, /buffer = Buffer\.from\(String\(file\.content_base64 \|\| ''\), 'base64'\)/,
    'el camino viejo se conserva para lo pequeño y para otros llamadores');
  // El techo real por archivo se sigue validando sobre los bytes, no sobre lo que diga el cliente.
  assert.match(carga, /if \(buffer\.length > RUP_MAX_BYTES\) throw new Error\(`Archivo supera 50MB/);
  assert.match(carga, /if \(!buffer\.length\) throw new Error\(`Archivo vacío/);
  // Y la cadena de siempre queda intacta: versionado, extracción y el reanálisis incremental.
  assert.match(carga, /source: TENDER_MANUAL_UPLOAD_SOURCE/);
  assert.match(carga, /requestAgt002ManualReanalysis\(database, \{ opportunityId, requestedBy/);
});

test('el navegador ya no manda el contenido en base64', () => {
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const subida = main.match(/const uploadTenderDocumentFiles = async[\s\S]*?\n  \};/)?.[0] || '';
  assert.ok(subida, 'la función de carga debe existir');
  assert.match(subida, /'\/api\/tender-documents-upload-url'/);
  assert.match(subida, /uploadToSignedUrl\(ticket\.storage_path, ticket\.token, file\)/);
  assert.match(subida, /storage_path: ticket\.storage_path/);
  assert.doesNotMatch(subida, /content_base64/, 'ya no va el contenido en el JSON');
  assert.doesNotMatch(main, /function fileToBase64/, 'y el ayudante que lo hacía se retiró');
  assert.match(subida, /if \(uploaded\.error\) throw new Error/, 'una subida que falla no se da por buena');
});
