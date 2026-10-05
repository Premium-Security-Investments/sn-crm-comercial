import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toClaudeProviderOutputSchema, createAgt002ClaudeClient } from '../agt002-claude-client.js';

const PRE_GO = JSON.parse(readFileSync(new URL('../schemas/agt002/pre_go_analysis.v1.schema.json', import.meta.url), 'utf8'));

function walk(node, visit) {
  if (Array.isArray(node)) return node.forEach(n => walk(n, visit));
  if (node && typeof node === 'object') {
    visit(node);
    Object.values(node).forEach(n => walk(n, visit));
  }
}

test('pre_go_analysis.v1 reaches the provider without keywords it rejects', () => {
  const adapted = toClaudeProviderOutputSchema(PRE_GO);
  for (const key of ['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else']) {
    assert.equal(key in adapted, false, `la raíz no puede llevar ${key}: la API lo rechaza con 400`);
  }
  walk(adapted, node => {
    for (const key of ['$schema', 'minContains', 'maxContains']) {
      assert.equal(key in node, false, `${key} hace fallar la validación estricta de la CLI al instante`);
    }
  });
});

test('the canonical schema is left untouched and its structure is preserved', () => {
  const before = JSON.stringify(PRE_GO);
  const adapted = toClaudeProviderOutputSchema(PRE_GO);
  assert.equal(JSON.stringify(PRE_GO), before);
  assert.deepEqual(adapted.required, PRE_GO.required);
  assert.deepEqual(Object.keys(adapted.properties), Object.keys(PRE_GO.properties));
});

test('a schema without unsupported keywords travels unchanged', () => {
  const simple = { type: 'object', properties: { a: { type: 'string', minLength: 1 } }, required: ['a'], additionalProperties: false };
  assert.deepEqual(toClaudeProviderOutputSchema(simple), simple);
});

test('the client sends the adapted schema in argv', async () => {
  let captured;
  const spawn = (cmd, args) => {
    captured = args;
    const { EventEmitter } = require_events();
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { write() {}, end() { setImmediate(() => { child.stdout.emit('data', JSON.stringify({ is_error: false, result: '{}', usage: { input_tokens: 1, output_tokens: 1 } })); child.emit('close', 0); }); } };
    child.kill = () => {};
    return child;
  };
  const client = createAgt002ClaudeClient({ spawn, cwd: '/tmp' });
  await client.run({ model: 'sonnet', policy: 'p', input: { a: 1 }, outputSchema: PRE_GO }).catch(() => {});
  const sent = JSON.parse(captured[captured.indexOf('--json-schema') + 1]);
  assert.equal('allOf' in sent, false);
  assert.equal('$schema' in sent, false);
});

import { EventEmitter } from 'node:events';
function require_events() { return { EventEmitter }; }
