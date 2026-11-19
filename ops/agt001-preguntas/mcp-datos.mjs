#!/usr/bin/env node
// AGT-001 «Pregúntele a Vig-IA»: servidor MCP (stdio) con las herramientas de SOLO LECTURA con que Vig-IA contesta
// las preguntas de los directivos. Lo arranca `claude -p` por cada pregunta y muere con ella.
//
// Las tres fuentes son de solo lectura por diseño: Avancys con el usuario de lectura, SecurityOps con la cuenta de
// servicio `vigia-operaciones-lectura` (roles/datastore.viewer) y el CRM sólo con GET sobre una lista de tablas. Lo que
// se carga va a una base SQLite en memoria para que el modelo cuente, cruce y promedie con SQL en vez de a ojo.
//
// Decisiones de Juan (2026-11-19): los directivos ven datos completos, nombres, cédulas y salarios incluidos.
import { createSign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';

const MAX_FILAS_CARGA = 60_000;
const MAX_FILAS_SQL = 300;
const MAX_FILAS_TABLA = 2_000;
const TIEMPO_RED_MS = 90_000;

// Tablas del CRM que Vig-IA puede leer. Ninguna guarda claves ni tokens.
export const TABLAS_CRM = Object.freeze([
  'psi_sales_clients', 'psi_sales_opportunities', 'psi_sales_interactions', 'psi_sales_goals',
  'psi_public_tenders', 'psi_securityops_puestos', 'psi_vigilance_companies', 'psi_vigilance_participations',
  'psi_company_experience', 'psi_tender_lessons', 'psi_siio_cartera_fotos',
  'siio_financial_metrics', 'siio_operations_metrics', 'siio_strategic_opportunities', 'siio_followups',
]);

const db = new DatabaseSync(':memory:');
const cargas = [];

// ---------- Avancys (Odoo 14, JSON-RPC) ----------
let odooUid = null;
function conexionAvancys() {
  const ruta = process.env.AVANCYS_CONEXION;
  if (!ruta) throw new Error('Avancys no está configurado para Vig-IA.');
  return JSON.parse(readFileSync(ruta, 'utf8'));
}
async function rpc(servicio, metodo, args) {
  const c = conexionAvancys();
  const r = await fetch(`${c.url.replace(/\/$/, '')}/jsonrpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(TIEMPO_RED_MS),
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service: servicio, method: metodo, args }, id: 1 }),
  });
  const cuerpo = await r.json();
  if (cuerpo.error) throw new Error(`Avancys: ${cuerpo.error?.data?.message || cuerpo.error.message}`.slice(0, 400));
  return cuerpo.result;
}
async function odoo(modelo, metodo, posicional = [], nombrado = {}) {
  const c = conexionAvancys();
  if (odooUid === null) odooUid = await rpc('common', 'authenticate', [c.database, c.username, c.clave, {}]);
  if (!odooUid) throw new Error('Avancys rechazó el usuario de lectura.');
  // Solo métodos de lectura: aunque el usuario ya es de solo lectura, el servidor no deja pedir otra cosa.
  if (!['search_read', 'read_group', 'search_count', 'fields_get'].includes(metodo)) throw new Error('Método no permitido.');
  return rpc('object', 'execute_kw', [c.database, odooUid, c.clave, modelo, metodo, posicional, nombrado]);
}

// ---------- SecurityOps (Firestore) ----------
let tokenFs = null;
function credencialFs() {
  const ruta = process.env.SECURITYOPS_KEY_FILE;
  if (!ruta) throw new Error('SecurityOps no está configurado para Vig-IA.');
  return JSON.parse(readFileSync(ruta, 'utf8'));
}
const b64url = valor => Buffer.from(valor).toString('base64url');
async function accesoFs() {
  if (tokenFs && tokenFs.vence > Date.now() + 60_000) return tokenFs.valor;
  const cred = credencialFs();
  const ahora = Math.floor(Date.now() / 1000);
  const cabeza = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const carga = b64url(JSON.stringify({ iss: cred.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600 }));
  const firma = createSign('RSA-SHA256').update(`${cabeza}.${carga}`).sign(cred.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(TIEMPO_RED_MS),
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${cabeza}.${carga}.${firma}` }),
  });
  if (!r.ok) throw new Error(`SecurityOps no entregó acceso (${r.status}).`);
  const cuerpo = await r.json();
  tokenFs = { valor: cuerpo.access_token, vence: Date.now() + 3_300_000 };
  return tokenFs.valor;
}
function baseFs() {
  return `https://firestore.googleapis.com/v1/projects/${credencialFs().project_id}/databases/(default)/documents`;
}
function valorFs(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('referenceValue' in v) return v.referenceValue.split('/').pop();
  if ('geoPointValue' in v) return v.geoPointValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(valorFs);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, valorFs(x)]));
  return null;
}

