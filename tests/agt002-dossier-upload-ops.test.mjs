import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Cargar al expediente un documento aportado, sin navegador. El 2026-10-25, en Supersalud SNS-LP-2-2026, la
// impresión de "Información del procedimiento" —la única copia del cronograma vigente— se quedó fuera del
// expediente porque la única vía era la ruta web con la sesión de una persona, mientras el análisis canónico
// seguía con las fechas de la fase anterior. Pruebas estáticas y de argumentos: no tocan base de datos.

const run = promisify(execFile);
const RUNNER = 'ops/agt002-dossier-upload/run-agt002-dossier-upload.mjs';

test('la secuencia gobernada vive en UNA función, y la ruta web la llama', async () => {
  for (const path of ['server/index.js', 'api/[...path].js']) {
    const source = await readFile(path, 'utf8');
    assert.match(source, /export async function ingestTenderDossierDocuments\(database, \{ opportunityId, opportunity, actorProfileId, files: incomingFiles \} = \{\}\)/, `${path}: la función existe y es exportable`);
    assert.match(source, /res\.status\(201\)\.json\(await ingestTenderDossierDocuments\(database, \{/, `${path}: la ruta delega, no duplica`);
    // Las piezas gobernadas aparecen una sola vez: si alguien vuelve a escribirlas dentro de la ruta, las dos
    // secuencias se pueden desviar y el expediente del agente deja de ser el mismo que el de la persona.
    assert.equal((source.match(/kind: 'tender_document_upload'/g) || []).length, 1, `${path}: la nota de la carga se escribe en un solo lugar`);
    // La ruta web no vuelve a armar el trabajo por su cuenta: su cuerpo es la autorización y la delegación.
    assert.ok(!/app\.post\('\/api\/tender-documents-upload'[\s\S]{0,2000}?refreshTenderDocumentBatch\(/.test(source), `${path}: la ruta no rearma el versionado`);
    // El origen se declara, nunca se asume por el nombre del archivo.
    assert.match(source, /p_origin: normalizeTenderDocumentOrigin\(version\.origin\)/, `${path}: el origen viaja declarado`);
  }
});

test('el runner exige oportunidad, archivo y origen declarado, y no toca nada sin credenciales', async () => {
  const fail = async (args, expected) => {
    const error = await run(process.execPath, [RUNNER, ...args], { env: { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' } })
      .then(() => null, cause => cause);
    assert.ok(error, `debía fallar: ${args.join(' ')}`);
    assert.equal(error.code, 2, 'uso incorrecto sale con código 2');
    const event = JSON.parse(String(error.stdout).trim().split('\n').at(-1));
    assert.match(event.message, expected);
    return event;
  };
  await fail([], /Falta --opportunity/);
  await fail(['--opportunity', 'opp-1'], /Falta --file/);
  await fail(['--opportunity', 'opp-1', '--file', '/tmp/x.pdf'], /Falta --origin/);
  await fail(['--opportunity', 'opp-1', '--file', '/tmp/x.pdf', '--origin', 'entidad'], /Faltan SUPABASE_URL/);
  const unknown = await fail(['--loquesea'], /Opción desconocida/);
  assert.equal(unknown.event, 'agt002_dossier_upload_usage');
});

test('el runner no inventa el origen ni lo deduce del nombre', async () => {
  const source = await readFile(RUNNER, 'utf8');
  assert.match(source, /`--origin` es obligatorio y no se adivina/);
  assert.match(source, /normalizeTenderDocumentOrigin/, 'el origen se normaliza con la misma función de la cadena');
  assert.ok(!/origin: 'entidad'|origin: "entidad"/.test(source), 'ningún origen por defecto en el código');
  assert.match(source, /AGT002_VIGIA_AGENT_PROFILE_ID/, 'el actor es la identidad técnica del agente, no una persona');
});
