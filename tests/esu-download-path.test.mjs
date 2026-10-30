// 2026-10-20: ESU empezó a publicar la descarga con el nombre del archivo (/procesos/descargar/<id>/<nombre>) y la regla
// vieja (sólo el id) descartó los 5 documentos del proceso 2026-5. Fija: la ruta acepta el id solo o con un nombre, nunca
// subrutas ni otras rutas; y la lista y la descarga usan la misma regla.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateOfficialHttpsUrl } from '../safe-official-fetch.js';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const source = server.match(/export const ESU_DOCUMENT_DOWNLOAD_PATH = (\/.+\/i);/)[1];
const ESU_DOCUMENT_DOWNLOAD_PATH = new Function(`return ${source};`)();
const ok = url => { try { validateOfficialHttpsUrl(url, { allowedHosts: ['esucontratacion.com'], allowedPath: ESU_DOCUMENT_DOWNLOAD_PATH }); return true; } catch { return false; } };

test('acepta los enlaces reales del proceso ESU 2026-5 y la forma vieja', () => {
  for (const url of [
    'https://esucontratacion.com/procesos/descargar/23640/.PLIEGO%20DE%20CONDICIONES%20SPO-2026-5%20SIS.pdf',
    'https://esucontratacion.com/procesos/descargar/23643/MATRIZ%20DE%20RIESGO%20SPO%202026-5.MATRIZ%20DE%20RIESGO%20SPO%202026-5%20-%20SIS.xlsx',
    'https://esucontratacion.com/procesos/descargar/23644/ANEXOS%20EDITABLES%20.ANEXOS%20SPO%202026%20-%205.docx',
    'https://esucontratacion.com/procesos/descargar/23640',
    'https://esucontratacion.com/procesos/descargar/23640/',
  ]) assert.equal(ok(url), true, url);
});

test('rechaza subrutas, otras rutas y otros dominios', () => {
  for (const url of [
    'https://esucontratacion.com/procesos/descargar/23640/a/b.pdf',
    'https://esucontratacion.com/procesos/descargar/abc/x.pdf',
    'https://esucontratacion.com/procesos/view/3421',
    'https://esucontratacion.com/admin/descargar/1/x.pdf',
    'https://otro.com/procesos/descargar/23640/x.pdf',
  ]) assert.equal(ok(url), false, url);
});

test('la lista y la descarga usan la misma regla', () => {
  assert.equal((server.match(/allowedPath: ESU_DOCUMENT_DOWNLOAD_PATH/g) || []).length, 2);
  assert.doesNotMatch(server, /allowedPath: \/\^\\\/procesos\\\/descargar\\\/\\d\+\\\/\?\$\/i/);
});
