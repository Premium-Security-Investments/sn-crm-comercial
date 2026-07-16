import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const nav = readFileSync(new URL('../src/navPermissions.ts', import.meta.url), 'utf8');
const failures = [];
const check = (name, assertion) => {
  try { assertion(); }
  catch (error) { failures.push(`${name}: ${error.message}`); }
};

check('Nueva oportunidad comparte capacidad', () => assert.match(
  main,
  /canAccessRoute\(currentProfile,\s*'new'\)[\s\S]{0,180}Nueva oportunidad/,
  'La acción Nueva oportunidad debe usar la misma capacidad que la ruta new.',
));

check('Route representa hashes inválidos', () => assert.match(main, /type Route = [\s\S]*?'invalid'/, 'Route debe representar hashes inválidos explícitamente.'));
for (const protectedPage of ['detail', 'edit', 'consultant']) {
  check(`${protectedPage} incompleto queda inválido`, () => assert.match(
    main,
    new RegExp(`if \\(page === '${protectedPage}'\\)[\\s\\S]{0,180}page: 'invalid'`),
    `#/${protectedPage} sin id debe conservarse como ruta inválida.`,
  ));
}
check('RouterView representa URL inválida', () => assert.match(main, /if \(route\.page === 'invalid'\)[\s\S]{0,180}(No encontrada|URL inválida)/, 'RouterView debe mostrar una vista de ruta inválida antes de autorizar módulos.'));

check('UsersAdmin distingue estado de catálogo', () => assert.match(main, /useState<'loading' \| 'ready' \| 'error'>\('loading'\)/, 'UsersAdmin debe distinguir catálogo loading/ready/error.'));
check('UsersAdmin marca catálogo listo', () => assert.match(main, /setCatalogStatus\('ready'\)/, 'UsersAdmin debe marcar el catálogo como listo solo tras cargarlo.'));
check('UsersAdmin marca error de catálogo', () => assert.match(main, /setCatalogStatus\('error'\)/, 'UsersAdmin debe marcar error de catálogo.'));
check('submit falla cerrado', () => assert.match(main, /if \(catalogStatus !== 'ready'\) \{[\s\S]{0,160}return;[\s\S]{0,40}\}/, 'submit debe impedir guardar si el catálogo no está listo.'));
check('Guardar se deshabilita', () => assert.match(main, /disabled=\{catalogStatus !== 'ready'\}/, 'Guardar debe estar deshabilitado mientras el catálogo no esté listo.'));
check('UI muestra carga de catálogo', () => assert.match(main, /catalogStatus === 'loading'[\s\S]{0,200}Cargando catálogo/, 'La UI debe informar que el catálogo sigue cargando.'));
check('UI muestra fallo de catálogo', () => assert.match(main, /catalogStatus === 'error'[\s\S]{0,220}No fue posible cargar el catálogo/, 'La UI debe informar el fallo del catálogo.'));

check('Items no duplican moduleCode', () => assert.doesNotMatch(nav, /NavItemDefinition|moduleCode:\s*['\"]/, 'Los items de navegación no deben duplicar moduleCode.'));
check('No queda mapa moduleCodeForPage', () => assert.doesNotMatch(nav, /moduleCodeForPage/, 'El mapa de módulos debe tener una única fuente por página.'));
check('moduleActionForPage usa una sola tabla por página', () => assert.match(nav, /const moduleActionByPage: Partial<Record<NavRoutePage, string>>/, 'moduleActionForPage debe derivar la capacidad de una sola tabla de páginas y aliases.'));

if (failures.length) {
  console.error(`Task 3 review regressions failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Task 3 review regression static checks passed');
}
