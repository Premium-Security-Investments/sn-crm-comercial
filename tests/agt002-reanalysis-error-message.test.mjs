import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { agt002UnavailableMessage } from '../agt002-reanalysis-error-message.js';

const CLASSIFIED_CODES = {
  timeout: /tiempo máximo/i,
  provider_error: /proveedor de análisis/i,
  invalid_output: /validación técnica/i,
  persistence_failure: /guardar el resultado/i,
  lease_lost: /reserva de ejecución/i,
  capacity_unavailable: /capacidad del paquete/i,
};

const PRESERVATION_PATTERN = /an[aá]lisis canónico anterior[^.]*(se conserva|preserv|sigue disponible|permanece)/i;
const LEAK_PATTERN = /\bBearer\b|\bsk-[a-zA-Z0-9]|token[=:]|secret|api[-_ ]?key|stack ?trace|\bat \w+[:.]\d+/i;

for (const [code, expected] of Object.entries(CLASSIFIED_CODES)) {
  test(`gives a distinct safe explanation for ${code}`, () => {
    const message = agt002UnavailableMessage(code);
    assert.equal(typeof message, 'string');
    assert.match(message, expected);
    assert.match(message, PRESERVATION_PATTERN);
    assert.doesNotMatch(message, LEAK_PATTERN);
  });
}

test('every classified message is distinct', () => {
  const messages = Object.keys(CLASSIFIED_CODES).map(code => agt002UnavailableMessage(code));
  assert.equal(new Set(messages).size, messages.length);
});

test('unknown and null error codes return the same neutral message', () => {
  const unknown = agt002UnavailableMessage('some_unrecognized_code');
  const nullCode = agt002UnavailableMessage(null);
  assert.equal(unknown, nullCode);
  assert.match(unknown, /causa técnica no clasificada/i);
  assert.match(unknown, PRESERVATION_PATTERN);
  assert.doesNotMatch(unknown, LEAK_PATTERN);
});

test('inherited property names are treated as unknown codes, not resolved via the prototype chain', () => {
  const nullCode = agt002UnavailableMessage(null);
  for (const code of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    const message = agt002UnavailableMessage(code);
    assert.equal(typeof message, 'string');
    assert.equal(message, nullCode);
    assert.match(message, /causa técnica no clasificada/i);
    assert.match(message, PRESERVATION_PATTERN);
    assert.doesNotMatch(message, LEAK_PATTERN);
  }
});

test('main.tsx routes the reanalysis job error code through the safe message helper', () => {
  const source = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(source, /agt002UnavailableMessage\(\s*job\.error_code\s*\)/);
});
