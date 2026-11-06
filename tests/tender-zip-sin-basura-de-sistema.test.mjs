import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';

import { archiveEntryDisplayName, extractTenderDocumentText, isArchiveSystemEntry } from '../verticales/licitaciones/tender-document-text-extraction.js';

// F8 de la auditoría del piloto Fiscalía: «ANEXOS Y FORMATOS DEFINITIVOS.zip» (FGN-REC-IPSE-0058-2026) quedó con
// `extracted_text = null`. Bajado del CRM el 2026-11-06: sus 21 documentos se leían bien; lo tumbaban 24 entradas de
// sistema de macOS (`.DS_Store`, `__MACOSX/._…`).
function paquete(extra = {}) {
  const zip = new AdmZip();
  zip.addFile('ANEXOS Y FORMATOS DEFINITIVOS/Formato 1 - Carta.txt', Buffer.from('FORMATO No. 1 CARTA DE PRESENTACIÓN'));
  zip.addFile('ANEXOS Y FORMATOS DEFINITIVOS/Formato 2 - Plural.txt', Buffer.from('FORMATO No. 2 CONFORMACIÓN DE PROPONENTE PLURAL'));
  zip.addFile('ANEXOS Y FORMATOS DEFINITIVOS/.DS_Store', Buffer.from([0, 0, 0, 1, 66, 117, 100, 49]));
  zip.addFile('__MACOSX/ANEXOS Y FORMATOS DEFINITIVOS/._Formato 1 - Carta.txt', Buffer.from([0, 5, 22, 7, 0, 2, 0, 0]));
  for (const [name, content] of Object.entries(extra)) zip.addFile(name, Buffer.from(content));
  return zip.toBuffer();
}

test('las entradas de sistema se reconocen; los documentos no', () => {
  for (const name of ['__MACOSX/x/._a.pdf', 'carpeta/.DS_Store', 'carpeta/._Formato.docx', 'Thumbs.db', 'x/desktop.ini']) assert.equal(isArchiveSystemEntry(name), true, name);
  for (const name of ['Formato 1.docx', 'ANEXOS/Anexo 2.pdf', '.gitkeep-no']) assert.equal(isArchiveSystemEntry(name), false, name);
});

test('caso Fiscalía: con basura de macOS el paquete se lee completo y dice cuántas entradas saltó', async () => {
  const result = await extractTenderDocumentText(paquete(), 'ANEXOS Y FORMATOS DEFINITIVOS.zip');
  assert.equal(result.status, 'ok');
  assert.equal(result.metadata.entry_count, 2);
  assert.equal(result.metadata.skipped_system_entries, 2);
  assert.match(result.text, /FORMATO No\. 2 CONFORMACIÓN DE PROPONENTE PLURAL/);
});

test('un documento de verdad que no se puede leer sigue dejando el paquete incompleto', async () => {
  const result = await extractTenderDocumentText(paquete({ 'ANEXOS Y FORMATOS DEFINITIVOS/Anexo roto.pdf': 'esto no es un pdf' }), 'x.zip');
  assert.equal(result.status, 'gap');
  assert.equal(result.metadata.gap_reason, 'archive_incomplete_extraction');
});

test('un nombre sin la marca UTF-8 se lee en CP437', () => {
  const raw = Buffer.from([0x46, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x6f, 0x20, 0x4e, 0xf8, 0x20, 0x31, 0x20, 0x2d, 0x20, 0x43, 0x6f, 0x6e, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x63, 0x69, 0xa2, 0x6e]);
  assert.equal(archiveEntryDisplayName({ rawEntryName: raw, header: { flags: 0 }, entryName: 'roto' }), 'Formato N° 1 - Conformación');
  assert.equal(archiveEntryDisplayName({ rawEntryName: Buffer.from('Información.docx'), header: { flags: 0 }, entryName: 'Información.docx' }), 'Información.docx', 'UTF-8 válido sin marca se respeta');
  assert.equal(archiveEntryDisplayName({ rawEntryName: raw, header: { flags: 0x800 }, entryName: 'con marca' }), 'con marca');
});
