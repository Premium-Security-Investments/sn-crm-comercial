import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync, statSync } from 'node:fs';
import { startSyntheticAgt002HetznerBridge } from './fixtures/agt002-hetzner-bridge-synthetic-server.mjs';
import { createAgt002HetznerBridgeClient } from '../agt002-hetzner-bridge-client.js';
import { createAgt002ClaudeClient } from '../agt002-claude-client.js';
import { buildAgt002IntegralAnalysisV3OutputJsonSchema } from '../agt002-preview-contract.js';

// Regression for the V3 model-output boundary. The closed schema must survive
// the real signed HTTP hop unchanged and reach Claude as --json-schema (or the
// mode-0600 --json-schema-file fallback) without acquiring server-owned keys.

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
    const fileIndex = args.indexOf('--json-schema-file');
    assert.notEqual(inlineIndex === -1, fileIndex === -1, 'Claude must receive exactly one schema transport flag');
    if (inlineIndex !== -1) {
      capture.schemaMode = 'argv';
      capture.schema = JSON.parse(args[inlineIndex + 1]);
    } else {
      capture.schemaMode = 'file';
      capture.schemaPath = args[fileIndex + 1];
      capture.schemaFileMode = statSync(capture.schemaPath).mode & 0o777;
      capture.schema = JSON.parse(readFileSync(capture.schemaPath, 'utf8'));
    }
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
    if (capture.schemaMode === 'file') assert.equal(capture.schemaFileMode, 0o600, 'the schema file must be private while Claude starts');
    assertClosedIntegralShape(capture.schema);
    assert.deepEqual(builtSchema, pristine, 'transport and Claude argv/file projection must not mutate the caller schema');
  } finally {
    await bridge.close();
  }
}

await testBridgeForwardsV3SchemaUnchanged();
await testV3SchemaReachesClaudeClosedAndUnchanged();
console.log('agt002-v3-bridge-schema-forwarding.integration.test.mjs OK');
