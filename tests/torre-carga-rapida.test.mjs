import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { claveDeRentabilidad, guardar, leerGuardado } from '../torre-guardada.js';
import { facturasParaRefacturacion, notasCreditoPorMes } from '../avancys-torre.js';

// La Torre al entrar (Juan, 2026-11-20): lo último guardado al instante, el vivo después; y el vivo más rápido.

function baseFalsa() {
  const filas = new Map();
  return {
    filas,
    from: () => ({
      select: () => ({ eq: (_c, clave) => ({ limit: async () => ({ data: filas.has(clave) ? [filas.get(clave)] : [], error: null }) }) }),
      upsert: async fila => { filas.set(fila.clave, fila); return { error: null }; },
    }),
  };
}

test('lo guardado vuelve con su hora y marcado; un cálculo fallido no reemplaza al último bueno', async () => {
  const db = baseFalsa();
  assert.equal(await leerGuardado(db, 'torre'), null);
  assert.equal(await guardar(db, 'torre', { mes_cerrado: '2026-09', medido_en: '2026-11-20T13:00:00Z', desde_memoria: false }), true);
  const leido = await leerGuardado(db, 'torre');
  assert.equal(leido.mes_cerrado, '2026-09');
  assert.equal(leido.desde_guardado, true);
  assert.equal(leido.medido_en, '2026-11-20T13:00:00Z');
  assert.equal('desde_memoria' in db.filas.get('torre').datos, false);
  assert.equal(await guardar(db, 'torre', { autenticado: false, medido_en: 'x' }), false);
  assert.equal(await guardar(db, claveDeRentabilidad('2026-09'), { legible: false }), false);
  assert.equal((await leerGuardado(db, 'torre')).mes_cerrado, '2026-09');
  assert.equal(claveDeRentabilidad('2026-09'), 'rentabilidad:2026-09');
  assert.equal(claveDeRentabilidad('septiembre'), null);
  assert.equal(await leerGuardado(null, 'torre'), null);
});

test('refacturaciones: el grupo de una sola factura trae su valor; los días con varias se leen una por una', async () => {
  const notas = [
    { invoice_date: '2026-10-10', amount_untaxed_signed: -500, commercial_partner_id: [7, 'CLIENTE A'], ref: '', reversed_entry_id: false },
    { invoice_date: '2026-10-20', amount_untaxed_signed: -300, commercial_partner_id: [8, 'CLIENTE B'], ref: '', reversed_entry_id: false },
  ];
  const llamadas = [];
  const ejecutar = async (modelo, metodo, args, kwargs) => {
    llamadas.push({ modelo, metodo, args, kwargs });
    if (metodo === 'read_group') {
      return [
        { commercial_partner_id: [7, 'CLIENTE A'], __count: 1, amount_untaxed_signed: 500, __range: { 'invoice_date:day': { from: '2026-10-11', to: '2026-10-12' } } },
        { commercial_partner_id: [8, 'CLIENTE B'], __count: 2, amount_untaxed_signed: 900, __domain: [['invoice_date', '>=', '2026-10-21'], ['invoice_date', '<', '2026-10-22']] },
        // Lejos de toda nota: no se lee.
        { commercial_partner_id: [7, 'CLIENTE A'], __count: 3, amount_untaxed_signed: 100, __range: { 'invoice_date:day': { from: '2026-08-01', to: '2026-08-02' } } },
      ];
    }
    if (metodo === 'search_read') return [{ invoice_date: '2026-10-21', amount_untaxed_signed: 300, commercial_partner_id: [8, 'CLIENTE B'] }, { invoice_date: '2026-10-21', amount_untaxed_signed: 600, commercial_partner_id: [8, 'CLIENTE B'] }];
    return [];
  };
  const facturas = await facturasParaRefacturacion(ejecutar, { desde: '2026-08-01', notas });
  assert.deepEqual(facturas.map(f => [f.commercial_partner_id[0], f.invoice_date, f.amount_untaxed_signed]), [[7, '2026-10-11', 500], [8, '2026-10-21', 300], [8, '2026-10-21', 600]]);
  const grupo = llamadas.find(l => l.metodo === 'read_group');
  assert.deepEqual(grupo.args[0].at(-1), ['commercial_partner_id', 'in', [7, 8]], 'solo los clientes con notas');
  const detalle = llamadas.filter(l => l.metodo === 'search_read');
  assert.equal(detalle.length, 1, 'una sola lectura para los días con varias facturas');
  assert.deepEqual(detalle[0].args[0].slice(2), ['&', ['commercial_partner_id', '=', 8], ['invoice_date', '=', '2026-10-21']]);
});

test('una nota que se refacturó la misma semana por el mismo valor cuenta como corrección', async () => {
  const ejecutar = async (modelo, metodo) => {
    if (metodo === 'search_read') return [{ ref: '', invoice_date: '2026-10-10', amount_untaxed_signed: -500, commercial_partner_id: [7, 'CLIENTE A'], reversed_entry_id: false }];
    if (metodo === 'read_group') return [{ commercial_partner_id: [7, 'CLIENTE A'], __count: 1, amount_untaxed_signed: 500, __range: { 'invoice_date:day': { from: '2026-10-11' } } }];
    return [];
  };
  const r = await notasCreditoPorMes(ejecutar, { desde: '2026-08-01' });
  assert.equal(r.meses['2026-10'].correccion.notas, 1);
  assert.equal(r.meses['2026-10'].sin_motivo.notas, 0);
});

test('la pantalla pide primero lo guardado, no lo pide dos veces y dice que está actualizando', () => {
  const vista = readFileSync(new URL('../src/siio/SiioTorreAvancys.tsx', import.meta.url), 'utf8');
  assert.match(vista, /\/api\/siio\/avancys\/torre\?guardada=1/);
  assert.match(vista, /if \(!guardada\.desde_guardado\) return;/);
  assert.match(vista, /Mostrando el último cálculo · actualizando…/);
  assert.match(vista, /No se pudo actualizar: se muestra el último cálculo/);
  const servidor = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.match(servidor, /leerGuardado\(requireDb\(\), 'torre'\)/);
  assert.match(servidor, /guardarTorre\(requireDb\(\), 'torre', torre\)/);
});