// ---------- CRM (Supabase, solo GET) ----------
async function crmGet(ruta) {
  const url = process.env.CRM_URL;
  const llave = process.env.CRM_LLAVE;
  if (!url || !llave) throw new Error('El CRM no está configurado para Vig-IA.');
  const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${ruta}`, {
    headers: { apikey: llave, Authorization: `Bearer ${llave}`, Accept: 'application/json' }, signal: AbortSignal.timeout(TIEMPO_RED_MS),
  });
  if (!r.ok) throw new Error(`CRM ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

// ---------- Base de trabajo (SQLite en memoria) ----------
export function nombreTabla(nombre) {
  const limpio = String(nombre || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+/, '').slice(0, 60);
  if (!/^[a-z][a-z0-9_]*$/.test(limpio)) throw new Error('Nombre de tabla no válido: use letras, números y _.');
  return limpio;
}
function columna(nombre) {
  return `"${String(nombre).replace(/"/g, '')}"`;
}
function aSqlite(valor) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor === 'boolean') return valor ? 1 : 0;
  if (typeof valor === 'number' || typeof valor === 'string') return valor;
  return JSON.stringify(valor);
}
export function guardarFilas(nombre, filas) {
  const tabla = nombreTabla(nombre);
  const columnas = [...new Set(filas.flatMap(fila => Object.keys(fila)))];
  if (!columnas.length) columnas.push('vacio');
  db.exec(`DROP TABLE IF EXISTS ${tabla}`);
  db.exec(`CREATE TABLE ${tabla} (${columnas.map(columna).join(', ')})`);
  const insertar = db.prepare(`INSERT INTO ${tabla} (${columnas.map(columna).join(', ')}) VALUES (${columnas.map(() => '?').join(', ')})`);
  db.exec('BEGIN');
  for (const fila of filas) insertar.run(...columnas.map(c => aSqlite(fila[c])));
  db.exec('COMMIT');
  return { tabla, filas: filas.length, columnas };
}
// Odoo devuelve `false` en los campos vacíos y [id, nombre] en las relaciones: se aplana a columnas legibles.
export function aplanarOdoo(registro, tipos) {
  const fila = {};
  for (const [campo, valor] of Object.entries(registro)) {
    const tipo = tipos[campo]?.type;
    if (tipo === 'many2one') {
      fila[campo] = Array.isArray(valor) ? valor[1] : null;
      fila[`${campo}_id`] = Array.isArray(valor) ? valor[0] : null;
    } else if (tipo === 'boolean') {
      fila[campo] = valor === true;
    } else {
      fila[campo] = valor === false ? null : valor;
    }
  }
  return fila;
}
export function sqlPermitido(consulta) {
  const texto = String(consulta || '').trim().replace(/;+\s*$/, '');
  if (!/^(select|with)\b/i.test(texto)) return 'Solo se permiten consultas SELECT o WITH.';
  if (texto.includes(';')) return 'Una sola consulta por vez.';
  if (/\b(attach|detach|pragma|vacuum|load_extension)\b/i.test(texto)) return 'Esa instrucción no está permitida.';
  return null;
}
function correrSql(consulta, tope) {
  const error = sqlPermitido(consulta);
  if (error) throw new Error(error);
  const filas = db.prepare(String(consulta).trim().replace(/;+\s*$/, '')).all();
  return { total: filas.length, filas: filas.slice(0, tope), recortado: filas.length > tope };
}

