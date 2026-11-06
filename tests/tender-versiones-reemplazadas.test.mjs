import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { planObsoleteTenderDocuments } from '../verticales/licitaciones/tender-document-obsolescence.js';

// F9 de la auditoría del piloto Fiscalía: «ESTUDIO PREVIO REGIONAL EJE CAFETERO.pdf» y «ANEXOS Y FORMATOS
// FGN-REC-IPSE-0058-2026.zip» (del proyecto) siguieron vigentes junto a «Estudio Previo Eje Cafetero final.pdf» y «ANEXOS Y
// FORMATOS DEFINITIVOS.zip», que entraron por carga manual el 4-nov. El definitivo suele llamarse más corto.

test('caso Fiscalía: el definitivo de nombre más corto reemplaza al del proyecto', () => {
  const plan = planObsoleteTenderDocuments({
    currentNames: ['ESTUDIO PREVIO REGIONAL EJE CAFETERO.pdf', 'ANEXOS Y FORMATOS FGN-REC-IPSE-0058-2026.zip', 'Matriz de riesgos.xlsx', 'Adenda No. 1.pdf'],
    incomingNames: ['Estudio Previo Eje Cafetero final.pdf', 'ANEXOS Y FORMATOS DEFINITIVOS.zip'],
  });
  assert.deepEqual(Object.fromEntries(plan.archive.map(item => [item.name, item.replacedBy])), {
    'ESTUDIO PREVIO REGIONAL EJE CAFETERO.pdf': 'Estudio Previo Eje Cafetero final.pdf',
    'ANEXOS Y FORMATOS FGN-REC-IPSE-0058-2026.zip': 'ANEXOS Y FORMATOS DEFINITIVOS.zip',
  });
});

test('no se pasa de largo: otro tipo de archivo u otro documento quedan como duda, no se archivan', () => {
  const plan = planObsoleteTenderDocuments({
    currentNames: ['Anexo Formato Experiencia.docx', '32. Formulario 1 Formulario de Presupuesto Oficial (Oferta economica).xlsx'],
    incomingNames: ['ANEXOS Y FORMATOS DEFINITIVOS.zip', '7. Formulario 1 Oferta economica Definitivo.xlsx'],
  });
  assert.deepEqual(plan.archive, [], 'un zip definitivo no saca de vigentes un formato suelto; «presupuesto oficial» es otro documento (Cali)');
  assert.ok(plan.doubts.length >= 1);
});

test('la carga manual también pasa a historial lo que reemplaza, antes del corte, y lo dice', () => {
  for (const file of ['../api/[...path].js', '../server/index.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const carga = source.slice(source.indexOf('export async function ingestTenderDossierDocuments('));
    const archive = carga.indexOf('replaced = await archiveVersionsReplacedByUpload(database');
    assert.ok(archive > 0 && archive < carga.indexOf("database.rpc('psi_begin_tender_document_refresh'"), `${file}: antes del corte del expediente`);
    assert.match(carga, /archived: replaced\.archived,\s*\n\s*\/\/[^\n]*\n?\s*|archived: replaced\.archived,/);
    assert.match(source, /reason: 'unico_vigente_de_su_fuente'/);
  }
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(main, /Pasaron a historial porque llegó su versión definitiva:/);
});
