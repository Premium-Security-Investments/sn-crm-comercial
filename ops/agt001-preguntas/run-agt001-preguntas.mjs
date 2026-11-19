#!/usr/bin/env node
// AGT-001 «Pregúntele a Vig-IA»: trabajador residente del servidor. Toma las preguntas pendientes de la Torre, una a
// la vez, corre Vig-IA (`claude -p` con la sesión de AGT-001) con las herramientas de solo lectura de mcp-datos.mjs y
// escribe la respuesta.
//
// Por qué residente y no un reloj (regla de 2026-11-11 sobre frecuencias): el directivo está esperando frente a la
// pantalla y Juan acordó una respuesta en 1 o 2 minutos. Un reloj de 2 minutos sumaría hasta 2 minutos de espera; el
// trabajador mira la cola cada 5 segundos con una consulta indexada (índice parcial sobre status = 'pendiente').
//
// Al modelo no le llega ninguna llave: el subproceso `claude` hereda solo HOME, CLAUDE_CONFIG_DIR, PATH y LANG, y no
// tiene herramientas propias (--tools ''); las credenciales de solo lectura las usa el servidor MCP.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POLITICA, ESQUEMA_RESPUESTA, validarRespuesta, unaSolaAtencion, claveTema, construirMensaje, clasificarFalla } from './vigia-respuesta.mjs';
import { PREGUNTAS_TABLE, CONOCIMIENTO_TABLE, PREGUNTA_ABANDONADA_MS } from '../../verticales/gerencial/vigia-preguntas.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ESPERA_MS = Number(process.env.VIGIA_ESPERA_MS) || 5_000;
const TOPE_TURNO_MS = Number(process.env.VIGIA_TOPE_MS) || 8 * 60_000;
const MODELO = process.env.AGT001_PREGUNTAS_MODEL || 'sonnet';
const CLAUDE = process.env.CLAUDE_BIN || '/usr/bin/claude';
const CREDENCIALES = process.env.CREDENTIALS_DIRECTORY || '';

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const LLAVE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!SUPABASE_URL || !LLAVE) {
  console.error(JSON.stringify({ evento: 'vigia_preguntas_sin_configuracion' }));
  process.exit(78);
}

function registrar(evento, datos = {}) {
  console.log(JSON.stringify({ evento, ...datos, a: new Date().toISOString() }));
}

