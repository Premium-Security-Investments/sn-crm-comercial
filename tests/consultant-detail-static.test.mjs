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
assert.match(source, /className="my-day-hygiene"/, 'Depurar CRM debe vivir en un <details> colapsado y subordinado');
assert.match(source, /personalFollowUpCards/, 'El banner debe resumir vencidas, hoy, sin agenda y valor en riesgo');
assert.match(source, /focusFollowUpFilter/, 'El banner debe permitir enfocar la tabla por tipo de alerta');
assert.ok(!source.includes('commercial-followup-list'), 'la lista plana reemplazada por Mi día no debe sobrevivir');

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
assert.match(css, /\.my-day\{/, 'styles.css debe incluir la regla .my-day');
assert.match(css, /\.my-day-card\{/, 'styles.css debe incluir la regla .my-day-card');
assert.ok(!css.includes('.commercial-followup-list{'), 'la regla sin selector debe retirarse junto con el JSX que la usaba');

// Contraste: título de grupo y summary de "Depurar CRM" deben usar un color claro
// legible sobre el fondo oscuro de .commercial-followup-banner, no el navy oscuro heredado.
assert.match(css, /\.my-day-group h4\{[^}]*color:#dbeafe/, '.my-day-group h4 debe usar un color claro (#dbeafe) legible sobre el banner oscuro');
assert.match(css, /\.my-day-hygiene>summary\{[^}]*color:#dbeafe/, '.my-day-hygiene>summary debe usar un color claro (#dbeafe) legible sobre el banner oscuro');

// Contraste: los <em> de Falta/Objetivo dentro de tarjetas blancas (secondary/muted) deben
// llevar un override azul oscuro explícito, no heredar el #bfdbfe pensado para fondo oscuro.
assert.match(
  css,
  /\.my-day-secondary \.my-day-card \.my-day-gap em,\.my-day-secondary \.my-day-card \.my-day-goal em,\.my-day-muted \.my-day-card \.my-day-gap em,\.my-day-muted \.my-day-card \.my-day-goal em\{color:#1d4ed8/,
  'los <em> de .my-day-gap/.my-day-goal en tarjetas secondary/muted deben tener override azul oscuro (#1d4ed8)'
);

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
assert.match(css, /\.my-day-card \.button\{[^}]*min-height:40px/, '.my-day-card .button debe tener un min-height de touch target razonable');
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
