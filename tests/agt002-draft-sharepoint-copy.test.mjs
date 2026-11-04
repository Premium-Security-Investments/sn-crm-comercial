import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { agt002DraftSharepointPath, agt002DraftSharepointFileName, agt002ParseUploadOutput } from '../verticales/licitaciones/agt002-draft-sharepoint-copy.js';

test('la copia va a la carpeta aparte del proceso, con la versión en el nombre', () => {
  assert.equal(
    agt002DraftSharepointPath({ processesPath: '06_Productos_PSI/Licitaciones/03_Procesos_Activos', folder: 'SUPERINTENDENCIA NACIONAL DE SALUD', fileName: 'FORMATO_No._1._CARTA_DE_PRESENTACION_DE_LA_OFERTA.docx', version: 2 }),
    '06_Productos_PSI/Licitaciones/03_Procesos_Activos/SUPERINTENDENCIA NACIONAL DE SALUD/99_Del_CRM/Borradores_Vig-IA/FORMATO_No._1._CARTA_DE_PRESENTACION_DE_LA_OFERTA_v2.docx',
  );
  assert.equal(agt002DraftSharepointFileName({ fileName: '../x.docx', version: '3' }), 'x_v3.docx');
});

test('lee la salida de subir.py: con .docx el readback difiere y sigue siendo subido', () => {
  assert.deepEqual(agt002ParseUploadOutput('escrito: a.docx | 328086 bytes | 201\nreadback: DIFERENTE | sha256 enviado 1234\nurl: https://seguridadnacional.sharepoint.com/x'),
    { ok: true, url: 'https://seguridadnacional.sharepoint.com/x', readback: 'distinto' });
  assert.deepEqual(agt002ParseUploadOutput('YA EXISTE: ruta\nNo se sobreescribe'), { ok: false, reason: 'ya_existe' });
  assert.deepEqual(agt002ParseUploadOutput('FALLÓ la escritura: 403'), { ok: false, reason: 'no_subio' });
});

test('el programa nunca sobrescribe ni registra rutas', () => {
  const source = readFileSync(new URL('../ops/agt002-sharepoint-bridge/run-agt002-sharepoint-drafts.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes("'--reemplazar'"), false);
  assert.equal(/log\(\{[^}]*(destination|storage_path|file_name)/.test(source), false);
  const unit = readFileSync(new URL('../ops/agt002-sharepoint-bridge/agt002-sharepoint-drafts.service', import.meta.url), 'utf8');
  assert.match(unit, /BindPaths=\/root\/\.vigia-graph/);
  assert.equal(/MemoryDenyWriteExecute=(true|yes)/.test(unit), false, 'Node se cae con esa restricción');
});

test('migración 177: tabla y funciones sólo para service_role, con rollback', () => {
  const sql = readFileSync(new URL('../supabase/migrations/177_tender_draft_sharepoint_copies.sql', import.meta.url), 'utf8');
  for (const fn of ['psi_request_tender_draft_sharepoint_copy', 'psi_list_tender_draft_sharepoint_copies', 'psi_claim_tender_draft_sharepoint_copies', 'psi_finish_tender_draft_sharepoint_copy']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`));
  }
  assert.match(sql, /enable row level security/);
  assert.ok(readFileSync(new URL('../supabase/rollbacks/177_tender_draft_sharepoint_copies_rollback.sql', import.meta.url), 'utf8').includes('drop table if exists public.psi_tender_dossier_sharepoint_copies'));
});
