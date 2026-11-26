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

// Pereira LP-01-2026 (2026-11-24): la Entidad publicó «INCLUYE ADENDA …» del pliego y de los anexos 7 y 8. Quedaron vigentes
// junto a los anteriores y Vig-IA calculó la garantía con el presupuesto viejo y dijo no ver el Anexo 7 corregido.
test('caso Pereira: la versión con la adenda incorporada reemplaza al pliego y a los anexos; avisos y actas quedan', () => {
  const plan = planObsoleteTenderDocuments({
    currentNames: [
      'PLIEGO ELECTRONICO DEFINITIVO VIGILANCIA PRIVADA 2026-2027.pdf', 'Anexo No. 7 Comp Valor a Pagar y Oferta economica 2026-2027.xlsx',
      'Anexo 8. Matriz Riesgos. Vigilancia 2026.xlsx', 'AVISO CONVOC PUBL N_2 PUBLICACION PLIEGO DEFINITIVO LP-01-2026.DOC.pdf',
      'Acta RTAS OBSERVACIONES PLIEGO DEFINITIVO LP-01-2026.pdf', 'Anexo 9 SST Vigilancia.pdf', 'CDP 9526 U8 SERVICIO DE VIGILANCIA.pdf',
    ],
    incomingNames: [
      'INCLUYE ADENDA PLIEGO ELECTRONICO DEFINITIVO VIGILANCIA PRIVADA 2026-2027.pdf', 'INCLUYE ADENDA Anexo No. 7 Comp Valor a Pagar y Oferta economica 2026-2027.xlsx',
      'INCLUYE ADENDA Anexo 8. Matriz Riesgos. Vigilancia 2026.xlsx', 'AVISO CONVOC PUBL N_3 PUBLICACION PLIEGO DEFINITIVO LP-01-2026.pdf',
    ],
  });
  assert.deepEqual(Object.fromEntries(plan.archive.map(item => [item.name, item.reason])), {
    'PLIEGO ELECTRONICO DEFINITIVO VIGILANCIA PRIVADA 2026-2027.pdf': 'pliego_con_adenda_incorporada',
    'Anexo No. 7 Comp Valor a Pagar y Oferta economica 2026-2027.xlsx': 'formato_con_version_nueva',
    'Anexo 8. Matriz Riesgos. Vigilancia 2026.xlsx': 'formato_con_version_nueva',
  });
  assert.deepEqual(plan.doubts, []);
});

test('un pliego nuevo sin «incluye adenda» sigue siendo duda, no se archiva', () => {
  const plan = planObsoleteTenderDocuments({
    currentNames: ['PLIEGO ELECTRONICO DEFINITIVO VIGILANCIA PRIVADA 2026-2027.pdf'],
    incomingNames: ['PLIEGO ELECTRONICO DEFINITIVO VIGILANCIA PRIVADA 2026-2027 v2.pdf'],
  });
  assert.deepEqual(plan.archive, []);
  assert.equal(plan.doubts[0]?.reason, 'pliego_definitivo_reemplazado');
});