// ---------- Herramientas ----------
const HERRAMIENTAS = [
  {
    name: 'avancys_buscar_modelos',
    description: 'Busca modelos de Avancys (Odoo 14) cuyo nombre técnico o descripción contenga el texto. Úselo para descubrir dónde vive un dato (p. ej. "acredit", "contract", "payslip", "employee").',
    inputSchema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
    run: async ({ texto }) => odoo('ir.model', 'search_read', [['|', ['model', 'ilike', texto], ['name', 'ilike', texto]]], { fields: ['model', 'name'], limit: 60 }),
  },
  {
    name: 'avancys_campos',
    description: 'Lista los campos de un modelo de Avancys con su tipo y descripción. Puede filtrar por texto.',
    inputSchema: { type: 'object', properties: { modelo: { type: 'string' }, texto: { type: 'string' } }, required: ['modelo'] },
    run: async ({ modelo, texto }) => {
      const campos = await odoo(modelo, 'fields_get', [], { attributes: ['string', 'type', 'relation', 'selection'] });
      const filtro = String(texto || '').toLowerCase();
      return Object.entries(campos)
        .filter(([k, v]) => !filtro || k.toLowerCase().includes(filtro) || String(v.string).toLowerCase().includes(filtro))
        .map(([k, v]) => ({ campo: k, tipo: v.type, descripcion: v.string, relacion: v.relation, opciones: v.selection }));
    },
  },
  {
    name: 'avancys_contar',
    description: 'Cuenta registros de un modelo de Avancys con un dominio de Odoo y, si se pide, los agrupa por campos (read_group). Ej.: modelo hr.contract, dominio [["state","=","open"]], agrupar_por ["job_id"]. Puede sumar campos numéricos con sumar ["wage"].',
    inputSchema: {
      type: 'object',
      properties: { modelo: { type: 'string' }, dominio: { type: 'array' }, agrupar_por: { type: 'array', items: { type: 'string' } }, sumar: { type: 'array', items: { type: 'string' } } },
      required: ['modelo'],
    },
    run: async ({ modelo, dominio = [], agrupar_por = [], sumar = [] }) => {
      if (!agrupar_por.length) return { total: await odoo(modelo, 'search_count', [dominio], { context: { active_test: false } }) };
      const grupos = await odoo(modelo, 'read_group', [dominio, [...agrupar_por, ...sumar.map(c => `${c}:sum`)], agrupar_por], { lazy: false, context: { active_test: false } });
      return grupos.map(g => Object.fromEntries(Object.entries(g).filter(([k]) => k !== '__domain').map(([k, v]) => [k === '__count' ? 'cantidad' : k, Array.isArray(v) && v.length === 2 ? v[1] : v])));
    },
  },
  {
    name: 'avancys_cargar',
    description: `Lee registros de un modelo de Avancys y los guarda como tabla en la base de trabajo para consultarlos con sql. Las relaciones quedan en dos columnas: <campo> (nombre) y <campo>_id. Fechas en UTC. Máximo ${MAX_FILAS_CARGA} filas: filtre con el dominio. Incluye archivados solo si incluir_archivados es true.`,
    inputSchema: {
      type: 'object',
      properties: { modelo: { type: 'string' }, dominio: { type: 'array' }, campos: { type: 'array', items: { type: 'string' } }, tabla: { type: 'string' }, incluir_archivados: { type: 'boolean' } },
      required: ['modelo', 'campos', 'tabla'],
    },
    run: async ({ modelo, dominio = [], campos, tabla, incluir_archivados = false }) => {
      const tipos = await odoo(modelo, 'fields_get', [campos], { attributes: ['type'] });
      const contexto = incluir_archivados ? { active_test: false } : {};
      const total = await odoo(modelo, 'search_count', [dominio], { context: contexto });
      if (total > MAX_FILAS_CARGA) throw new Error(`El dominio trae ${total} registros; el máximo es ${MAX_FILAS_CARGA}. Filtre más.`);
      const filas = [];
      for (let desde = 0; desde < total; desde += 5000) {
        const lote = await odoo(modelo, 'search_read', [dominio], { fields: campos, offset: desde, limit: 5000, order: 'id', context: contexto });
        filas.push(...lote.map(r => aplanarOdoo(r, tipos)));
      }
      const resultado = guardarFilas(tabla, filas);
      cargas.push({ fuente: 'Avancys', detalle: modelo, filas: filas.length, a: new Date().toISOString() });
      return resultado;
    },
  },
  {
    name: 'securityops_colecciones',
    description: 'Lista las colecciones de SecurityOps (Firestore) y muestra un documento de ejemplo de la que se pida, para saber qué campos tiene.',
    inputSchema: { type: 'object', properties: { ejemplo_de: { type: 'string' } } },
    run: async ({ ejemplo_de }) => {
      const acceso = await accesoFs();
      const r = await fetch(`${baseFs()}:listCollectionIds`, { method: 'POST', headers: { Authorization: `Bearer ${acceso}` }, body: JSON.stringify({ pageSize: 200 }), signal: AbortSignal.timeout(TIEMPO_RED_MS) });
      const colecciones = (await r.json()).collectionIds || [];
      if (!ejemplo_de) return { colecciones };
      const d = await (await fetch(`${baseFs()}/${encodeURIComponent(ejemplo_de)}?pageSize=1`, { headers: { Authorization: `Bearer ${acceso}` }, signal: AbortSignal.timeout(TIEMPO_RED_MS) })).json();
      const doc = d.documents?.[0];
      return { colecciones, ejemplo: doc ? Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, valorFs(v)])) : null };
    },
  },
  {
    name: 'securityops_cargar',
    description: `Lee una colección de SecurityOps y la guarda como tabla en la base de trabajo. Indique los campos de primer nivel que necesita (los mapas quedan como JSON; use json_extract en sql). Máximo ${MAX_FILAS_CARGA} documentos.`,
    inputSchema: { type: 'object', properties: { coleccion: { type: 'string' }, campos: { type: 'array', items: { type: 'string' } }, tabla: { type: 'string' } }, required: ['coleccion', 'campos', 'tabla'] },
    run: async ({ coleccion, campos, tabla }) => {
      const acceso = await accesoFs();
      const filas = [];
      let pagina = null;
      do {
        const params = new URLSearchParams({ pageSize: '300' });
        for (const campo of campos) params.append('mask.fieldPaths', campo);
        if (pagina) params.set('pageToken', pagina);
        const r = await fetch(`${baseFs()}/${encodeURIComponent(coleccion)}?${params}`, { headers: { Authorization: `Bearer ${acceso}` }, signal: AbortSignal.timeout(TIEMPO_RED_MS) });
        if (!r.ok) throw new Error(`SecurityOps ${r.status}`);
        const cuerpo = await r.json();
        for (const doc of cuerpo.documents || []) {
          filas.push({ doc_id: doc.name.split('/').pop(), ...Object.fromEntries(campos.map(c => [c, valorFs(doc.fields?.[c])])) });
        }
        pagina = cuerpo.nextPageToken;
        if (filas.length > MAX_FILAS_CARGA) throw new Error(`La colección pasa de ${MAX_FILAS_CARGA} documentos.`);
      } while (pagina);
      const resultado = guardarFilas(tabla, filas);
      cargas.push({ fuente: 'SecurityOps', detalle: coleccion, filas: filas.length, a: new Date().toISOString() });
      return resultado;
    },
  },
  {
    name: 'crm_cargar',
    description: `Lee una tabla del CRM y la guarda en la base de trabajo. Tablas permitidas: ${TABLAS_CRM.join(', ')}. columnas es la lista de PostgREST (por defecto *); filtro es opcional en sintaxis PostgREST (p. ej. "status=eq.won").`,
    inputSchema: { type: 'object', properties: { tabla_crm: { type: 'string', enum: TABLAS_CRM }, columnas: { type: 'string' }, filtro: { type: 'string' }, tabla: { type: 'string' } }, required: ['tabla_crm', 'tabla'] },
    run: async ({ tabla_crm, columnas = '*', filtro = '', tabla }) => {
      if (!TABLAS_CRM.includes(tabla_crm)) throw new Error('Tabla del CRM no permitida.');
      const filas = [];
      for (let desde = 0; ; desde += 1000) {
        const lote = await crmGet(`${tabla_crm}?select=${encodeURIComponent(columnas)}${filtro ? `&${filtro}` : ''}&offset=${desde}&limit=1000`);
        filas.push(...lote);
        if (lote.length < 1000 || filas.length > MAX_FILAS_CARGA) break;
      }
      const resultado = guardarFilas(tabla, filas);
      cargas.push({ fuente: 'CRM', detalle: tabla_crm, filas: filas.length, a: new Date().toISOString() });
      return resultado;
    },
  },
  {
    name: 'sql',
    description: `Consulta SQL (SQLite, solo SELECT o WITH) sobre las tablas que usted cargó. Devuelve hasta ${MAX_FILAS_SQL} filas y el total. Use date('now') con cuidado: Colombia es UTC-5.`,
    inputSchema: { type: 'object', properties: { consulta: { type: 'string' } }, required: ['consulta'] },
    run: async ({ consulta }) => correrSql(consulta, MAX_FILAS_SQL),
  },
  {
    name: 'preparar_tabla',
    description: `Deja lista la tabla que verá el directivo debajo de la respuesta (con nombres, cédulas, etc.), a partir de una consulta SQL. Hasta ${MAX_FILAS_TABLA} filas; el directivo puede descargarla para Excel. Úsela una sola vez, con las columnas en español y en el orden en que se deben leer.`,
    inputSchema: { type: 'object', properties: { consulta: { type: 'string' }, titulo: { type: 'string' } }, required: ['consulta', 'titulo'] },
    run: async ({ consulta, titulo }) => {
      const { filas, total, recortado } = correrSql(consulta, MAX_FILAS_TABLA);
      const columnas = filas.length ? Object.keys(filas[0]) : [];
      if (process.env.VIGIA_SALIDA_TABLA) {
        writeFileSync(process.env.VIGIA_SALIDA_TABLA, JSON.stringify({ titulo: String(titulo).slice(0, 200), columnas, filas: filas.map(f => columnas.map(c => f[c])), total, recortado, cargas }));
      }
      return { listo: true, filas: filas.length, total, columnas };
    },
  },
];

