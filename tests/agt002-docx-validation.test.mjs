import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';

import { agt002EsNotaInterna, agt002QuitarNotasInternas, agt002ValidarDocx } from '../verticales/licitaciones/agt002-docx-validation.js';
import { createAgt002DraftDocumentProducer } from '../verticales/licitaciones/agt002-workbench-document.js';

// Mejora 6 (encargo desde Terminal): once anexos de TT-SPO-07 abrían en LibreOffice y Word los daba por dañados, y se
// iban a radicar con notas internas («la disponibilidad de vehículos no está confirmada»).
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const PARTES = {
  '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
  '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://www.seguridadnacional.co" TargetMode="External"/></Relationships>`,
  'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Formato No. 1</w:t></w:r></w:p></w:body></w:document>`,
  'word/styles.xml': `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${W}"/>`,
};

function docx(cambios = {}) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries({ ...PARTES, ...cambios })) {
    if (content !== null) zip.addFile(name, Buffer.from(content, 'utf8'));
  }
  return zip.toBuffer();
}

test('un paquete bien armado pasa (las relaciones externas no cuentan como partes)', () => {
  assert.deepEqual(agt002ValidarDocx(docx()), { ok: true, problemas: [] });
});

test('los daños que Word no perdona se detectan, cada uno con su motivo', () => {
  const casos = [
    [{ 'word/styles.xml': null }, /relación rota en word\/_rels\/document\.xml\.rels: styles\.xml/],
    [{ 'word/document.xml': '<w:document xmlns:w="x"><w:body><w:p></w:body></w:document>' }, /XML mal formado en word\/document\.xml/],
    [{ 'word/media/logo.png': 'png' }, /sin tipo de contenido: word\/media\/logo\.png/],
    [{ '[Content_Types].xml': null }, /falta \[Content_Types\]\.xml/],
    [{ 'word/document.xml': `<?xml version="1.0"?><w:body xmlns:w="${W}"/>` }, /no tiene raíz w:document/],
    // El daño exacto de Terminal: ElementTree borró la declaración de w14 y renombró prefijos; el XML sigue bien formado.
    [{ 'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:mc="${MC}" mc:Ignorable="w14 wp14"><w:body/></w:document>` }, /mc:Ignorable nombra un prefijo sin declarar en word\/document\.xml: w14/],
    [{ 'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:ns1="${MC}"><w:body><ns1:AlternateContent/></w:body></w:document>` }, /prefijos renombrados \(nsN\) en word\/document\.xml/],
  ];
  for (const [cambio, esperado] of casos) {
    const resultado = agt002ValidarDocx(docx(cambio));
    assert.equal(resultado.ok, false, String(esperado));
    assert.ok(resultado.problemas.some(problema => esperado.test(problema)), `${esperado} en ${resultado.problemas.join(' | ')}`);
  }
  assert.deepEqual(agt002ValidarDocx(Buffer.from('no es un zip')).problemas, ['no es un paquete zip válido']);
});

test('caso Terminal: la nota de vehículos sale del Word y se dice en lo que falta; las marcas [[ ]] se quedan', () => {
  assert.equal(agt002EsNotaInterna('NOTA PARA REVISIÓN: la disponibilidad de vehículos no está confirmada.'), true);
  assert.equal(agt002EsNotaInterna('Nota interna: confirmar con Operaciones.'), true);
  assert.equal(agt002EsNotaInterna('Declaramos bajo la gravedad del juramento… [[nombre del representante legal]]'), false);
  assert.equal(agt002EsNotaInterna('Notas 1 y 2 del formato: el proponente debe…'), false, 'las notas del propio formato oficial no son internas');
  const { document, quitadas } = agt002QuitarNotasInternas({
    title: 'Anexo 7 — Vehículos',
    blocks: [
      { kind: 'paragraph', text: 'Ponemos a disposición [[número]] vehículos.' },
      { kind: 'paragraph', text: 'NOTA PARA REVISIÓN: la disponibilidad de vehículos no está confirmada.' },
      { kind: 'list', items: ['Camioneta 4x4', 'No radicar: falta la tarjeta de propiedad'] },
    ],
  });
  assert.deepEqual(document.blocks, [
    { kind: 'paragraph', text: 'Ponemos a disposición [[número]] vehículos.' },
    { kind: 'list', items: ['Camioneta 4x4'] },
  ]);
  assert.equal(quitadas.length, 2);
  assert.throws(() => agt002QuitarNotasInternas({ title: 'Nota interna', blocks: [{ kind: 'paragraph', text: 'x' }] }), { code: 'AGT002_DOCUMENT_INTERNAL_NOTE' });
});

function storage() {
  const subidos = [];
  return { subidos, from: () => ({ upload: async (ruta, bytes) => { subidos.push({ ruta, bytes }); return { error: null }; } }) };
}
// Sede principal y cierre del proceso, para la línea «Ciudad, fecha» (mejora 6, parte B).
function consultas() {
  const fila = { psi_company_sites: { city: 'Pereira' }, psi_public_tenders: { deadline_at: '2026-11-04T15:00:00Z' } };
  return tabla => { const q = { select: () => q, eq: () => q, limit: () => q, maybeSingle: async () => ({ data: fila[tabla], error: null }) }; return q; };
}
const input = { opportunity_id: '11111111-1111-4111-8111-111111111111', job_id: '22222222-2222-4222-8222-222222222222', tender_id: '33333333-3333-4333-8333-333333333333' };

test('el productor no guarda un Word dañado: lo rechaza antes del expediente', async () => {
  const database = { storage: storage(), from: consultas() };
  const producir = createAgt002DraftDocumentProducer({ database, bridgeClient: { renderDocument: async () => ({ bytes: docx({ 'word/styles.xml': null }), sha256: 'x' }) } });
  await assert.rejects(producir({ input, document: { title: 'Carta', blocks: [{ kind: 'paragraph', text: 'Hola' }] } }), { code: 'AGT002_DOCUMENT_INVALID_PACKAGE' });
  assert.equal(database.storage.subidos.length, 0);
});

test('el productor manda al puente el documento sin notas y deja el aviso primero en lo que falta', async () => {
  const database = { storage: storage(), from: consultas() };
  let enviado;
  const producir = createAgt002DraftDocumentProducer({ database, bridgeClient: { renderDocument: async ({ document }) => { enviado = document; return { bytes: docx(), sha256: 'abc' }; } } });
  const metadata = await producir({ input, missingInformation: ['Falta el NIT del socio.'], document: {
    title: 'Carta de presentación', blocks: [{ kind: 'paragraph', text: 'Texto.' }, { kind: 'paragraph', text: 'Nota interna: revisar la póliza.' }],
  } });
  assert.deepEqual(enviado.blocks, [{ kind: 'paragraph', text: 'Texto.' }]);
  assert.match(metadata.falta[0], /Se sacó del Word una nota interna: «Nota interna: revisar la póliza\.»/);
  assert.equal(metadata.falta[1], 'Falta el NIT del socio.');
  assert.equal(metadata.avisos.length, 1);
  assert.equal(database.storage.subidos.length, 1);
});
