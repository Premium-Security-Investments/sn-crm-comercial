import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buffersAreEqual } from '../scripts/check_backend_parity.mjs';

const serverSource = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const serverBuffer = readFileSync(new URL('../server/index.js', import.meta.url));
const apiBuffer = readFileSync(new URL('../api/[...path].js', import.meta.url));
const vercelConfig = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

function assertBackend(source, label) {
  assert.ok(source.includes("app.post('/api/tender-processing-worker-run', runTenderProcessingWorker);"), `${label}: falta compatibilidad POST del worker`);
  assert.ok(source.includes("app.get('/api/tender-processing-worker-run', runTenderProcessingWorker);"), `${label}: falta GET para Vercel Cron`);
  assert.ok(!source.includes('/api/internal'), `${label}: no debe usar el prefijo /api/internal reservado`);
  const start = source.indexOf('function secretMatches');
  const end = source.indexOf("app.get('/api/tender-processing-worker-run'", start);
  assert.ok(start >= 0 && end > start, `${label}: falta el autorizador del scheduler`);
  const block = source.slice(start, end);
  assert.ok(block.includes('timingSafeEqual'), `${label}: debe comparar secretos en tiempo constante`);
  assert.ok(block.includes('TENDER_WORKER_SCHEDULER_SECRET'), `${label}: debe conservar el secreto del scheduler externo`);
  assert.ok(block.includes('CRON_SECRET'), `${label}: debe aceptar el secreto nativo de Vercel Cron`);
  assert.ok(block.includes("req.headers.authorization"), `${label}: debe leer Authorization Bearer`);
  assert.ok(block.includes("req.headers['x-tender-worker-secret']"), `${label}: debe conservar el header del scheduler externo`);
  assert.ok(!block.includes('getAuthContext'), `${label}: no debe requerir sesión de navegador`);
  assert.ok(block.includes('requireDb()'), `${label}: debe usar el cliente de service role`);
  assert.ok(block.includes('timeBudgetMs: 45_000'), `${label}: debe terminar antes del límite serverless de 60 segundos`);
  assert.ok(!block.includes('req.body.opportunity_id') && !block.includes('req.body?.opportunity_id'), `${label}: no debe aceptar un expediente arbitrario`);
  assert.ok(block.includes('isTenderDurablePipelineEnabled'), `${label}: debe estar detrás del flag durable`);
}

function run() {
  assertBackend(serverSource, 'server/index.js');
  assertBackend(apiSource, 'api/[...path].js');
  assert.ok(buffersAreEqual(serverBuffer, apiBuffer), 'server/index.js y api/[...path].js deben ser byte-idénticos');
  // El plan Hobby de Vercel rechaza crons con cadencia menor a un día: el
  // scheduling del worker corre desde un systemd timer en Hetzner (ver
  // ops/tender-worker-scheduler/), no desde vercel.json. El endpoint conserva
  // el header GET/POST y el autorizador por secreto para ese caller externo.
  assert.ok(!('crons' in vercelConfig), 'vercel.json no debe declarar crons: son incompatibles con el plan Hobby');
  assert.equal(vercelConfig.functions?.['api/[...path].js']?.maxDuration, 180, 'la función compartida debe permitir el análisis Vig-IA de 120 segundos; el worker conserva su presupuesto interno de 45 segundos');
  console.log('tender-processing-worker-endpoint-static passed');
}
run();
