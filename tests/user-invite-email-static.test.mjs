import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const file of [server, api]) {
  assert(!file.includes('inviteUserByEmail'), 'API no debe usar inviteUserByEmail porque envía correo antes del commit del perfil.');
  assert(file.includes('auth.admin.createUser'), 'API debe crear Auth de forma aditiva después de persistir el perfil.');
  assert(file.includes('send_invite'), 'API debe aceptar bandera send_invite para controlar el envío del correo.');
  assert(file.includes('getPublicAppUrl'), 'API debe construir redirectTo público para que el enlace abra el CRM correcto.');
  assert(file.includes('email_confirm: false'), 'La identidad nueva debe nacer sin confirmar hasta obtener vínculo durable.');
  const helper = file.slice(file.indexOf('async function ensureProfileAuthAfterCommit'), file.indexOf('async function generateAccessLink'));
  assert(helper.indexOf("database.rpc('psi_admin_bind_profile_auth'") < helper.indexOf('confirmAuthUserIfNeeded'), 'API debe vincular el Auth UID antes de confirmar la identidad.');
  assert(file.includes('resetPasswordForEmail'), 'API debe poder reenviar correo de acceso/recuperación al crear o editar usuarios.');
  assert(file.includes('generateAccessLink'), 'API debe generar enlace de acceso como respaldo cuando el correo no llegue.');
  assert(file.includes('invited: authResult.invited') && file.includes('access_link: authResult.accessLink'), 'Respuesta debe indicar correo enviado y enlace de respaldo.');
  assert(file.includes('auth_warning: authResult.authWarning'), 'Respuesta debe advertir si Auth falla después del commit.');
}

assert(src.includes('send_invite'), 'Formulario de usuarios debe enviar send_invite al API.');
assert(src.includes('Enviar correo de invitación'), 'Formulario debe mostrar opción visible para enviar correo de invitación.');
assert(src.includes('Correo de acceso enviado'), 'UI debe confirmar cuando Supabase envíe el correo de acceso.');
assert(src.includes('comparte este enlace de acceso'), 'UI debe mostrar un enlace de respaldo si el correo no llega.');

console.log('user invite email static checks passed');
