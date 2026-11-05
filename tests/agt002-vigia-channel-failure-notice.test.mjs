import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

// F15 de la auditoría del piloto Fiscalía: a las 02:18Z del 5-nov todos los pedidos desde 01:57Z estaban completados
// y el aviso «Vig-IA no pudo responder el último mensaje» seguía, con «Reintentar» apuntando al primer fallido.
const helperUrl = new URL('../src/tenders/workspace/vigiaChannelFailure.ts', import.meta.url);
const channel = readFileSync(new URL('../src/tenders/workspace/TenderVigiaChannel.tsx', import.meta.url), 'utf8');

const job = (id, status, createdAt) => ({ id, status, created_at: createdAt });
const RELLENO_CANCELADO = job('6028444b', 'failed', '2026-11-04T23:40:00Z');
const TIEMPO_AGOTADO = job('4ef8df10', 'failed', '2026-11-05T01:50:00Z');
const RESPONDIDO = job('a1b2c3d4', 'completed', '2026-11-05T01:57:00Z');

async function helper() {
  assert.ok(existsSync(helperUrl), 'falta src/tenders/workspace/vigiaChannelFailure.ts');
  return import(helperUrl.href);
}

test('caso Fiscalía: fallos viejos y después un pedido respondido → sin aviso', async () => {
  const { lastFailedVigiaJob } = await helper();
  assert.equal(lastFailedVigiaJob([RELLENO_CANCELADO, TIEMPO_AGOTADO, RESPONDIDO]), null);
  assert.equal(lastFailedVigiaJob([RESPONDIDO, TIEMPO_AGOTADO, RELLENO_CANCELADO]), null, 'no depende del orden en que lleguen');
});

test('si el último pedido falló, el aviso y «Reintentar» son de ése, no del primer fallido', async () => {
  const { lastFailedVigiaJob } = await helper();
  const nuevoFallido = job('ffff0001', 'failed', '2026-11-05T02:10:00Z');
  assert.equal(lastFailedVigiaJob([RELLENO_CANCELADO, RESPONDIDO, nuevoFallido])?.id, 'ffff0001');
});

test('un pedido obsoleto no cuenta como el último; sin pedidos no hay aviso', async () => {
  const { lastFailedVigiaJob } = await helper();
  assert.equal(lastFailedVigiaJob([TIEMPO_AGOTADO, job('0b50', 'obsolete', '2026-11-05T02:00:00Z')])?.id, '4ef8df10');
  assert.equal(lastFailedVigiaJob([]), null);
  assert.equal(lastFailedVigiaJob(undefined), null);
});

test('el canal usa el último pedido fallido y ya no reintenta failed[0]', () => {
  assert.match(channel, /lastFailedVigiaJob\(data\?\.jobs\)/);
  assert.doesNotMatch(channel, /failed\[0\]/);
  assert.match(channel, /retry\(failed\.id\)/);
});
