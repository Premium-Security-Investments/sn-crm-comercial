import readline from 'node:readline';

/**
 * Test-only synthetic Codex App Server. Speaks the real app-server JSON-line
 * protocol (initialize, account/read, account/rateLimits/read, thread/start,
 * turn/start, item/completed, thread/tokenUsage/updated, turn/completed,
 * turn/interrupt, account/login/start) so agt002-preview-codex-client.js can
 * be exercised against a real child process without ever touching a real
 * OAuth session or the network. Behavior is selected by an explicit scenario
 * name passed as the first CLI argument (never by the untrusted `model`
 * field, which is not known at account/read time in the real protocol).
 */
const rl = readline.createInterface({ input: process.stdin, terminal: false });
const scenario = process.argv[2] || 'ok';

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const threadId = 'thread-synthetic-1';
const turnId = 'turn-synthetic-1';

function sendTurnOutcome(params) {
  if (scenario === 'turn-completed-object-status') {
    const content = JSON.stringify({ ok: true, scenario });
    send({ method: 'item/completed', params: { threadId, turnId, completedAtMs: 0, item: { id: 'item-1', type: 'agentMessage', text: content } } });
    send({ method: 'thread/tokenUsage/updated', params: { threadId, turnId, tokenUsage: {
      total: { inputTokens: 8, outputTokens: 3, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 11 },
      last: { inputTokens: 8, outputTokens: 3, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 11 },
    } } });
    send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: { type: 'completed' }, items: [] } } });
    return;
  }
  if (scenario === 'no-agent-message') {
    send({ method: 'thread/tokenUsage/updated', params: { threadId, turnId, tokenUsage: {
      total: { inputTokens: 5, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 5 },
      last: { inputTokens: 5, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 5 },
    } } });
    send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed', items: [] } } });
    return;
  }
  if (scenario === 'turn-failed') {
    send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: { type: 'failed' }, items: [], error: { codexErrorInfo: 'usageLimitExceeded', message: 'model failed secret detail' } } } });
    return;
  }
  if (scenario === 'turn-failed-unsafe-details') {
    send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: { type: 'failed with raw provider secret detail' }, items: [], error: { code: 'secret detail with spaces' } } } });
    return;
  }
  if (scenario === 'notify') {
    send({ method: 'turn/plan/updated', params: { threadId, turnId, note: 'progress' } });
  }
  const content = JSON.stringify({ ok: true, scenario, model: params?.model, received: params });
  send({ method: 'item/completed', params: { threadId, turnId, completedAtMs: 0, item: { id: 'item-1', type: 'agentMessage', text: content } } });
  send({ method: 'thread/tokenUsage/updated', params: { threadId, turnId, tokenUsage: {
    total: { inputTokens: 42, outputTokens: 7, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 49 },
    last: { inputTokens: 42, outputTokens: 7, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 49 },
  } } });
  send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed', items: [] } } });
}

rl.on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const { id, method, params } = message;

  if (method === 'initialize') {
    send({ id, result: { codexHome: '/tmp/codex-home-synthetic', platformFamily: 'unix', platformOs: 'linux', userAgent: 'synthetic-codex-app-server/1.0' } });
    return;
  }

  if (method === 'account/read') {
    if (scenario === 'login-required') { send({ id, result: { account: null, requiresOpenaiAuth: true } }); return; }
    if (scenario === 'apikey-account') { send({ id, result: { account: { type: 'apiKey' }, requiresOpenaiAuth: false } }); return; }
    if (scenario === 'account-error') { send({ id, error: { code: -32000, message: 'account read failed (should never reach the caller)' } }); return; }
    send({ id, result: { account: { type: 'chatgpt', email: 'ops@example.com', planType: 'team' }, requiresOpenaiAuth: false } });
    return;
  }

  if (method === 'account/rateLimits/read') {
    if (scenario === 'ratelimits-error') { send({ id, error: { code: -32000, message: 'rate limits unavailable' } }); return; }
    send({ id, result: { rateLimits: { primary: { usedPercent: 12, resetsAt: null, windowDurationMins: 300 } } } });
    return;
  }

  if (method === 'thread/start') {
    if (scenario === 'thread-error') { send({ id, error: { code: -32000, message: 'thread start failed' } }); return; }
    send({ id, result: {
      thread: {
        id: threadId, sessionId: 'sess-synthetic-1', cliVersion: 'synthetic', createdAt: 0, updatedAt: 0,
        cwd: params?.cwd || '/tmp', ephemeral: Boolean(params?.ephemeral), modelProvider: 'openai',
        preview: '', source: 'appServer', status: { type: 'idle' }, turns: [],
      },
      approvalPolicy: params?.approvalPolicy ?? 'never',
      approvalsReviewer: 'user',
      cwd: params?.cwd || '/tmp',
      model: params?.model || 'synthetic-codex-model',
      modelProvider: 'openai',
      sandbox: { type: 'readOnly', networkAccess: false },
    } });
    return;
  }

  if (method === 'turn/start') {
    if (scenario === 'turn-error') { send({ id, error: { code: -32000, message: 'turn start failed' } }); return; }
    send({ id, result: { turn: { id: turnId, status: 'inProgress', items: [] } } });
    if (scenario === 'hang') return;
    if (scenario === 'crash') { process.exit(7); }
    if (scenario === 'badjson') { process.stdout.write('not-json\n'); return; }
    sendTurnOutcome(params);
    return;
  }

  if (method === 'turn/interrupt') {
    send({ id, result: {} });
    send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'interrupted', items: [] } } });
    return;
  }

  if (method === 'account/login/start') {
    if (params?.type !== 'chatgptDeviceCode') { send({ id, error: { code: -32000, message: 'unsupported login type' } }); return; }
    send({ id, result: { type: 'chatgptDeviceCode', loginId: 'login-synthetic-1', userCode: 'ABCD-1234', verificationUrl: 'https://chatgpt.com/device' } });
    return;
  }

  if (method === 'account/login/cancel') {
    send({ id, result: {} });
    return;
  }
});
