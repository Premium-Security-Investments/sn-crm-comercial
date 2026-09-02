import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

// --- text-sanitizer.ts (puro) ---------------------------------------------------------------
const entry = new URL('../src/vigia/text-sanitizer.ts', import.meta.url).pathname;
const bundle = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const { humanizeVigiaText, DB_KEY_LABEL } = await import(moduleUrl);

const BOGOTA_DATETIME_LABEL = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });
const COP_GROUPING = new Intl.NumberFormat('es-CO');

assert.equal(
  humanizeVigiaText('Campos inválidos: last_interaction_at, updated_at.'),
  'Campos inválidos: última interacción registrada, última actualización del registro.',
  'los nombres de columna crudos deben traducirse a etiquetas legibles',
);
assert.equal(
  humanizeVigiaText('created_at y offer_value'),
  `${DB_KEY_LABEL.created_at} y ${DB_KEY_LABEL.offer_value}`,
  'las cuatro claves del diccionario deben traducirse usando el mismo lookup',
);

const isoInput = 'Próxima gestión vencida: 2026-07-21T14:29:00+00:00.';
const expectedIso = BOGOTA_DATETIME_LABEL.format(new Date('2026-07-21T14:29:00+00:00'));
assert.equal(
  humanizeVigiaText(isoInput),
  `Próxima gestión vencida: ${expectedIso}.`,
  'una fecha ISO completa con hora y zona debe reformatearse a America/Bogota con hora visible',
);

const expectedAmount = `$${COP_GROUPING.format(75310000)} COP`;
assert.equal(humanizeVigiaText('Valor registrado: 75310000 COP.'), `Valor registrado: ${expectedAmount}.`, 'monto con COP como sufijo debe normalizarse a $X.XXX.XXX COP');
assert.equal(humanizeVigiaText('Valor registrado: COP 75310000.'), `Valor registrado: ${expectedAmount}.`, 'monto con COP como prefijo debe normalizarse igual que el sufijo');
assert.equal(humanizeVigiaText('Valor registrado: $75.310.000 COP.'), 'Valor registrado: $75.310.000 COP.', 'un monto ya humanizado no debe duplicar el símbolo ni reformatearse');

assert.equal(humanizeVigiaText('4 24 horas'), '4 24 horas', 'texto no reconocido debe quedar intacto, sin inventar formato');
assert.equal(humanizeVigiaText(null), '', 'entrada nula produce cadena vacía, sin lanzar');
assert.equal(humanizeVigiaText(undefined), '', 'entrada indefinida produce cadena vacía, sin lanzar');

// --- VigiaCommercial.tsx (uso del sanitizador + huso horario + sufijo COP) ------------------
const component = readFileSync(new URL('../src/vigia/VigiaCommercial.tsx', import.meta.url), 'utf8');
assert.match(component, /import \{ humanizeVigiaText, DB_KEY_LABEL \} from '\.\/text-sanitizer';/, 'VigiaCommercial debe importar el sanitizador compartido');
assert.match(component, /const date = new Intl\.DateTimeFormat\('es-CO', \{ dateStyle: 'medium', timeZone: 'America\/Bogota' \}\);/, 'el formateador de fecha corta debe anclarse a America/Bogota');
assert.match(component, /function activityBasisLabel\(basis: string\): string \{/, 'debe existir el lookup activityBasisLabel');
assert.match(component, /<span>\{humanizeVigiaText\(signal\.evidence\)\}<\/span>/, 'la evidencia de cada señal debe pasar por humanizeVigiaText, sin excepción');
assert.match(component, /\(\{activityBasisLabel\(priority\.evidence\.activity_basis\)\}\)/, 'el pie de evidencia debe usar activityBasisLabel para activity_basis');
assert.match(component, /\{Number\(priority\.offer_value\) > 0 \? `\$\{money\.format\(priority\.offer_value\)\} COP` : 'Valor no registrado'\}/, 'el monto de la tarjeta debe llevar el sufijo explícito COP');

// --- styles.css (A: densidad de Prioridades Comerciales; B: acciones de tarjeta) ------------
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

assert.match(css, /\.priority-filter-tabs\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\);gap:10px\}/, 'base: 4 columnas (7 tarjetas ⇒ 4+3)');
assert.match(css, /\.priority-filter-tab\{display:grid;gap:3px;min-height:84px;padding:12px 14px;/, 'la tarjeta de categoría debe bajar a min-height:84px');
assert.match(css, /\.priority-filter-tab strong\{font-size:22px\}/, 'el contador de categoría debe reducir su tipografía a 22px');
assert.match(css, /@media\(min-width:1800px\)\{\.priority-filter-tabs\{grid-template-columns:repeat\(7,minmax\(0,1fr\)\)\}\}/, 'en pantallas ≥1800px las 7 categorías caben en una sola fila');
assert.match(css, /@media\(max-width:1100px\)\{\.priority-filter-tabs\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\.priority-filter-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}\.priority-search\{grid-column:span 2\}\}/, '≤1100px: 2 columnas para las categorías, sin cambiar el panel de filtros');
assert.match(css, /@media\(max-width:700px\)\{\.priority-filter-grid\{grid-template-columns:1fr 1fr\}/, '.priority-filter-grid conserva su propia escalera en 700px, separada de .priority-filter-tabs');
assert.match(css, /@media\(max-width:640px\)\{\.priority-filter-tabs\{grid-template-columns:1fr\}\.priority-filter-tab\{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:44px;padding:10px 12px\}\.priority-filter-tab strong\{font-size:18px\}\}/, '≤640px: 1 columna, layout horizontal compacto, min-height:44px');
assert.ok(!/\.priority-filter-tabs,\.priority-filter-grid\{grid-template-columns:1fr 1fr\}/.test(css), '.priority-filter-tabs ya no debe compartir selector con .priority-filter-grid en 700px');
assert.ok(!/\.priority-filter-tabs,\.priority-filter-grid\{grid-template-columns:1fr\}/.test(css), '.priority-filter-tabs ya no debe compartir selector con .priority-filter-grid en 480px');

assert.match(css, /\.vigia-command-hero\{[^}]*padding:18px 22px/, 'el hero de Prioridades Comerciales debe reducir su padding');
assert.match(css, /\.vigia-command-hero h2\{margin:5px 0 6px;font-size:23px\}/, 'el título del hero debe reducir su tipografía a 23px');

assert.match(css, /\.vigia-card-actions \.button\{display:inline-flex;align-items:center;justify-content:center;min-height:44px;/, 'la acción primaria de la tarjeta debe tener estilo dedicado con min-height:44px');
assert.match(css, /\.vigia-card-actions \.button:hover\{background:#123f8e\}/, 'la acción primaria debe tener estado :hover');
assert.match(css, /\.vigia-card-actions \.button:focus-visible\{outline:3px solid #93c5fd;outline-offset:2px\}/, 'la acción primaria debe tener :focus-visible visible');
assert.match(css, /\.vigia-card-actions \.button\.secondary\{background:#e9eef7;color:#1b355f;border:1px solid #cbd9e8\}/, 'la acción secundaria debe tener estilo outline/clara');
assert.match(css, /@media\(max-width:560px\)\{[\s\S]*?\.vigia-card-actions\{flex-direction:column\}\.vigia-card-actions \.button\{width:100%\}\}/, 'en móvil, las dos acciones deben apilarse al 100% de ancho');

console.log('AGT-003 consolidated visual QA static contract passed');
