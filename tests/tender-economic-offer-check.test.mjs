import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import AdmZip from 'adm-zip';

import { checkEconomicOffer, readWorkbook } from '../verticales/licitaciones/tender-economic-offer-check.js';

// Mejora 5 (encargo desde Terminal). Réplica de la estructura del Anexo 9 de TT-SPO-07 (bajado del CRM y leído el
// 2026-11-06): las casillas que se llenan están desbloqueadas; E29/E30 van SIN IVA; H = ROUND(E × (1 + 19 %)); K es el
// techo CON IVA; la entidad trae su propia verificación en J. Las fórmulas de la columna G se escriben como compartidas.
const CHEQUEO = (r) => `IF(AND(H${r}&lt;=K${r},I${r}&lt;=I${r},E${r}&gt;0,ROUNDUP(E${r},0)=ROUNDDOWN(E${r},0)),"CUMPLE","NO CUMPLE")`;
function anexo9({ e29, e30, prima }) {
  const v = value => (value === null ? '' : `<v>${value}</v>`);
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
    <row r="15"><c r="C15" t="inlineStr"><is><t>Servicio de vigilancia 24 horas sin arma</t></is></c><c r="G15" s="1">${v(prima)}</c></row>
    <row r="28"><c r="E28" t="inlineStr"><is><t>Valor Unitario</t></is></c><c r="K28" t="inlineStr"><is><t>VALOR UNITARIO INCLUIDO IVA (TECHO A OFERTAR)</t></is></c></row>
    <row r="29"><c r="C29" t="inlineStr"><is><t>Vehículo auto balanceado eléctrico</t></is></c><c r="D29"><v>1</v></c><c r="E29" s="1">${v(e29)}</c><c r="F29"><v>0.19</v></c>
      <c r="G29"><f t="shared" ref="G29:G30" si="0">F29*E29</f></c><c r="H29"><f>ROUND(G29+E29,0)</f></c><c r="I29"><f>H29*D29</f></c>
      <c r="J29" t="str"><f>${CHEQUEO(29)}</f></c><c r="K29"><v>3099394</v></c></row>
    <row r="30"><c r="C30" t="inlineStr"><is><t>Botones de pánico</t></is></c><c r="D30"><v>15</v></c><c r="E30" s="1">${v(e30)}</c><c r="F30"><v>0.19</v></c>
      <c r="G30"><f t="shared" si="0"/></c><c r="H30"><f>ROUND(G30+E30,0)</f></c><c r="I30"><f>H30*D30</f></c>
      <c r="J30" t="str"><f>${CHEQUEO(30)}</f></c><c r="K30"><v>93382</v></c></row>
  </sheetData></worksheet>`;
  const zip = new AdmZip();
  zip.addFile('xl/workbook.xml', Buffer.from('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Plantilla Oferta" sheetId="1" r:id="rId1"/></sheets></workbook>'));
  zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>'));
  zip.addFile('xl/styles.xml', Buffer.from('<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="0" applyProtection="1"><protection locked="0"/></xf></cellXfs></styleSheet>'));
  zip.addFile('xl/worksheets/sheet1.xml', Buffer.from(sheet));
  return zip.toBuffer();
}

test('las fórmulas compartidas se expanden con su fila', () => {
  const [sheet] = readWorkbook(anexo9({ e29: 1, e30: 1, prima: 1 }));
  assert.equal(sheet.cells.get('G30').formula, 'F30*E30');
  assert.equal(sheet.cells.get('E29').unlocked, true);
  assert.equal(sheet.cells.get('K29').unlocked, false);
});

test('caso Terminal: las casillas en cero de fábrica son rechazo, y la verificación de la entidad lo confirma', () => {
  const result = checkEconomicOffer(anexo9({ e29: 0, e30: 0, prima: 0 }));
  assert.equal(result.listo, false);
  assert.deepEqual(result.casillas.filter(item => item.problemas.length).map(item => item.celda).sort(), ['E29', 'E30', 'G15']);
  assert.match(result.casillas.find(item => item.celda === 'E29').problemas[0], /cero es rechazo/);
  assert.equal(result.resumen.no_cumplen, 2);
});

test('caso Terminal: el techo escrito tal cual y 92.026 en el botón no cumplen, porque el techo es con IVA', () => {
  const result = checkEconomicOffer(anexo9({ e29: 3099394, e30: 92026, prima: 4500 }));
  const j29 = result.chequeos.find(item => item.celda === 'J29');
  const j30 = result.chequeos.find(item => item.celda === 'J30');
  assert.equal(j29.cumple, false);
  assert.equal(j29.valores.H29, 3688279);
  assert.equal(j30.cumple, false);
  assert.equal(j30.valores.H30, 109511, '92.026 sin IVA son 109.511 con IVA');
  assert.equal(j30.valores.K30, 93382);
  assert.equal(j30.fila, 'Botones de pánico');
});

test('valores bajo el techo con IVA cumplen; los centavos se marcan', () => {
  const ok = checkEconomicOffer(anexo9({ e29: 2600000, e30: 78000, prima: 4500 }));
  assert.equal(ok.listo, true);
  assert.equal(ok.chequeos.every(item => item.cumple), true);
  const centavos = checkEconomicOffer(anexo9({ e29: 2600000, e30: 78000.5, prima: 4500 }));
  assert.match(centavos.casillas.find(item => item.celda === 'E30').problemas[0], /centavos/);
  assert.equal(centavos.chequeos.find(item => item.celda === 'J30').cumple, false, 'la verificación de la entidad también lo rechaza');
});

test('sin casillas reconocibles no dice «listo»: pide revisarlo a mano', () => {
  const zip = new AdmZip(anexo9({ e29: 1, e30: 1, prima: 1 }));
  zip.updateFile('xl/styles.xml', Buffer.from('<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf/><xf/></cellXfs></styleSheet>'));
  const result = checkEconomicOffer(zip.toBuffer());
  assert.equal(result.listo, false);
  assert.match(result.por_confirmar[0].motivo, /No identifiqué casillas para llenar/);
});

test('la ruta lee y descarta el archivo, y Preparar muestra la revisión', () => {
  for (const file of ['../api/[...path].js', '../server/index.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /'POST \/api\/tender-economic-offer-check': \['tenders', ACTIONS\.LICITACIONES_VIEW\]/);
    assert.match(source, /res\.json\(\{ file_name: name\.slice\(0, 200\), \.\.\.checkEconomicOffer\(bytes\) \}\)/);
  }
  assert.match(readFileSync(new URL('../src/tenders/workspace/TenderWorkspace.tsx', import.meta.url), 'utf8'), /<TenderEconomicOfferCheck opportunityId=\{opportunityId\} request=\{request\} \/>/);
});
