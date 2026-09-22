import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startSyntheticAgt002HetznerBridge } from './fixtures/agt002-hetzner-bridge-synthetic-server.mjs';
import { createAgt002HetznerBridgeClient } from '../agt002-hetzner-bridge-client.js';
import { createAgt002ClaudeClient } from '../agt002-claude-client.js';
import { buildAgt002IntegralAnalysisV3OutputJsonSchema } from '../agt002-preview-contract.js';

// Regression for the V3 model-output boundary. The closed schema must survive
// the real signed HTTP hop unchanged and reach Claude as --json-schema with
// literal JSON, without acquiring server-owned keys. Claude Code 2.1.263 no
// longer supports the --json-schema-file fallback.

const SECRET = 'a'.repeat(32);

const VALIDATION_CONTEXT = {
  requirementManifest: [
    { requirement_id: 'REQ-1', category: 'discard' },
    { requirement_id: 'REQ-2', category: 'habilitating' },
  ],
  companyEvidenceClassIds: ['rup', 'licenses'],
  allowlist: {
    tender_document: ['document:doc-1'],
    company_evidence: ['company:rup-1'],
    legal_corpus: ['legal:rule-1'],
    human_evidence: ['human:answer-1'],
    objective_validation: ['objective:REQ-1:amount'],
  },
};

function baseRunInput() {
  return {
    model: 'sonnet',
    policy: 'POLICY',
    input: { snapshot_id: 'snap-1' },
    timeoutMs: 5000,
    idempotencyKey: 'idem-v3-schema-forwarding',
  };
}

function successUsage(content) {
  return { content, usage: { input_tokens: 12, output_tokens: 34 }, rate_limit: null };
}

function assertClosedIntegralShape(schema) {
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['integral_analysis']);
  const integral = schema.properties.integral_analysis;
  assert.equal(integral.additionalProperties, false);
  assert.deepEqual(integral.required, ['analysis_units']);
  assert.deepEqual(Object.keys(integral.properties), ['analysis_units']);
  for (const serverOwned of ['contract_version', 'coverage']) {
    assert.equal(Object.hasOwn(integral.properties, serverOwned), false, `integral_analysis must not offer ${serverOwned} to Claude`);
  }
}

async function testBridgeForwardsV3SchemaUnchanged() {
  const builtSchema = buildAgt002IntegralAnalysisV3OutputJsonSchema(VALIDATION_CONTEXT);
  const serializedSchema = JSON.stringify(builtSchema);
  let receivedByBridgeProvider = null;
  const capturingClient = {
    async run(options) {
      receivedByBridgeProvider = options.outputSchema;
      return successUsage(JSON.stringify({ integral_analysis: { analysis_units: [] } }));
    },
  };
  const bridge = await startSyntheticAgt002HetznerBridge({ hmacSecret: SECRET, codexClient: capturingClient });
  try {
    const client = createAgt002HetznerBridgeClient({ url: bridge.url, hmacSecret: SECRET });
    await client.run({ ...baseRunInput(), outputSchema: builtSchema });
    assert.equal(JSON.stringify(receivedByBridgeProvider), serializedSchema, 'the signed HTTP hop must preserve the serialized V3 schema byte-for-byte');
    assert.deepEqual(receivedByBridgeProvider, builtSchema);
    assertClosedIntegralShape(receivedByBridgeProvider);
  } finally {
    await bridge.close();
  }
}

function fakeClaudeSpawnCapturingSchema(capture) {
  return function spawn(command, args, options) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => { child.killed = true; return true; };
    child.stdin = {
      chunks: [],
      write(data) { this.chunks.push(String(data)); return true; },
      end() {
        capture.stdin = this.chunks.join('');
        queueMicrotask(() => {
          child.stdout.emit('data', Buffer.from(JSON.stringify({
            type: 'result', subtype: 'success', is_error: false,
            structured_output: { integral_analysis: { analysis_units: [] } },
            usage: { input_tokens: 1, output_tokens: 1 },
          })));
          child.emit('exit', 0, null);
        });
      },
      on() {},
    };

    const inlineIndex = args.indexOf('--json-schema');
    assert.notEqual(inlineIndex, -1, 'Claude must receive the schema via --json-schema');
    assert.equal(args.indexOf('--json-schema-file'), -1, 'the obsolete --json-schema-file flag must not be used');
    capture.schema = JSON.parse(args[inlineIndex + 1]);
    capture.call = { command, args, options };
    return child;
  };
}

