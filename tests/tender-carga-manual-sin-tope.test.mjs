import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// F10 de la auditoría del piloto Fiscalía: el 4-nov a las 23:02Z, de 22 archivos elegidos para cargar entraron 8 y el
// resto se botó sin avisar (`files.slice(0, 8)` en la ruta y `selected.slice(0, 8)` en la pantalla).
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('la secuencia de carga ya no bota en silencio lo que pasa de 8: lo rechaza y lo dice', () => {
  for (const file of ['../api/[...path].js', '../server/index.js']) {
    const source = read(file);
    const carga = source.slice(source.indexOf('export async function ingestTenderDossierDocuments('));
    assert.doesNotMatch(carga.slice(0, 3000), /files\.slice\(0, 8\)/);
    assert.match(carga, /if \(files\.length > TENDER_DOCUMENTS_PER_UPLOAD\) throw clientInputError\(`Se pueden cargar hasta \$\{TENDER_DOCUMENTS_PER_UPLOAD\} archivos por envío; llegaron \$\{files\.length\}\. Ninguno se cargó/);
  }
});

test('la pantalla manda todos los elegidos en tandas de 8 y el resumen cuenta todos', () => {
  const main = read('../src/main.tsx');
  const block = main.slice(main.indexOf('const uploadTenderDocumentFiles = async'), main.indexOf('const addFiles = (event'));
  assert.match(block, /for \(let start = 0; start < selected\.length; start \+= TANDA\)/);
  assert.match(block, /results\.push\(\.\.\.\(data\.upload_results \|\| \[\]\)\);/);
  assert.match(block, /data = \{ \.\.\.data, upload_results: results \};/);
});

test('el programa del servidor de tareas también va en tandas', () => {
  const runner = read('../ops/agt002-dossier-upload/run-agt002-dossier-upload.mjs');
  assert.match(runner, /for \(let start = 0; start < files\.length; start \+= 8\)[\s\S]*files: files\.slice\(start, start \+ 8\)/);
});
