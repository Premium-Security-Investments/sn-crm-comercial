import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const profileAdminRpc = readFileSync(new URL('../supabase/migrations/020_profile_access_admin_rpc.sql', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(src.includes('resetPasswordForEmail'), 'Login debe ofrecer recuperación de contraseña con Supabase resetPasswordForEmail.');
assert(src.includes('Olvidé mi clave'), 'Login debe mostrar acción visible "Olvidé mi clave".');
assert(src.includes('PasswordResetScreen'), 'App debe mostrar pantalla para definir nueva clave después del enlace de recuperación.');
assert(src.includes('supabaseBrowser.auth.updateUser'), 'Recuperación debe guardar la nueva clave con Supabase updateUser.');
assert(src.includes('PASSWORD_RECOVERY'), 'App debe detectar evento PASSWORD_RECOVERY de Supabase.');
assert(src.includes('editingUserId'), 'Usuarios y permisos debe permitir seleccionar un usuario existente para editar.');
assert(src.includes('disabled={Boolean(editingUserId)}'), 'Email debe quedar bloqueado al editar un perfil existente.');
assert(src.includes("method: editingUserId ? 'PATCH' : 'POST'"), 'Formulario de usuarios debe usar PATCH al editar un perfil existente.');
assert(src.includes("/api/users?id="), 'Frontend debe editar usuarios con /api/users?id=... para compatibilidad serverless Vercel.');
assert(src.includes('Editar') && src.includes('Cancelar edición'), 'Tabla de usuarios debe tener acción Editar y opción Cancelar edición.');
assert(src.includes('editFormRef') && src.includes('scrollIntoView'), 'Al hacer clic en Editar, la vista debe llevar al usuario al formulario de edición.');
assert(src.includes('Editar usuario ·'), 'El formulario debe mostrar claramente qué usuario se está editando.');
assert(src.includes('Módulos y pestañas'), 'Usuarios y permisos debe exponer la asignación explícita de módulos.');
assert(src.includes('permissions: user.permissions || []'), 'Editar debe conservar exactamente los módulos persistidos del usuario.');

for (const file of [server, api]) {
  assert(file.includes("app.patch('/api/users'"), 'API debe exponer PATCH /api/users?id=... para editar usuarios existentes.');
  assert(file.includes('ensureProfileAuthAfterCommit'), 'API debe aprovisionar Auth de forma aditiva después del commit.');
  assert(!file.includes('updates.email = microsoft_email'), 'PATCH no debe cambiar el email de una identidad Auth existente.');
  assert(file.includes('PROFILE_EMAIL_IMMUTABLE'), 'PATCH debe rechazar cambios del email inmutable del perfil.');
  assert(!file.includes('compensateAuthMutation') && !file.includes('deleteUser('), 'API no debe revertir Auth de forma destructiva.');
  assert(file.includes('resetPasswordForEmail'), 'Cambios de clave de identidades existentes deben usar recuperación controlada por el usuario.');
  assert(file.includes("database.rpc('psi_admin_persist_profile_access'"), 'API debe persistir perfil y alcances mediante el RPC transaccional.');
}
assert(profileAdminRpc.includes('update public.psi_sales_profiles set') && profileAdminRpc.includes('commercial_area =') && profileAdminRpc.includes('can_edit_customer_segment ='), 'RPC debe actualizar todos los campos editables del perfil.');
assert(profileAdminRpc.includes('psi_profile_area_assignments') && profileAdminRpc.includes('psi_profile_permissions') && profileAdminRpc.includes('psi_access_audit_log'), 'RPC debe persistir alcances, permisos y auditoría en la misma transacción.');

console.log('user-admin edit/reset static checks passed');
