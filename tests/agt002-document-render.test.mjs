import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import {
  AGT002_DOCUMENT_TEMPLATE_PATH, Agt002DocumentError, agt002DocumentFileName, agt002InlineSpans, buildAgt002DocumentFodt, renderAgt002Docx,
} from '../verticales/licitaciones/agt002-document-render.js';

const skeleton = await readFile(AGT002_DOCUMENT_TEMPLATE_PATH, 'utf8');
const minimal = { title: 'Carta', blocks: [{ kind: 'paragraph', text: 'Hola' }] };

test('la plantilla es la corporativa, en Arial, con membrete y puntos de inserción', () => {
  assert.ok(skeleton.includes('<!--AGT002_CUERPO-->') && skeleton.includes('<!--AGT002_ESTILOS-->'));
  assert.match(skeleton, /<style:header>[\s\S]*draw:name="encabezado"/);
  assert.match(skeleton, /Nit\. 891\.408\.256-4/);
  assert.equal(/style:font-name="Liberation/.test(skeleton), false, 'la plantilla de SharePoint declara Liberation aunque dice Arial');
});

test('lo por decidir sale resaltado, también dentro de una negrilla', () => {
  assert.equal(agt002InlineSpans('Vigencia de [[90 días]]'), '<text:span text:style-name="T5">Vigencia de </text:span><text:span text:style-name="T6">90 días</text:span>');
  const nested = agt002InlineSpans('El suscrito **[[nombre]]**');
  assert.match(nested, /<text:span text:style-name="T6">nombre<\/text:span>/);
  assert.equal(nested.includes('[['), false);
});

test('un texto con XML no se cuela: todo se escapa', () => {
  const fodt = buildAgt002DocumentFodt(skeleton, { title: '</text:p><office:script>x</office:script>', blocks: [{ kind: 'paragraph', text: '<!--AGT002_CUERPO--> & "x"' }] });
  assert.equal(fodt.includes('<office:script>'), false);
  assert.match(fodt, /&lt;\/text:p&gt;&lt;office:script&gt;/);
  assert.match(fodt, /&lt;!--AGT002_CUERPO--&gt; &amp; &quot;x&quot;/);
});

test('rechaza lo que no es un documento: tipos desconocidos, tablas desparejas y textos enormes', () => {
  const invalid = document => assert.throws(() => buildAgt002DocumentFodt(skeleton, document), Agt002DocumentError);
  invalid({ ...minimal, blocks: [{ kind: 'script', text: 'x' }] });
  invalid({ ...minimal, blocks: [{ kind: 'table', header: ['a', 'b'], rows: [['1']] }] });
  invalid({ ...minimal, blocks: [{ kind: 'paragraph', text: 'x'.repeat(5000) }] });
  invalid({ ...minimal, blocks: [] });
  invalid({ blocks: minimal.blocks });
});

test('el nombre del archivo nunca trae rutas', () => {
  assert.equal(agt002DocumentFileName('../../etc/Anexo 1 · Carta de presentación.docx'), 'etc_Anexo_1_Carta_de_presentacion.docx');
  assert.equal(agt002DocumentFileName(''), 'Borrador.docx');
});

test('arma un Word real con LibreOffice', { skip: !(await readFile('/usr/bin/soffice').then(() => true, () => false)) && 'sin soffice' }, async () => {
  const bytes = await renderAgt002Docx({
    title: 'ANEXO No. 1 — CARTA DE PRESENTACIÓN',
    recipient: ['Señores', 'SUPERINTENDENCIA NACIONAL DE SALUD'],
    blocks: [{ kind: 'paragraph', text: 'Vigencia de [[90 días]].' }, { kind: 'table', header: ['Dato', 'Valor'], rows: [['Correo', '[[correo]]']] }],
    signature: ['[[NOMBRE]]'],
  });
  assert.equal(bytes.subarray(0, 2).toString('latin1'), 'PK');
  assert.ok(bytes.length > 10_000, 'lleva el membrete');
});

test('si el conversor no produce el Word, falla con su código y no deja basura', async () => {
  await assert.rejects(renderAgt002Docx(minimal, { run: async () => ({}) }), error => error.code === 'AGT002_DOCUMENT_CONVERSION_FAILED');
});