async function testV3SchemaReachesClaudeClosedAndUnchanged() {
  const builtSchema = buildAgt002IntegralAnalysisV3OutputJsonSchema(VALIDATION_CONTEXT);
  const pristine = structuredClone(builtSchema);
  const capture = {};
  const claudeClient = createAgt002ClaudeClient({
    spawn: fakeClaudeSpawnCapturingSchema(capture), command: 'claude-fake', cwd: '/tmp', env: { PATH: '/usr/bin' },
  });
  const bridge = await startSyntheticAgt002HetznerBridge({ hmacSecret: SECRET, codexClient: claudeClient });
  try {
    const client = createAgt002HetznerBridgeClient({ url: bridge.url, hmacSecret: SECRET });
    const result = await client.run({ ...baseRunInput(), outputSchema: builtSchema });
    assert.deepEqual(JSON.parse(result.content), { integral_analysis: { analysis_units: [] } });

    assert.equal(capture.call.command, 'claude-fake');
    assert.equal(capture.call.args[capture.call.args.indexOf('--model') + 1], 'sonnet');
    assert.deepEqual(JSON.parse(capture.stdin), baseRunInput().input, 'only the structured input may travel through stdin');
    assert.deepEqual(capture.schema, builtSchema, 'the exact built V3 schema must reach Claude');
    assertClosedIntegralShape(capture.schema);
    assert.deepEqual(builtSchema, pristine, 'transport and Claude argv/file projection must not mutate the caller schema');
  } finally {
    await bridge.close();
  }
}

function schemaOfExactBytes(targetBytes) {
  const schema = { type: 'object', additionalProperties: false, properties: { pad: { type: 'string', description: '' } } };
  const overhead = Buffer.byteLength(JSON.stringify(schema), 'utf8');
  schema.properties.pad.description = 'x'.repeat(targetBytes - overhead);
  assert.equal(Buffer.byteLength(JSON.stringify(schema), 'utf8'), targetBytes);
  return schema;
}

// Regression: a valid schema sized above the OLD (now-removed) 65,536-byte inline ceiling but
// below the current AGT002_CLAUDE_MAX_SCHEMA_BYTES cap (120,000) must still forward unchanged
// through the full signed HTTP -> server -> Claude-client hop, literal on argv via --json-schema.
// Claude Code 2.1.263 has no --json-schema-file fallback, so there is no size band in which the
// bridge may silently switch transport — every accepted schema takes the exact same inline path.
async function testSchemaAbove65536BelowSchemaCapForwardsUnchangedThroughSignedHttpToClaude() {
  const schemaAround68KiB = schemaOfExactBytes(68 * 1024);
  const serializedBytes = Buffer.byteLength(JSON.stringify(schemaAround68KiB), 'utf8');
  assert.ok(serializedBytes > 65_536, 'the fixture must exceed the old inline ceiling');
  assert.ok(serializedBytes < 120_000, 'the fixture must stay below the current safe inline cap');
  const serializedSchema = JSON.stringify(schemaAround68KiB);
  const pristine = structuredClone(schemaAround68KiB);
  const capture = {};
  const claudeClient = createAgt002ClaudeClient({
    spawn: fakeClaudeSpawnCapturingSchema(capture), command: 'claude-fake', cwd: '/tmp', env: { PATH: '/usr/bin' },
  });
  const bridge = await startSyntheticAgt002HetznerBridge({ hmacSecret: SECRET, codexClient: claudeClient });
  try {
    const client = createAgt002HetznerBridgeClient({ url: bridge.url, hmacSecret: SECRET });
    const result = await client.run({ ...baseRunInput(), outputSchema: schemaAround68KiB });
    assert.deepEqual(JSON.parse(result.content), { integral_analysis: { analysis_units: [] } });

    assert.deepEqual(capture.schema, schemaAround68KiB, 'the ~68 KiB schema must reach Claude unchanged across the signed HTTP hop');
    assert.equal(JSON.stringify(capture.schema), serializedSchema, 'the serialized schema bytes must forward exactly, byte for byte');
    assert.equal(capture.call.args.includes('--json-schema-file'), false, 'Claude Code 2.1.263 does not support --json-schema-file; the old file fallback must never resurface');
    assert.deepEqual(schemaAround68KiB, pristine, 'transport and Claude argv projection must not mutate the caller schema');
  } finally {
    await bridge.close();
  }
}

await testBridgeForwardsV3SchemaUnchanged();
await testV3SchemaReachesClaudeClosedAndUnchanged();
await testSchemaAbove65536BelowSchemaCapForwardsUnchangedThroughSignedHttpToClaude();
console.log('agt002-v3-bridge-schema-forwarding.integration.test.mjs OK');
