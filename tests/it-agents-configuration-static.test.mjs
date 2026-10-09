// IT → Agentes (rediseño): rutas nuevas protegidas como Usuarios y permisos, firma desde el perfil autenticado,
// y pantallas (detalle de agente, propuestas, historial, perfiles) con los textos del boceto aprobado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');
const serverSource = read('../server/index.js');
const apiSource = read('../api/[...path].js');
const view = read('../src/platform/AgentsView.tsx');
const detail = read('../src/platform/AgentDetail.tsx');
const configViews = read('../src/platform/ConfigurationViews.tsx');
const loader = read('../src/platform/usePlatformData.ts');
const presentation = read('../src/platform/agentsPresentation.ts');

const NEW_ROUTES = [
  'GET /api/platform/agent-configuration',
  'GET /api/platform/ai-usage-profiles',
  'POST /api/platform/agent-configuration/proposals',
  'POST /api/platform/agent-configuration/versions/:id/approve',
  'POST /api/platform/agent-configuration/versions/:id/reject',
  'POST /api/platform/agent-configuration/versions/:id/reactivate',
  'POST /api/platform/ai-usage-profiles',
  'POST /api/platform/ai-usage-profiles/:id/archive',
  'POST /api/platform/ai-usage-profiles/:id/reactivate',
];

