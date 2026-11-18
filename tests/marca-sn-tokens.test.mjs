import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tokens = JSON.parse(readFileSync(new URL('../design/marca-sn.tokens.json', import.meta.url), 'utf8'));

const leer = (ruta) => ruta.split('.').reduce((nodo, clave) => nodo?.[clave], tokens);

function resolver(valor, vistos = new Set()) {
  const ref = typeof valor === 'string' && valor.match(/^\{(.+)\}$/);
  if (!ref) return valor;
  assert.ok(!vistos.has(ref[1]), `referencia circular: ${ref[1]}`);
  const nodo = leer(ref[1]);
  assert.ok(nodo && '$value' in nodo, `referencia rota: ${ref[1]}`);
  return resolver(nodo.$value, new Set([...vistos, ref[1]]));
}

function* hojas(nodo, ruta = []) {
  if (nodo && typeof nodo === 'object' && '$value' in nodo) { yield [ruta.join('.'), nodo.$value]; return; }
  for (const [clave, hijo] of Object.entries(nodo ?? {})) {
    if (!clave.startsWith('$') && hijo && typeof hijo === 'object') yield* hojas(hijo, [...ruta, clave]);
  }
}

const color = (ruta) => resolver(`{${ruta}}`);

function luminancia(hex) {
  const [r, g, b] = hex.slice(1).match(/../g).map((p) => {
    const c = parseInt(p, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

test('toda referencia del JSON apunta a un token que existe', () => {
  let n = 0;
  for (const [ruta, valor] of hojas(tokens)) {
    const final = resolver(valor);
    assert.notEqual(final, undefined, ruta);
    n += 1;
  }
  assert.ok(n > 100, `se esperaban más de 100 tokens, hay ${n}`);
});

test('los colores son hex de 6 dígitos o rgba', () => {
  for (const [ruta, valor] of hojas(tokens.color, ['color'])) {
    assert.match(valor, /^(#[0-9A-F]{6}|rgba\([^)]+\))$/, ruta);
  }
});

test('el texto pequeño cumple 4,5:1 donde el sistema lo promete', () => {
  const pares = [
    ['color.tinta', 'color.hoja'],
    ['color.tinta-2', 'color.hoja'],
    ['color.tinta-3', 'color.hoja'],
    ['color.tinta-3', 'color.mesa'],
    ['color.sobre-azul.apagado', 'color.azul'],
    ['color.sobre-azul.tenue', 'color.azul-superficie'],
    ['color.sobre-azul.claro', 'color.azul'],
    ['componente.boton.primario.letra', 'componente.boton.primario.fondo'],
    ['componente.boton.peligro.letra', 'componente.boton.peligro.fondo'],
    ['componente.cifra.valor-atencion', 'componente.cifra.fondo'],
    ...['nuevo', 'curso', 'cotizacion', 'ok', 'mal', 'neutro'].map((v) => [`componente.estado.${v}.letra`, `componente.estado.${v}.fondo`]),
    ...['info', 'aviso', 'critico', 'ok'].map((v) => [`componente.aviso.${v}.letra`, `componente.aviso.${v}.fondo`]),
  ];
  for (const [letra, fondo] of pares) {
    const r = contraste(color(letra), color(fondo));
    assert.ok(r >= 4.5, `${letra} sobre ${fondo}: ${r.toFixed(2)}:1`);
  }
});

test('blanco sobre amarillo no se lee: por eso el primario lleva letra azul', () => {
  assert.ok(contraste('#FFFFFF', color('color.amarillo')) < 1.5);
  assert.equal(color('componente.boton.primario.letra'), color('color.azul'));
});

test('ningún estado ni aviso usa el amarillo de marca', () => {
  const amarillo = color('color.amarillo');
  for (const grupo of ['estado', 'aviso']) {
    for (const [ruta, valor] of hojas(tokens.componente[grupo], ['componente', grupo])) {
      assert.notEqual(resolver(valor), amarillo, ruta);
    }
  }
});
