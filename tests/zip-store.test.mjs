// El ZIP del paquete de la oferta se arma en el navegador, así que lo único que vale como prueba es **leerlo de
// vuelta con una librería real**: si `adm-zip` lo abre, el Explorador de Windows y el Finder también.
import test from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { crc32, zipEntryName, zipStore } from '../verticales/licitaciones/zip-store.js';

const NOW = new Date('2026-10-30T15:30:00.000Z');

test('un ZIP con carpetas y archivos se abre con una librería real', () => {
  const zip = zipStore({
    folders: ['00_Control', '02_Juridico', '07_Polizas'],
    entries: [
      { name: '00_Control/00_INDICE.md', content: '# Índice del paquete\n\nTerminal de Transporte.\n' },
      { name: '02_Juridico/Cámara de Comercio.txt', content: 'certificado' },
      { name: '07_Polizas/poliza.bin', content: new Uint8Array([0, 1, 2, 253, 254, 255]) },
    ],
    now: NOW,
  });
  const read = new AdmZip(Buffer.from(zip));
  const names = read.getEntries().map(entry => entry.entryName).sort();
  assert.deepEqual(names, [
    '00_Control/',
    '00_Control/00_INDICE.md',
    '02_Juridico/',
    '02_Juridico/Cámara de Comercio.txt',
    '07_Polizas/',
    '07_Polizas/poliza.bin',
  ]);
  assert.equal(read.readAsText('00_Control/00_INDICE.md'), '# Índice del paquete\n\nTerminal de Transporte.\n');
  assert.equal(read.readAsText('02_Juridico/Cámara de Comercio.txt'), 'certificado');
  assert.deepEqual([...read.readFile('07_Polizas/poliza.bin')], [0, 1, 2, 253, 254, 255]);
  // Las carpetas quedan marcadas como tales, así que existen aunque estén vacías.
  for (const entry of read.getEntries()) {
    if (entry.entryName.endsWith('/')) assert.equal(entry.isDirectory, true, entry.entryName);
  }
});

test('las carpetas vacías sobreviven: el paquete muestra lo que falta', () => {
  const zip = zipStore({ folders: ['00_Control', '06_Economico'], entries: [], now: NOW });
  const read = new AdmZip(Buffer.from(zip));
  assert.deepEqual(read.getEntries().map(entry => entry.entryName).sort(), ['00_Control/', '06_Economico/']);
});

test('los bytes no se tocan y el CRC es el de la norma', () => {
  // Vector conocido: el CRC-32 de "123456789" es 0xCBF43926.
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const grande = new Uint8Array(100_000).map((_, index) => index % 251);
  const read = new AdmZip(Buffer.from(zipStore({ entries: [{ name: 'g.bin', content: grande }], now: NOW })));
  assert.deepEqual([...read.readFile('g.bin')], [...grande], 'un archivo grande vuelve byte por byte');
});

test('el nombre se limpia y no deja escapar de la carpeta', () => {
  assert.equal(zipEntryName('02_Juridico\\RUT.pdf'), '02_Juridico/RUT.pdf');
  assert.equal(zipEntryName('/02_Juridico//RUT.pdf'), '02_Juridico/RUT.pdf');
  assert.equal(zipEntryName('../../etc/passwd'), 'etc/passwd');
  assert.throws(() => zipEntryName('   '), /necesita nombre/);
  assert.throws(() => zipEntryName('..'), /necesita nombre/);
});

test('dos entradas con el mismo nombre son un error, no un archivo perdido', () => {
  assert.throws(() => zipStore({
    entries: [{ name: '00_Control/a.txt', content: 'uno' }, { name: '00_Control/a.txt', content: 'dos' }],
  }), /dos entradas con el mismo nombre/);
});

test('el ZIP está vacío cuando no hay nada, y sigue siendo un ZIP válido', () => {
  const read = new AdmZip(Buffer.from(zipStore({ now: NOW })));
  assert.deepEqual(read.getEntries(), []);
});