test('rutas nuevas en HTTP_ACTION_MATRIX con la protección de Usuarios y permisos; espejo idéntico', () => {
  assert.equal(serverSource, apiSource);
  for (const route of NEW_ROUTES) {
    assert.ok(serverSource.includes(`'${route}': ['users', ACTIONS.USERS_MANAGE],`), route);
  }
  assert.match(serverSource, /async function requirePlatformConfigurationAdmin\(req\) \{\n  const \{ profile: currentProfile \} = await getAuthContext\(req\);\n  requireModuleAction\(currentProfile, 'users'\);\n  requireAction\(currentProfile, ACTIONS\.USERS_MANAGE, \{\}\);\n  return currentProfile;\n\}/);
  const block = serverSource.slice(serverSource.indexOf("app.get('/api/platform/agent-configuration'"), serverSource.indexOf("app.all('/api/platform/ai-usage-profiles/:id/reactivate'"));
  const handlers = block.match(/app\.(get|post)\('[^']+', async \(req, res\) => \{\n  try \{\n    (const currentProfile = )?await requirePlatformConfigurationAdmin\(req\);/g) || [];
  assert.equal(handlers.length, 7, 'cada ruta empieza por la protección (incluida la lectura de perfiles de uso para Usuarios y permisos)');
  assert.doesNotMatch(block, /req\.body\??\.(proposed_by|approved_by|rejected_by|activated_by|created_by|archived_by|reactivated_by)/, 'quien firma nunca sale del cuerpo');
  assert.equal((block.match(/actorNameFromProfile\(currentProfile\)/g) || []).length, 5, 'propuesta, acciones de versión, crear, archivar y reactivar firman con el perfil autenticado');
  assert.doesNotMatch(block, /error\.message \|\| String\(error\)/, 'sin mensajes crudos de la base');
});

test('detalle de agente: ruta #/agents/<ID>, pestañas y formulario de funciones, modelos y cupos', () => {
  assert.ok(view.includes('if (agentId) return <AgentDetail'));
  for (const [id, label] of [['profile', 'Ficha'], ['functions', 'Funciones, modelos y cupos'], ['usage', 'Uso de IA'], ['history', 'Historial de versiones']]) {
    assert.ok(presentation.includes(`{ id: '${id}', label: '${label}' }`), label);
  }
  for (const text of ['← Agentes', 'Ficha en construcción (Fase 1)', 'Dueño: {AGENT_OWNER_PENDING}', 'Configuración vigente', 'Modelo', 'Plan B si el modelo falla', 'Cupo total del equipo', '(hora Bogotá)', 'Cupo por persona según su perfil', 'Sin cupo propio', 'techo de seguridad', '+ Agregar perfil', 'Excepciones temporales', '+ Agregar excepción (siempre con fecha de vencimiento)', 'type="date" required min={config.today}', 'Los cambios no se aplican al guardar', 'Motivo del cambio', 'Proponer cambio', '/api/platform/agent-configuration/proposals', 'valores actuales del código', 'config.no_functions_text']) {
    assert.ok(detail.includes(text), text);
  }
  assert.match(detail, /config\.models\.map\(option => <option key=\{option\.id\} value=\{option\.id\}>\{option\.label\}<\/option>\)/, 'el modelo se elige de la lista cerrada');
  assert.match(detail, /config\.people\.map\(person =>/, 'la persona sale de los usuarios del SIIO');
  assert.doesNotMatch(detail, /\{form\.capability\}<|>\{item\.capability\}/, 'no muestra IDs técnicos de capacidades');
});

test('propuestas, historial y perfiles: textos, acciones con confirmación y aviso de asignación', () => {
  for (const text of ['Propuestas por aprobar', 'Pendiente de aprobación', 'Qué cambia', 'Todo lo demás', 'Valores actuales del código', 'Uso real últimos 7 días', 'Veces que se agotó el cupo', 'Límite de la suscripción', 'Rechazar', 'Motivo del rechazo', 'Aprobar y activar', 'Historial de versiones', 'Volver a esta versión', "version.status === 'aprobada'", 'Perfiles de uso de IA', '+ Crear perfil', 'Archivar', 'Qué recibe cada perfil en cada agente', 'Cómo se decide el cupo de una persona', 'PROFILE_ASSIGNMENT_NOTICE']) {
    assert.ok(configViews.includes(text), text);
  }
  assert.ok(presentation.includes("PROFILE_ASSIGNMENT_NOTICE = 'Los perfiles se crean aquí; en Usuarios y permisos se elige uno por persona.'"));
  assert.match(loader, /export async function runPlatformAction\(url: string, body: unknown, confirmText: string\): Promise<boolean> \{\n  if \(!window\.confirm\(confirmText\)\) return false;/, 'toda acción pide confirmación');
  const actionCalls = `${detail}\n${configViews}`.match(/runPlatformAction\(/g) || [];
  assert.equal(actionCalls.length, 6, 'proponer, aprobar/rechazar, volver, crear, archivar y reactivar pasan por la confirmación');
  assert.doesNotMatch(`${detail}\n${configViews}`, /method: 'POST'/, 'ninguna acción se salta runPlatformAction');
  for (const label of ["vigente: 'Vigente'", "aprobada: 'Aprobada'", "rechazada: 'Rechazada'", "pendiente: 'Pendiente de aprobación'"]) assert.ok(presentation.includes(label), label);
  assert.ok(loader.includes("api<AgentConfigurationPayload>('/api/platform/agent-configuration')"));
});

test('perfiles archivados: botón Reactivar con confirmación, archivar ya no es definitivo y nota de perfiles generales', () => {
  const reactivateBlock = serverSource.slice(serverSource.indexOf("app.post('/api/platform/ai-usage-profiles/:id/reactivate'"), serverSource.indexOf("app.all('/api/platform/ai-usage-profiles/:id/reactivate'"));
  assert.match(reactivateBlock, /if \(!hasPlatformAdminConnection\(\)\) throw platformAdminUnavailableError\(\);/, 'exige administración conectada');
  assert.match(reactivateBlock, /assertProfileReactivation\(await readAiUsageProfile\(profileId\)\);/, 'exige perfil existente y archivado');
  assert.match(reactivateBlock, /reactivateAiUsageProfile\(\{ profileId, actor: actorNameFromProfile\(currentProfile\) \}\)/);
  for (const text of [
    'Reactivar</button>',
    '`/api/platform/ai-usage-profiles/${encodeURIComponent(profileId)}/reactivate`',
    '`¿Reactivar el perfil "${displayName}"? Volverá a estar disponible para nuevas configuraciones.`',
    '`Perfil "${displayName}" reactivado.`',
    '`¿Archivar el perfil "${displayName}"? Ya no se podrá usar en nuevas configuraciones mientras esté archivado; puede reactivarlo después.`',
    'disabled={busy || !config.admin_connected} onClick={() => reactivateProfile(profile.profile_id, profile.display_name)}',
    '{PROFILES_ACROSS_AGENTS_NOTE}',
  ]) assert.ok(configViews.includes(text), text);
  assert.doesNotMatch(configViews, /Ya no se podrá usar en nuevas configuraciones\.`/, 'archivar ya no se presenta como definitivo');
  assert.ok(presentation.includes('Los perfiles son generales para todos los agentes. Hoy sólo Vig-IA Comercial usa IA a través de la plataforma; los demás agentes aparecerán aquí cuando se conecten. "Sólo cupo del equipo" significa que el perfil aún no tiene un cupo propio: se le da proponiendo una nueva versión del agente.'));
});