async function rest(ruta, { method = 'GET', body, prefer } = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, {
    method,
    headers: { apikey: LLAVE, Authorization: `Bearer ${LLAVE}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`supabase ${method} ${ruta.split('?')[0]} ${r.status}`);
  // Sin «Prefer: return=representation» PostgREST responde 201 o 204 sin cuerpo.
  const cuerpo = await r.text();
  return cuerpo ? JSON.parse(cuerpo) : null;
}

async function tomarPendiente() {
  const [siguiente] = await rest(`${PREGUNTAS_TABLE}?status=eq.pendiente&order=requested_at.asc&limit=1&select=id`);
  if (!siguiente) return null;
  const tomadas = await rest(`${PREGUNTAS_TABLE}?id=eq.${siguiente.id}&status=eq.pendiente`, {
    method: 'PATCH', prefer: 'return=representation',
    body: { status: 'leyendo', started_at: new Date().toISOString(), model: MODELO },
  });
  return tomadas?.[0] || null;
}

async function conocimientoVigente() {
  return rest(`${CONOCIMIENTO_TABLE}?active=eq.true&order=uses.desc,updated_at.desc&limit=80&select=topic,note`);
}

async function preguntaAnterior(id) {
  if (!id) return null;
  const [fila] = await rest(`${PREGUNTAS_TABLE}?id=eq.${id}&select=question,answer`);
  return fila || null;
}

function correrClaude(mensaje, dir) {
  const salidaTabla = join(dir, 'tabla.json');
  const mcp = {
    mcpServers: {
      datos: {
        command: process.execPath,
        args: ['--no-warnings', join(AQUI, 'mcp-datos.mjs')],
        env: {
          AVANCYS_CONEXION: join(CREDENCIALES, 'avancys'),
          SECURITYOPS_KEY_FILE: join(CREDENCIALES, 'securityops'),
          CRM_URL: SUPABASE_URL,
          CRM_LLAVE: LLAVE,
          VIGIA_SALIDA_TABLA: salidaTabla,
        },
      },
    },
  };
  const rutaMcp = join(dir, 'mcp.json');
  writeFileSync(rutaMcp, JSON.stringify(mcp), { mode: 0o600 });
  const args = [
    '-p', '--model', MODELO, '--output-format', 'json',
    '--json-schema', JSON.stringify(ESQUEMA_RESPUESTA),
    '--tools', '', '--mcp-config', rutaMcp, '--strict-mcp-config', '--allowedTools', 'mcp__datos',
    '--no-session-persistence', '--system-prompt', POLITICA,
  ];
  const entorno = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' };
  return new Promise(resolve => {
    const hijo = spawn(CLAUDE, args, { cwd: dir, env: entorno, stdio: ['pipe', 'pipe', 'pipe'] });
    let salida = '';
    let errores = '';
    let vencido = false;
    const reloj = setTimeout(() => { vencido = true; hijo.kill('SIGTERM'); setTimeout(() => hijo.kill('SIGKILL'), 5_000); }, TOPE_TURNO_MS);
    hijo.stdout.on('data', d => { if (salida.length < 4_000_000) salida += d; });
    hijo.stderr.on('data', d => { if (errores.length < 20_000) errores += d; });
    hijo.on('close', codigoSalida => {
      clearTimeout(reloj);
      const tabla = existsSync(salidaTabla) ? JSON.parse(readFileSync(salidaTabla, 'utf8')) : null;
      resolve({ codigoSalida, salida, errores, vencido, tabla });
    });
    hijo.stdin.end(mensaje);
  });
}

async function aprender(notas, preguntaId) {
  for (const nota of notas) {
    const clave = claveTema(nota.tema);
    if (!clave) continue;
    const [existente] = await rest(`${CONOCIMIENTO_TABLE}?topic_key=eq.${encodeURIComponent(clave)}&select=id,uses`);
    if (existente) {
      await rest(`${CONOCIMIENTO_TABLE}?id=eq.${existente.id}`, {
        method: 'PATCH', body: { topic: nota.tema, note: nota.nota, uses: existente.uses + 1, active: true, learned_from: preguntaId, updated_at: new Date().toISOString() },
      });
    } else {
      await rest(CONOCIMIENTO_TABLE, { method: 'POST', body: { topic_key: clave, topic: nota.tema, note: nota.nota, learned_from: preguntaId } });
    }
  }
}

async function contestar(fila) {
  const inicio = Date.now();
  const dir = mkdtempSync(join(tmpdir(), 'vigia-'));
  try {
    const [conocimiento, anterior] = await Promise.all([conocimientoVigente(), preguntaAnterior(fila.parent_id)]);
    const mensaje = construirMensaje({ pregunta: fila.question, conocimiento, anterior });
    const corrida = await correrClaude(mensaje, dir);
    let sobre = null;
    try { sobre = JSON.parse(corrida.salida); } catch { sobre = null; }
    if (parar && !sobre?.structured_output) {
      // systemd detuvo el servicio (reinicio o release nueva) a mitad de la respuesta: la pregunta vuelve a la cola y
      // el trabajador que arranca la retoma; el directivo no ve una falla que no fue suya.
      await rest(`${PREGUNTAS_TABLE}?id=eq.${fila.id}`, { method: 'PATCH', body: { status: 'pendiente', started_at: null } });
      registrar('vigia_pregunta_devuelta', { id: fila.id });
      return;
    }
    if (corrida.vencido || corrida.codigoSalida !== 0 || !sobre || sobre.is_error || !sobre.structured_output) {
      const codigo = clasificarFalla({ ...corrida, salida: sobre?.result || corrida.salida.slice(0, 2000) });
      await rest(`${PREGUNTAS_TABLE}?id=eq.${fila.id}`, { method: 'PATCH', body: { status: 'fallida', failure_code: codigo, finished_at: new Date().toISOString(), duration_ms: Date.now() - inicio } });
      registrar('vigia_pregunta_fallida', { id: fila.id, codigo, salida: corrida.codigoSalida, ms: Date.now() - inicio });
      return;
    }
    const respuesta = validarRespuesta(sobre.structured_output);
    const answer = { ...respuesta, cifras: unaSolaAtencion(respuesta.cifras), corte: new Date().toISOString() };
    delete answer.aprendizaje;
    await rest(`${PREGUNTAS_TABLE}?id=eq.${fila.id}`, {
      method: 'PATCH',
      body: {
        status: 'respondida', answer, answer_table: corrida.tabla, finished_at: new Date().toISOString(),
        duration_ms: Date.now() - inicio, num_turns: Number(sobre.num_turns) || null,
      },
    });
    await aprender(respuesta.aprendizaje, fila.id).catch(error => registrar('vigia_aprendizaje_fallido', { id: fila.id, error: String(error?.message || error) }));
    registrar('vigia_pregunta_respondida', { id: fila.id, ms: Date.now() - inicio, turnos: sobre.num_turns, tabla: Boolean(corrida.tabla), notas: respuesta.aprendizaje.length });
  } catch (error) {
    const codigo = /VIGIA_/.test(String(error?.message)) ? String(error.message) : 'VIGIA_FALLO';
    await rest(`${PREGUNTAS_TABLE}?id=eq.${fila.id}`, { method: 'PATCH', body: { status: 'fallida', failure_code: codigo, finished_at: new Date().toISOString(), duration_ms: Date.now() - inicio } }).catch(() => {});
    registrar('vigia_pregunta_fallida', { id: fila.id, codigo, error: String(error?.message || error).slice(0, 300) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function liberarAbandonadas() {
  const limite = new Date(Date.now() - PREGUNTA_ABANDONADA_MS).toISOString();
  await rest(`${PREGUNTAS_TABLE}?status=eq.leyendo&started_at=lt.${limite}`, { method: 'PATCH', body: { status: 'fallida', failure_code: 'VIGIA_ABANDONADA', finished_at: new Date().toISOString() } });
}

let parar = false;
process.on('SIGTERM', () => { parar = true; });
process.on('SIGINT', () => { parar = true; });

registrar('vigia_preguntas_arranca', { modelo: MODELO, espera_ms: ESPERA_MS });
await liberarAbandonadas().catch(error => registrar('vigia_preguntas_error', { error: String(error?.message || error) }));
while (!parar) {
  try {
    const fila = await tomarPendiente();
    if (fila) { await contestar(fila); continue; }
  } catch (error) {
    registrar('vigia_preguntas_error', { error: String(error?.message || error).slice(0, 300) });
  }
  await new Promise(resolve => setTimeout(resolve, ESPERA_MS));
}
registrar('vigia_preguntas_termina');
