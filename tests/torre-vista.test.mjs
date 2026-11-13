import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { clientesMesVencido } from '../avancys-torre.js';
import { CLIENTES_MES_VENCIDO } from '../avancys-pyg.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('los clientes de mes vencido son los marcados en el CRM; la lista fija sólo si la base no responde', async () => {
  const db = resultado => ({ from: () => ({ select: () => ({ eq: () => Promise.resolve(resultado) }) }) });
  assert.deepEqual(await clientesMesVencido(db({ data: [{ avancys_ref_num: ' 900000001 ' }, { avancys_ref_num: '900000002' }, { avancys_ref_num: null }], error: null })), ['900000001', '900000002']);
  assert.equal(await clientesMesVencido(db({ data: null, error: { message: 'falla' } })), CLIENTES_MES_VENCIDO);
  assert.equal(await clientesMesVencido(null), CLIENTES_MES_VENCIDO);
  assert.match(read('server/index.js'), /torreAvancys\(\{ refrescar: req\.query\.refrescar === '1', db: requireDb\(\) \}\)/);
  assert.match(read('verticales/gerencial/siio-recommendations.js'), /torreAvancys\(\{ ahora: \(\) => now, db: database \}\)/);
});

test('la portada: lo de hoy en tarjetas, la proyección no se presenta como resultado y Clientes tiene su propio mes', () => {
  const torre = read('src/siio/SiioTorreAvancys.tsx');
  assert.match(torre, /export type AlertaTorre = \{ clave: string; cifra: string; texto: string; pestana: PestanaTorre \}/);
  assert.match(torre, /Requiere decisión hoy/);
  assert.match(torre, /<Badge tone="amber">Proyección<\/Badge>/);
  assert.match(torre, /cierre de Finanzas/);
  // Los que pierden: últimos tres meses cerrados y acumulado del año; el mes elegido sólo cambia el detalle.
  assert.match(torre, /const MESES_PIERDEN = 3;/);
  assert.match(torre, /<th>Acumulado \{anio\}<\/th>/);
  assert.match(torre, /aria-label="Cliente por cliente"[\s\S]*<select value=\{mesClientes\}/);
  // El selector general ya no pide clientes de un mes abierto.
  assert.doesNotMatch(torre, /clientesDelMes/);
});