// ---------- Protocolo MCP (JSON-RPC por stdio) ----------
function responder(id, result, error) {
  process.stdout.write(`${JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result })}\n`);
}

async function atender(mensaje) {
  const { id, method, params } = mensaje;
  if (method === 'initialize') {
    return responder(id, { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'vigia-datos', version: '1.0.0' } });
  }
  if (method === 'tools/list') {
    return responder(id, { tools: HERRAMIENTAS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  }
  if (method === 'tools/call') {
    const herramienta = HERRAMIENTAS.find(h => h.name === params?.name);
    if (!herramienta) return responder(id, null, { code: -32602, message: 'Herramienta desconocida.' });
    try {
      const resultado = await herramienta.run(params.arguments || {});
      const texto = JSON.stringify(resultado);
      return responder(id, { content: [{ type: 'text', text: texto.length > 120_000 ? `${texto.slice(0, 120_000)}… (recortado: use sql para filtrar)` : texto }] });
    } catch (error) {
      return responder(id, { content: [{ type: 'text', text: `Error: ${error?.message || error}` }], isError: true });
    }
  }
  if (id !== undefined && id !== null) responder(id, {});
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const lector = createInterface({ input: process.stdin });
  lector.on('line', linea => {
    if (!linea.trim()) return;
    let mensaje;
    try { mensaje = JSON.parse(linea); } catch { return; }
    atender(mensaje).catch(error => responder(mensaje.id, null, { code: -32603, message: String(error?.message || error) }));
  });
}
