import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const source = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert.match(source, /page: 'consultant'/, 'Route debe incluir la página consultant para detalle por consultor');
assert.match(source, /#\/consultant\//, 'Dashboard gerencial debe navegar a #/consultant/<id> desde cada consultor');
assert.match(source, /function ConsultantDetail/, 'Debe existir una vista ConsultantDetail');
assert.match(source, /Detalle por etapa/, 'La vista del consultor debe mostrar detalle por etapa');
assert.match(source, /Oportunidades del consultor/, 'La vista del consultor debe mostrar tabla de oportunidades');
assert.match(source, /import \{ buildMyDayQueue, type MyDayAlert \} from '\.\/vigia\/my-day-presentation';/, 'ConsultantDetail debe importar buildMyDayQueue del módulo puro de Mi día');
assert.match(source, /const myDay = useMemo\(\(\) => buildMyDayQueue\(opportunities, new Date\(\)\), \[opportunities\]\);/, 'ConsultantDetail debe derivar myDay de opportunities con buildMyDayQueue');
assert.match(source, /Mi día/, 'El perfil comercial debe mostrar el banner "Mi día"');
assert.ok(!source.includes('Gestión comercial de hoy'), 'el banner anterior "Gestión comercial de hoy" debe quedar retirado');
assert.match(source, /function MyDayGroup\(/, 'Debe existir el componente MyDayGroup');
assert.match(source, /Preparar seguimiento/, 'Cada tarjeta de Mi día debe llevar un único CTA "Preparar seguimiento"');
assert.match(source, /<p className="my-day-fact"><em>Qué pasó:<\/em> \{a\.fact\}<\/p>/, 'MyDayGroup debe rotular el primer dato de cada tarjeta con "Qué pasó:"');
assert.match(
  source,
  /<section className="commercial-followup-banner my-day-manager-banner" aria-label=\{`Prioridades de hoy de \$\{ownerName\}`\}>/,
  'un gerente en el detalle de un consultor específico debe ver "Prioridades de hoy de {ownerName}"',
);
assert.match(source, /<h3>Prioridades de hoy de \{ownerName\}<\/h3>/, 'el título del banner gerencial debe nombrar al consultor');
assert.match(source, /\{!personal && <section className="commercial-followup-banner my-day-manager-banner"/, 'el banner gerencial debe ser mutuamente excluyente con el tablero personal');
assert.match(source, /className="my-day-hygiene"/, 'Depurar CRM debe vivir en un <details> colapsado y subordinado');
assert.match(source, /personalFollowUpCards/, 'El banner debe resumir vencidas, hoy, sin agenda y valor en riesgo');
assert.match(source, /focusFollowUpFilter/, 'El banner debe permitir enfocar la tabla por tipo de alerta');
assert.ok(!source.includes('commercial-followup-list'), 'la lista plana reemplazada por Mi día no debe sobrevivir');

// Hallazgo IMPORTANTE: el párrafo resumen del banner gerencial debe decidirse con la
// misma cola myDay que se renderiza (hacerHoy/preparar/depurarCrm), no con
// personalFollowUpRows.length, que es la cola de "Mi día" personal, no la del consultor
// que se está viendo en modo gerente.
const consultantDetailStart = source.indexOf('function ConsultantDetail');
assert.ok(consultantDetailStart !== -1, 'debe existir la función ConsultantDetail');
const managerBannerMarker = 'aria-label={`Prioridades de hoy de ${ownerName}`}>';
const managerBannerStart = source.indexOf(managerBannerMarker, consultantDetailStart);
assert.ok(managerBannerStart !== -1, 'debe existir el banner gerencial "Prioridades de hoy de {ownerName}"');
const managerBannerEnd = source.indexOf('</section>}', managerBannerStart);
assert.ok(managerBannerEnd !== -1, 'debe poder delimitarse el cierre del banner gerencial');
const managerBannerSection = source.slice(managerBannerStart, managerBannerEnd);
const managerBannerScope = source.slice(consultantDetailStart, managerBannerEnd);

const managerParagraphMatch = managerBannerSection.match(/<h3>Prioridades de hoy de \{ownerName\}<\/h3>\s*<p>([\s\S]*?)<\/p>/);
assert.ok(managerParagraphMatch, 'el banner gerencial debe tener un <h3> seguido de un <p> con el resumen');
const managerParagraph = managerParagraphMatch[1];

assert.ok(
  !managerParagraph.includes('personalFollowUpRows.length'),
  'el párrafo resumen del banner gerencial NO debe decidirse con personalFollowUpRows.length (esa es la cola de Mi día personal, no la del consultor visto en modo gerente)',
);

const derivedBoolDecl = managerBannerScope.match(/const\s+(\w+)\s*=\s*[^;]*myDay\.hacerHoy\.length[^;]*myDay\.preparar\.length[^;]*myDay\.depurarCrm\.length[^;]*;/);
const inlineDerivedBool = /myDay\.hacerHoy\.length[\s\S]{0,120}myDay\.preparar\.length[\s\S]{0,120}myDay\.depurarCrm\.length/.test(managerParagraph);
const usesDeclaredBool = Boolean(derivedBoolDecl && managerParagraph.includes(derivedBoolDecl[1]));
assert.ok(
  inlineDerivedBool || usesDeclaredBool,
  'el párrafo resumen del banner gerencial debe decidirse con myDay.hacerHoy.length, myDay.preparar.length y myDay.depurarCrm.length (inline o vía una constante booleana derivada de las tres)',
);

assert.match(
  managerBannerSection,
  /<MyDayGroup title="Hacer hoy" alerts=\{myDay\.hacerHoy\} total=\{myDay\.hacerHoyTotal\} tone="primary" empty=\{`\$\{ownerName\} no tiene próximas gestiones vencidas o sin agendar\.`\} \/>/,
  'el empty copy de MyDayGroup "Hacer hoy" en el banner gerencial debe ser exactamente `${ownerName} no tiene próximas gestiones vencidas o sin agendar.` en tercera persona',
);

// Hallazgo IMPORTANTE: el banner gerencial reutilizó el eyebrow "Mi día" del tablero
// personal. En modo gerente (viendo a otro consultor) el eyebrow debe leerse en tercera
// persona como el resto del banner ("Prioridades de hoy"), no "Mi día".
assert.match(
  managerBannerSection,
  /<span className="eyebrow">Prioridades de hoy<\/span>/,
  'el eyebrow del banner gerencial debe ser exactamente <span className="eyebrow">Prioridades de hoy</span>',
);
assert.ok(
  !managerBannerSection.includes('<span className="eyebrow">Mi día</span>'),
  'el banner gerencial no debe conservar el eyebrow personal "Mi día" (ese texto es solo para el tablero propio del consultor)',
);

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
assert.match(css, /\.my-day\{/, 'styles.css debe incluir la regla .my-day');
assert.match(css, /\.my-day-card\{/, 'styles.css debe incluir la regla .my-day-card');
assert.ok(!css.includes('.commercial-followup-list{'), 'la regla sin selector debe retirarse junto con el JSX que la usaba');

assert.match(css, /\.my-day-card \.my-day-fact em,\.my-day-card \.my-day-gap em,\.my-day-card \.my-day-goal em\{font-style:normal;color:#bfdbfe;font-weight:800\}/, '.my-day-fact em debe compartir el estilo de énfasis claro sobre fondo oscuro');
assert.match(
  css,
  /\.my-day-secondary \.my-day-card \.my-day-fact em,\.my-day-secondary \.my-day-card \.my-day-gap em,\.my-day-secondary \.my-day-card \.my-day-goal em,\.my-day-muted \.my-day-card \.my-day-fact em,\.my-day-muted \.my-day-card \.my-day-gap em,\.my-day-muted \.my-day-card \.my-day-goal em\{color:#1d4ed8\}/,
  '.my-day-fact em en tarjetas secondary/muted debe llevar el mismo override azul oscuro que .my-day-gap/.my-day-goal',
);
assert.match(css, /\.my-day-manager-banner\{grid-template-columns:1fr\}/, 'el banner gerencial debe forzar una sola columna (sin segunda columna de tarjetas de resumen)');

// Contraste: título de grupo y summary de "Depurar CRM" deben usar un color claro
// legible sobre el fondo oscuro de .commercial-followup-banner, no el navy oscuro heredado.
assert.match(css, /\.my-day-group h4\{[^}]*color:#dbeafe/, '.my-day-group h4 debe usar un color claro (#dbeafe) legible sobre el banner oscuro');
assert.match(css, /\.my-day-hygiene>summary\{[^}]*color:#dbeafe/, '.my-day-hygiene>summary debe usar un color claro (#dbeafe) legible sobre el banner oscuro');

// CTA "Preparar seguimiento": .my-day-card .button es un <a>, no un <button>, y no hay
// regla global .button; debe recibir estilo completo de botón con estados accesibles.
assert.match(css, /\.my-day-card \.button\{[^}]*display:inline-flex/, '.my-day-card .button debe usar display:inline-flex');
assert.match(css, /\.my-day-card \.button\{[^}]*justify-content:center/, '.my-day-card .button debe centrar su contenido');
assert.match(css, /\.my-day-card \.button\{[^}]*background:#1b64f2/, '.my-day-card .button debe tener fondo azul');
assert.match(css, /\.my-day-card \.button\{[^}]*color:#fff/, '.my-day-card .button debe tener texto blanco');
assert.match(css, /\.my-day-card \.button\{[^}]*text-decoration:none/, '.my-day-card .button no debe llevar subrayado');
assert.match(css, /\.my-day-card \.button\{[^}]*padding:/, '.my-day-card .button debe tener padding');
assert.match(css, /\.my-day-card \.button\{[^}]*border-radius:/, '.my-day-card .button debe tener border-radius');
assert.match(css, /\.my-day-card \.button\{[^}]*font-weight:/, '.my-day-card .button debe tener font-weight');
assert.match(css, /\.my-day-card \.button\{[^}]*min-height:44px/, '.my-day-card .button debe tener un objetivo táctil de 44px (paquete de QA visual consolidado)');
assert.match(css, /\.my-day-card \.button\{[^}]*margin-top:4px/, '.my-day-card .button debe conservar margin-top:4px');
assert.match(css, /\.my-day-card \.button\{[^}]*justify-self:start/, '.my-day-card .button debe conservar justify-self:start');
assert.match(css, /\.my-day-card \.button:hover\{[^}]*background:/, '.my-day-card .button debe tener estado :hover');
assert.match(css, /\.my-day-card \.button:focus-visible\{[^}]*outline:/, '.my-day-card .button debe tener estado :focus-visible con outline visible');

// Responsive: en <=640px, además de una columna, la CTA de tarjeta debe ocupar el 100%
// del ancho y quedar centrada.
assert.match(
  css,
  /@media\(max-width:640px\)\{\.my-day-primary \.my-day-list\{grid-template-columns:1fr\}\.my-day-card \.button\{width:100%/,
  'en <=640px .my-day-card .button debe pasar a width:100%'
);
assert.match(
  css,
  /@media\(max-width:640px\)\{\.my-day-primary \.my-day-list\{grid-template-columns:1fr\}\.my-day-card \.button\{width:100%;justify-self:center/,
  'en <=640px .my-day-card .button debe quedar centrada (justify-self:center)'
);

console.log('consultant-detail static checks passed');