test('«Volver a analizar» repasa los vigentes en orden de llegada y pasa a historial lo reemplazado, antes de pedir el análisis', () => {
  for (const file of ['../api/[...path].js', '../server/index.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const route = source.slice(source.indexOf("app.post('/api/agt002-manual-reanalysis'"));
    const archive = route.indexOf('archiveVersionsSupersededByLaterVersions(database');
    assert.ok(archive > 0 && archive < route.indexOf('requestAgt002ManualReanalysis(database'), `${file}: antes del pedido`);
    const fn = source.slice(source.indexOf('async function archiveVersionsSupersededByLaterVersions('));
    assert.match(fn.slice(0, 2500), /sort\(\(a, b\) => String\(a\.created_at/);
    assert.match(fn.slice(0, 3000), /planObsoleteTenderDocuments\(\{ currentNames: earlier, incomingNames \}\)/);
    assert.match(fn.slice(0, 3000), /gap < 2 \* 60 \* 1000/);
  }
});

// DEAJ LP-07-2026 (2026-11-25): la Entidad republicó «… Ajustado 23112026» y otros nombres; los del 11-nov seguían vigentes.
test('caso DEAJ: la versión ajustada con fecha posterior reemplaza a la anterior; protegidos y otros documentos quedan', () => {
  const plan = planObsoleteTenderDocuments({
    currentNames: [
      'Pliego de Condiciones Definitivo FINAL11-11-26 LP-07-2026.pdf', 'Anexo tecnico serv de vigilancia privada AJUSTADO final 11-11-26 2026 - _1_.pdf',
      'Anexo ANS Vigilancia Privada Ajustado FINAL11-11-2026 _1_.pdf', 'Formato Propuesta Econ_mica -FINAL 11.11.26s.xlsx',
      '. Estudio de Mercado Mes Est_ndar - aAJUSTADO 11-11-26.xlsx', 'ANEXO CONDICIONES CONTRACTUALES VIGILANCIA AJUSTADO 11-11-26.docx',
      '17 Formato de aceptaci_n  de cumplimiento del Anexo T_cnico _1_.docx', 'Respuesta Observaciones LP-07-2026 _11-11-26.pdf',
      '2. Estudios Previos 16-10-26 F.pdf', '25. Formato Carta Presentaci_n Ofertas.docx', 'Matriz de riesgos ajustada 11-11-26.xlsx',
    ],
    incomingNames: [
      'ADENDA No. 01 - LP 07 DE 2026.pdf', 'Pliego de Condiciones Definitivo Ajustado LP-07-2026 23112026.pdf', 'Anexo ANS Vigilancia Privada Ajustado 23112026.pdf',
      'ANEXO CONDICIONES CONTRACTUALES VIGILANCIA AJUSTADO 23112026.docx', 'Anexo tecnico servicio de vigilancia privada - AJUSTADO 23112026.pdf',
      'Estudio de Mercado Mes Estandar Vigilancia - ajustado adenda.xlsx', 'Formato Propuesta Econo_mica - columnas ampliadas _Nota 6_.xlsx',
      'Respuesta Observaciones Pliego Definitivo LP-07-2026.pdf',
    ],
  });
  assert.deepEqual(plan.archive.map(item => item.name).sort(), [
    '. Estudio de Mercado Mes Est_ndar - aAJUSTADO 11-11-26.xlsx', 'ANEXO CONDICIONES CONTRACTUALES VIGILANCIA AJUSTADO 11-11-26.docx',
    'Anexo ANS Vigilancia Privada Ajustado FINAL11-11-2026 _1_.pdf', 'Anexo tecnico serv de vigilancia privada AJUSTADO final 11-11-26 2026 - _1_.pdf',
    'Formato Propuesta Econ_mica -FINAL 11.11.26s.xlsx', 'Pliego de Condiciones Definitivo FINAL11-11-26 LP-07-2026.pdf',
  ]);
  assert.deepEqual(plan.doubts, []);
});

test('versión ajustada: no confunde números, no reemplaza con una fecha anterior ni toca protegidos', () => {
  const archive = (currentNames, incomingNames) => planObsoleteTenderDocuments({ currentNames, incomingNames }).archive;
  assert.deepEqual(archive(['Formato 1 Oferta economica.xlsx'], ['Formato 2 Oferta economica ajustado.xlsx']), []);
  assert.deepEqual(archive(['27. Formato cumplimiento SST.docx'], ['17 Formato de aceptaci_n  de cumplimiento del Anexo T_cnico _1_.docx']), []);
  assert.deepEqual(archive(['Anexo 7 matriz riesgos.xlsx'], ['Anexo 8 matriz riesgos ajustada.xlsx']), []);
  assert.deepEqual(archive(['Anexo ANS Ajustado 23112026.pdf'], ['Anexo ANS Ajustado 11-11-2026.pdf']), []);
  assert.deepEqual(archive(['Respuesta Observaciones LP-07-2026 _11-11-26.pdf'], ['Respuesta Observaciones ajustado 23112026.pdf']), []);
  assert.deepEqual(archive(['2. Estudios Previos 16-10-26 F.pdf'], ['Estudios Previos ajustados 23112026.pdf']), []);
});

test('Medicina Legal (25-nov): la definitiva con fecha posterior y el boletín republicado reemplazan; otro boletín no', () => {
  const plan = planObsoleteTenderDocuments({
    currentNames: ['FTN VIGILANCIA DEFINITIVA 19-11-2026.pdf', 'FTP VIGILANCIA DEFINITIVA 19-11-2026.pdf',
      'BRN_B.R.N. 201 - INSTITUTO NACIONAL DE MEDICINA LEGAL Y CIENCIAS FORENSES_CORREAGRO S.A..pdf',
      'BRN_B.R.N. 202 - INSTITUTO NACIONAL DE MEDICINA LEGAL Y CIENCIAS FORENSES_CORREAGRO S.A..pdf',
      'ESTUDIOS PREVIOS ASEO Y CAFETERIA 2026 11-19.pdf', 'ANEXO 40 NOVIEMBRE 2025.pdf'],
    incomingNames: ['FTN VIGILANCIA DEFINITIVA 25-11-2026.pdf', 'FTP VIGILANCIA DEFINITIVO 25-11-2026.pdf',
      'BRN_REP_B.R.N. 201 - INSTITUTO NACIONAL DE MEDICINA LEGAL Y CIENCIAS FORENSES_CORREAGRO S.A. _1_.pdf'],
  });
  assert.deepEqual(plan.archive.map(item => [item.name.slice(0, 16), item.replacedBy.slice(0, 20)]), [
    ['FTN VIGILANCIA D', 'FTN VIGILANCIA DEFIN'], ['FTP VIGILANCIA D', 'FTP VIGILANCIA DEFIN'], ['BRN_B.R.N. 201 -', 'BRN_REP_B.R.N. 201 -'],
  ]);
  // Una definitiva de fecha anterior no reemplaza a la vigente.
  const backwards = planObsoleteTenderDocuments({ currentNames: ['FTN VIGILANCIA DEFINITIVA 25-11-2026.pdf'], incomingNames: ['FTN VIGILANCIA DEFINITIVA 19-11-2026.pdf'] });
  assert.deepEqual(backwards.archive, []);
});

