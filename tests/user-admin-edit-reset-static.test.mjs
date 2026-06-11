import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(src.includes('resetPasswordForEmail'), 'Login debe ofrecer recuperación de contraseña con Supabase resetPasswordForEmail.');
assert(src.includes('Olvidé mi clave'), 'Login debe mostrar acción visible "Olvidé mi clave".');
assert(src.includes('PasswordResetScreen'), 'App debe mostrar pantalla para definir nueva clave después del enlace de recuperación.');
assert(src.includes('supabaseBrowser.auth.updateUser'), 'Recuperación debe guardar la nueva clave con Supabase updateUser.');
assert(src.includes('PASSWORD_RECOVERY'), 'App debe detectar evento PASSWORD_RECOVERY de Supabase.');
assert(src.includes('editingUserId'), 'Usuarios y permisos debe permitir seleccionar un usuario existente para editar.');
assert(src.includes("method: editingUserId ? 'PATCH' : 'POST'"), 'Formulario de usuarios debe usar PATCH al editar un perfil existente.');
assert(src.includes("/api/users?id="), 'Frontend debe editar usuarios con /api/users?id=... para compatibilidad serverless Vercel.');
assert(src.includes('Editar') && src.includes('Cancelar edición'), 'Tabla de usuarios debe tener acción Editar y opción Cancelar edición.');
assert(src.includes('editFormRef') && src.includes('scrollIntoView'), 'Al hacer clic en Editar, la vista debe llevar al usuario al formulario de edición.');
assert(src.includes('Editar usuario ·'), 'El formulario debe mostrar claramente qué usuario se está editando.');
assert(src.includes('Edición cliente'), 'Usuarios debe llamar explícitamente el permiso de edición de cliente, no segmento genérico.');
assert(src.includes('Habilitada') && src.includes('Restringida'), 'Usuarios no debe mostrar Bloqueado junto a Estado Activo; debe usar etiquetas de permiso no ambiguas.');
assert(!src.includes("'Bloqueado'"), 'Usuarios no debe confundir permiso de edición con bloqueo de cuenta.');

for (const file of [server, api]) {
  assert(file.includes("app.patch('/api/users'"), 'API debe exponer PATCH /api/users?id=... para editar usuarios existentes.');
  assert(file.includes('updateUserById'), 'API debe poder actualizar password/metadatos del usuario Auth existente.');
  assert(file.includes('emailChanged'), 'PATCH de usuarios debe detectar si el email realmente cambió antes de tocar Auth.');
  assert(file.includes('updates.email = microsoft_email'), 'PATCH solo debe enviar email a Supabase Auth cuando el correo cambió.');
  assert(file.includes('El email ya pertenece a otro usuario de acceso.'), 'PATCH debe dar error claro si el nuevo email pertenece a otro Auth user.');
  assert(file.includes(".update({ full_name, microsoft_email, role, active") && file.includes('commercial_area') && file.includes('can_edit_customer_segment'), 'API debe actualizar psi_sales_profiles al editar usuario, incluyendo área y permiso de segmento.');
}

console.log('user-admin edit/reset static checks passed');
