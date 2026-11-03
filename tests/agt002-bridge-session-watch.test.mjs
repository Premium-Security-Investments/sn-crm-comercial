import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { agt002BridgeSessionNoticeLine, readBridgeSession, runAgt002BridgeSessionWatch } from '../verticales/licitaciones/agt002-bridge-session-watch.js';

const now = new Date('2026-11-21T12:00:00Z');
const at = iso => Date.parse(iso);
const fakeFiles = files => async path => { if (!(path in files)) throw new Error('ENOENT'); return files[path]; };
const session = (expires, token = 'secreto-que-no-debe-salir') => JSON.stringify({ claudeAiOauth: { accessToken: token, refreshToken: 'otro-secreto', refreshTokenExpiresAt: expires } });

test('lee sólo el vencimiento y si quedó en blanco; el token nunca sale', async () => {
  const read = await readBridgeSession('/a', fakeFiles({ '/a': session(at('2026-11-28T05:55:00Z')) }));
  assert.deepEqual(read, { expiresAt: at('2026-11-28T05:55:00Z'), blank: false, unreadable: false });
  assert.equal(JSON.stringify(read).includes('secreto'), false);
  assert.deepEqual(await readBridgeSession('/b', fakeFiles({ '/b': session(0, '') })), { expiresAt: null, blank: true, unreadable: false });
  assert.deepEqual(await readBridgeSession('/x', fakeFiles({})), { expiresAt: null, blank: false, unreadable: true });
});

// Fechas reales de las tres sesiones renovadas el 2026-10-31.
test('avisa a 7 días con la fecha, no con los días que faltan', () => {
  const sessions = [
    { agent: 'AGT-002', expiresAt: at('2026-11-28T05:55:00Z'), blank: false },
    { agent: 'AGT-001', expiresAt: at('2026-11-30T01:39:00Z'), blank: false },
  ];
  assert.equal(agt002BridgeSessionNoticeLine(sessions, { now: new Date('2026-11-20T12:00:00Z') }), null, 'a 8 días todavía no');
  const line = agt002BridgeSessionNoticeLine(sessions, { now });
  assert.match(line, /AGT-002: la sesión vence el 2026-11-28 05:55 UTC/);
  assert.equal(line.includes('AGT-001'), false, 'a 8,5 días todavía no');
  assert.equal(agt002BridgeSessionNoticeLine(sessions, { now: new Date('2026-11-22T12:00:00Z') }), line, 'la misma línea al día siguiente: no se duplica');
});

test('lo que no se puede vigilar se dice, y lo vencido también', () => {
  const line = agt002BridgeSessionNoticeLine([
    { agent: 'AGT-001', blank: true, expiresAt: null },
    { agent: 'AGT-003', unreadable: true, expiresAt: null },
  ], { now });
  assert.match(line, /AGT-001: la sesión ya venció/);
  assert.match(line, /AGT-003: no se pudo leer su sesión/);
});

test('deja la línea en los expedientes activos y los eventos no llevan el token', async () => {
  const written = [];
  const database = { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [
    { id: 't1', ref: 'SNS', converted_opportunity_id: 'o1' }, { id: 't2', ref: 'ARCH', converted_opportunity_id: 'o2' },
  ], error: null }) }) }) }) };
  const events = await runAgt002BridgeSessionWatch(database, {
    sessions: [{ agent: 'AGT-002', path: '/a' }],
    readFile: fakeFiles({ '/a': session(at('2026-11-28T05:55:00Z')) }),
    now,
    inactiveReason: async (_db, opportunityId) => (opportunityId === 'o2' ? 'archivado' : null),
    appendLine: async (_db, opportunityId, line) => { written.push([opportunityId, line]); },
  });
  assert.deepEqual(written.map(([id]) => id), ['o1']);
  assert.equal(JSON.stringify(events).includes('secreto'), false);
  assert.equal(events.find(event => event.event === 'agt002_bridge_session_read').expires_at, '2026-11-28T05:55:00.000Z');
});
