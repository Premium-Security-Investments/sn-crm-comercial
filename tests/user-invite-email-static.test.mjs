import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const file of [server, api]) {
  assert(file.includes('inviteUserByEmail'), 'API debe enviar invitación por correo con Supabase auth.admin.inviteUserByEmail al crear usuarios.');
  assert(file.includes('send_invite'), 'API debe aceptar bandera send_invite para controlar el envío del correo.');
  assert(file.includes('getPublicAppUrl'), 'API debe construir redirectTo público para que el enlace abra el CRM correcto.');
  assert(file.includes("invited: inviteSent"), 'Respuesta de creación debe indicar si la invitación fue enviada.');
}

assert(src.includes('send_invite'), 'Formulario de usuarios debe enviar send_invite al API.');
assert(src.includes('Enviar correo de invitación'), 'Formulario debe mostrar opción visible para enviar correo de invitación.');
assert(src.includes('Invitación enviada por correo'), 'UI debe confirmar cuando Supabase envíe el correo de invitación.');

console.log('user invite email static checks passed');
