import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  turnStartParamsExposesEffort,
  checkCodexEffortCapability,
  AGT002_CODEX_EFFORT_CAPABILITY_OK,
  AGT002_CODEX_EFFORT_CAPABILITY_MISSING,
} from '../agt002-codex-effort-capability.js';

// This module never performs a live model call: it only parses text a human/ops step already
// captured from `codex app-server generate-json-schema` / `generate-ts`. Enforced structurally so
// a future edit cannot silently wire it to a real turn.
//
// The check runs against the source with comments stripped: a plain substring/regex match against
// raw source is trivially defeated by (or falsely tripped by) a comment mentioning the protocol
// method names in prose — as this file's own header comment does. Stripping comments first makes
// the assertion mean what it says: no *executable* reference to the live turn protocol.
function stripJsComments(jsSource) {
  return jsSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const source = readFileSync(new URL('../agt002-codex-effort-capability.js', import.meta.url), 'utf8');
const executableSource = stripJsComments(source);
assert.doesNotMatch(executableSource, /turn\/start|thread\/start|account\/read|account\/login/, 'the capability check must never speak the live Codex App Server turn protocol in executable code');
assert.doesNotMatch(executableSource, /child_process|spawn|exec/, 'the capability check must never itself invoke a subprocess — generate() is always caller-injected');

const JSON_SCHEMA_WITH_EFFORT = JSON.stringify({
  $defs: {
    v2TurnStartParams: {
      type: 'object',
      properties: { threadId: { type: 'string' }, effort: { type: 'string', enum: ['low', 'medium', 'high'] } },
    },
  },
});

const JSON_SCHEMA_WITHOUT_EFFORT = JSON.stringify({
  $defs: {
    v2TurnStartParams: {
      type: 'object',
      properties: { threadId: { type: 'string' } },
    },
  },
});

const TS_BINDINGS_WITH_EFFORT = `
export interface ThreadStartParams {
  cwd: string;
}
export interface TurnStartParams {
  threadId: string;
  effort?: 'low' | 'medium' | 'high';
}
`;

const TS_BINDINGS_WITHOUT_EFFORT = `
export interface TurnStartParams {
  threadId: string;
  input: InputItem[];
}
`;

function testJsonSchemaWithEffortIsDetected() {
  assert.equal(turnStartParamsExposesEffort(JSON_SCHEMA_WITH_EFFORT), true);
}

function testJsonSchemaWithoutEffortIsRejected() {
  assert.equal(turnStartParamsExposesEffort(JSON_SCHEMA_WITHOUT_EFFORT), false);
}

function testTsBindingsWithEffortIsDetected() {
  assert.equal(turnStartParamsExposesEffort(TS_BINDINGS_WITH_EFFORT), true);
}

function testTsBindingsWithoutEffortIsRejected() {
  assert.equal(turnStartParamsExposesEffort(TS_BINDINGS_WITHOUT_EFFORT), false);
}

function testMalformedOrEmptyInputFailsClosed() {
  assert.equal(turnStartParamsExposesEffort(''), false);
  assert.equal(turnStartParamsExposesEffort('{not json'), false);
  assert.equal(turnStartParamsExposesEffort(undefined), false);
  assert.equal(turnStartParamsExposesEffort('export interface Unrelated { x: number }'), false);
}

function testCheckReportsOkForACapableBinary() {
  const result = checkCodexEffortCapability({ generate: () => JSON_SCHEMA_WITH_EFFORT });
  assert.deepEqual(result, { ok: true, code: AGT002_CODEX_EFFORT_CAPABILITY_OK });
}

function testCheckReportsMissingForAStaleBinary() {
  const result = checkCodexEffortCapability({ generate: () => JSON_SCHEMA_WITHOUT_EFFORT });
  assert.deepEqual(result, { ok: false, code: AGT002_CODEX_EFFORT_CAPABILITY_MISSING });
}

function testCheckRequiresAnInjectedGenerator() {
  assert.throws(() => checkCodexEffortCapability({}), /generate/i);
}

testJsonSchemaWithEffortIsDetected();
testJsonSchemaWithoutEffortIsRejected();
testTsBindingsWithEffortIsDetected();
testTsBindingsWithoutEffortIsRejected();
testMalformedOrEmptyInputFailsClosed();
testCheckReportsOkForACapableBinary();
testCheckReportsMissingForAStaleBinary();
testCheckRequiresAnInjectedGenerator();
console.log('agt002-codex-effort-capability.test.mjs OK');
