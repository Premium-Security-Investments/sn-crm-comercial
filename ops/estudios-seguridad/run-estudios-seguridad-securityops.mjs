#!/usr/bin/env node
// Estudios de Seguridad — trae de SecurityOps el directorio de puestos y los antecedentes de cada estudio vinculado
// (migración 201; Juan, 2026-11-10: "podemos construir ya").
//
// Corre cada 5 minutos, con los borradores, y sin pedidos casi no hace nada: el directorio se refresca una vez al día y un estudio sólo se
// lee si se acaba de vincular, si alguien pidió "Actualizar" o si sus datos tienen más de un día. Lee SecurityOps con la
// cuenta de servicio vigia-operaciones-lectura (roles/datastore.viewer: un commit responde 403), que vive en
// /root/.vigia-firestore y no sale de este servidor. La lógica está en verticales/estudios-seguridad/securityops.js.
import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { firestoreReader, runSecurityOpsSync } from '../../verticales/estudios-seguridad/securityops.js';

const log = event => console.log(JSON.stringify(event));
const env = name => String(process.env[name] || '').trim();
const supabaseUrl = env('SUPABASE_URL') || env('NEXT_PUBLIC_SUPABASE_URL');
const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
const keyFile = env('ESTUDIOS_SECURITYOPS_KEY_FILE');
const SCOPE = 'https://www.googleapis.com/auth/datastore';

const b64 = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

// Token OAuth de la cuenta de servicio (JWT RS256), como /root/.vigia-firestore/leer.py. Se reusa mientras viva.
function tokenProvider(key) {
  let cached = null;
  return async () => {
    if (cached && cached.expires > Date.now() + 60_000) return cached.token;
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: key.client_email, scope: SCOPE, aud: key.token_uri, iat: now, exp: now + 3600 })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
    const response = await fetch(key.token_uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    });
    if (!response.ok) throw Object.assign(new Error(`token_${response.status}`), { code: 'securityops_token' });
    const body = await response.json();
    cached = { token: body.access_token, expires: Date.now() + Number(body.expires_in || 3600) * 1000 };
    return cached.token;
  };
}

if (!supabaseUrl || !serviceRoleKey || !keyFile) {
  log({ event: 'estudios_securityops_config_invalida' });
  process.exitCode = 1;
} else {
  try {
    const key = JSON.parse(await readFile(keyFile, 'utf8'));
    if (key.type !== 'service_account' || !key.private_key || !key.client_email || !key.token_uri) throw Object.assign(new Error('llave'), { code: 'securityops_llave' });
    const database = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const reader = firestoreReader({ getToken: tokenProvider(key), project: key.project_id });
    const result = await runSecurityOpsSync(database, reader, log);
    if (result.directorio || result.estudios || result.fallidos) log({ event: 'estudios_securityops_corrida', ...result });
  } catch (error) {
    log({ event: 'estudios_securityops_corrida_fallida', code: error?.code || 'desconocido' });
    process.exitCode = 1;
  }
}
