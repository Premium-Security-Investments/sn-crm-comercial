import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

// Usuarios y permisos por pestañas (Juan Botero, 2026-10-15). Reemplaza el contrato anterior (rol + módulos + áreas):
// las casillas son las pestañas del menú y profile-tabs.js calcula rol, permisos y áreas. Las plantillas (aprobadas por
// Juan el mismo día) sólo pre-marcan casillas: no son permisos.
const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const usersAdmin = src.slice(src.indexOf('function UsersAdmin('), src.indexOf('\n}\n', src.indexOf('function UsersAdmin(')));

assert.match(src, /from ['"]\.\.\/profile-tabs\.js['"]/, 'UsersAdmin debe usar el traductor compartido de pestañas.');
assert.match(usersAdmin, /emptyUserForm: UserForm = [^\n]*access: \{ \.\.\.EMPTY_TABS_ACCESS, tabs: \[\] \}/, 'Un usuario nuevo debe iniciar sin pestañas.');
assert.match(usersAdmin, /Pestañas que puede abrir/, 'El formulario debe mostrar las pestañas del menú.');
assert.match(usersAdmin, /access: tabsFromProfile\(user\)/, 'Editar debe partir de las pestañas guardadas.');
assert.match(usersAdmin, /Verá en su menú/, 'El formulario debe resumir qué verá la persona antes de guardar.');
assert.match(usersAdmin, /Empezar desde una plantilla/, 'Las plantillas son opcionales y visibles.');
assert.doesNotMatch(usersAdmin, /<label>Rol</, 'El formulario ya no pide un rol.');
assert.doesNotMatch(usersAdmin, /Alcance por áreas|Toda el área|Alertas Comerciales/, 'Las áreas y Alertas Comerciales ya no se muestran.');

console.log('user module admin static checks passed');
