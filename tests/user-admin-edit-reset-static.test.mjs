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

for (const file of [server, api]) {
  assert(file.includes("app.patch('/api/users'"), 'API debe exponer PATCH /api/users?id=... para editar usuarios existentes.');
  assert(file.includes('updateUserById'), 'API debe poder actualizar password/metadatos del usuario Auth existente.');
  assert(file.includes(".update({ full_name, microsoft_email, role, active })"), 'API debe actualizar psi_sales_profiles al editar usuario.');
}

console.log('user-admin edit/reset static checks passed');
