import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// AGT-003 — bloque 1 de refinamiento de la ficha comercial.
//
// Contrato estático de integración: dónde se monta cada cosa en `src/main.tsx`,
// `src/vigia/VigiaOpportunityCopilot.tsx` y `src/styles.css`. La conducta vive en los módulos
// puros (`agt003-ficha-presentation`, `agt003-copilot-presentation`) y en el render real
// (`agt003-copilot-proposal-render`); aquí sólo se fija el cableado y el CSS que no es
// observable desde un módulo puro.

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const copilot = readFileSync(new URL('../src/vigia/VigiaOpportunityCopilot.tsx', import.meta.url), 'utf8');

// --- 1) orden de la ficha ------------------------------------------------------------------------
const banner = main.indexOf('<div className="hero">');
const priority = main.indexOf('opportunity-priority-grid');
const followUp = main.indexOf('<h2 className="followup-section-title">Seguimiento comercial</h2>');
const vigia = main.indexOf('canRenderOpportunityCopilot(data.currentProfile, o.service_type_code)', followUp);
const moreInfo = main.indexOf('<summary>Más información</summary>', vigia);
assert.ok(banner > 0 && banner < priority && priority < followUp && followUp < vigia && vigia < moreInfo,
  'orden: Banner → Estado seguimiento → Seguimiento comercial → VIG-IA → Más información');

// --- 2) compactación y uso responsable del ancho --------------------------------------------------
assert.match(main, /className=\{o\.service_type_code === 'licitacion_publica' \? 'stack' : 'stack opportunity-ficha detail-page-shell'\}/,
  'el shell amplio se aplica sólo a la ficha comercial, nunca a la ruta de licitaciones');
assert.doesNotMatch(css, /\.detail-page-shell\{[^}]*1180/, 'el cuello de botella de 1180px no puede volver al shell de detalle');
assert.match(css, /\.detail-page-shell\{[^}]*width:100%[^}]*max-width:1680px/,
  'el shell de detalle usa casi todo el área disponible con un techo extremo legible');
assert.match(css, /\.detail-page-shell\{[^}]*gap:clamp\(/, 'los gaps deben crecer de forma fluida');
assert.match(css, /\.detail-page-shell\{[^}]*padding-inline:clamp\(/, 'los márgenes internos deben ser fluidos');
assert.match(css, /\.opportunity-ficha\s+\.hero\{/, 'el banner se compacta sólo dentro de la ficha');
assert.match(css, /\.opportunity-ficha\s+\.opportunity-priority-grid\s+\.opportunity-insight-card\{/);
assert.match(css, /\.opportunity-ficha>\.tender-detail-anchor,\.opportunity-ficha>\.vigia-opportunity-copilot,\.opportunity-ficha>\.opportunity-more-info\{[^}]*width:100%/,
  'banner/KPIs, Vig-IA y Más información ocupan el contenedor completo');
assert.match(css, /\.followup-section-grid\{[^}]*grid-template-columns:minmax\(0,7fr\) minmax\(280px,5fr\)/,
  'seguimiento conserva una proporción aproximada 60/40');
assert.match(css, /@media\(max-width:980px\)\{[^}]*\.followup-section-grid\{grid-template-columns:1fr/,
  'tablet apila el seguimiento antes de que sus columnas sean ilegibles');
assert.match(css, /@media\(max-width:760px\)\{[^}]*\.detail-page-shell\{[^}]*padding-inline:0/,
  'móvil elimina el padding adicional de la ficha');

// --- 3) tarjetas con estado accionable --------------------------------------------------------------
assert.match(main, /import \{[^}]*decisionMakerCardState[^}]*\} from '\.\/vigia\/opportunity-ficha-presentation';/);
for (const helper of ['expectedCloseCardState', 'followUpAgeLabel', 'nextActionCardState', 'presentFollowUpEntry']) {
  assert.ok(main.includes(helper), `main.tsx debe consumir ${helper} del módulo puro`);
}
const gridStart = main.indexOf('opportunity-priority-grid');
const grid = main.slice(gridStart, main.indexOf('</section>}', gridStart));
assert.deepEqual([...grid.matchAll(/<small>([^<]+)<\/small>/g)].map(m => m[1]),
  ['Próxima gestión', 'Último seguimiento', 'Cierre estimado', 'Contacto decisor'],
  'siguen siendo cuatro tarjetas, con las mismas etiquetas');
assert.ok(!grid.includes('${action.label} · ${action.detail}'), 'se elimina la repetición `Vencida · … vencida`');
assert.ok(!grid.includes('día(s)'), 'el copy natural no usa `día(s)`');
for (const state of ['priorityNextAction', 'priorityClose', 'priorityDecisionMaker']) {
  assert.ok(grid.includes(`${state}.className`), `la tarjeta debe llevar el estado visual de ${state}`);
  assert.ok(grid.includes(`${state}.detail`), `la tarjeta debe mostrar el detalle de ${state}`);
}
assert.ok(grid.includes('followUpAgeLabel(o.last_interaction_at)'), 'la antigüedad se calcula desde la misma referencia temporal');
assert.ok(!main.includes('`${lastDays} día(s) de antigüedad`'), 'el copy viejo de antigüedad desaparece');
assert.ok(!main.includes('const lastDays = daysSince('), 'la ficha deja de usar el cálculo desfasado por instante');
assert.match(main, /const action = nextActionStatus\(o\);/, 'la navegación de licitaciones conserva intacto nextActionStatus');
for (const cls of ['.opportunity-insight-card.is-critical', '.opportunity-insight-card.is-attention', '.opportunity-insight-card.is-ok']) {
  assert.ok(css.includes(cls), `styles.css debe definir ${cls}`);
}

// --- 4) formulario de seguimiento compacto ------------------------------------------------------------
assert.match(main, /className="form followup-form followup-form-compact"/);
assert.match(css, /\.followup-form-compact\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(css, /\.followup-form-compact>label:has\(textarea\)\{grid-column:1\/-1\}/);
assert.match(css, /@media\(max-width:760px\)\{[^}]*\.followup-form-compact\{grid-template-columns:1fr\}/);
assert.match(main, /\{profiles\.length > 1 && <label>Registrado por<Select value=\{form\.created_by\}/,
  'la semántica de `Registrado por` no cambia');

// --- 5) registro migrado sin redundancia técnica ---------------------------------------------------------
const timeline = main.slice(main.indexOf('<div className="timeline followup-timeline">'), main.indexOf('Sin seguimientos registrados.'));
assert.ok(timeline.includes('presentFollowUpEntry(i)'), 'el historial se presenta con el módulo puro');
assert.ok(!timeline.includes('followUpInteractionTypeLabel(i.interaction_type)'), 'el tipo pasa a ser el inferido por la presentación');
assert.ok(!timeline.includes("i.actor_label || i.psi_sales_profiles?.full_name || 'Migrado / sistema'"), 'el autor lo resuelve la presentación');
assert.ok(timeline.includes('{i.notes}') === false, 'el contenido se muestra ya depurado, sin repetir el prefijo técnico');
assert.match(timeline, /entry\.migrated && <span className="badge followup-migrated-badge">\{entry\.authorLabel\}<\/span>/);
assert.match(css, /\.followup-migrated-badge\{/);

// --- 6) VIG-IA: estado vacío compacto y botón de actualización -------------------------------------------
assert.match(copilot, />\{ready \? 'Actualizar propuesta' : 'Preparar seguimiento'\}</,
  'con resultado el botón dice `Actualizar propuesta`');
assert.ok(copilot.includes('vigia-copilot-empty'), 'el estado vacío tiene su propio contenedor compacto');
assert.match(css, /\.vigia-copilot-empty\{/);
assert.equal(copilot.includes('>Útil<'), false);
assert.equal(copilot.includes('Necesita cambios'), false);
assert.equal(copilot.includes('/api/vigia/copilot/feedback'), false, 'esta UI ya no emite feedback; la API histórica se conserva');
assert.ok(copilot.includes("'/api/vigia/copilot/generate'"), 'la generación no cambia de endpoint');
assert.ok(copilot.includes('export function VigiaCopilotProposal('), 'la propuesta es un componente presentacional testeable');
assert.ok(copilot.includes('normalizeCopilotErrorMessage'), 'los mensajes de error visibles se normalizan en el frontend');
assert.match(css, /\.vigia-copilot-draft input,\.vigia-copilot-draft textarea\{[^}]*font-weight:400/,
  'el editor usa tipografía normal, no la del label');

// --- 7) acordeón `Más información` --------------------------------------------------------------------------
assert.match(main, /\{o\.service_type_code !== 'licitacion_publica' && <details className="opportunity-more-info">/);
const detailsStart = main.indexOf('opportunity-more-info');
const details = main.slice(detailsStart, main.indexOf('</details>}', detailsStart));
assert.ok(details.includes('<h3>Información comercial secundaria</h3>'));
assert.ok(details.includes('<h3>Datos de origen</h3>'));
for (const label of ['Fecha creación', 'Área comercial', 'Sector', 'ID legacy', 'Hoja origen', 'Estado original']) {
  assert.ok(details.includes(`label="${label}"`), `Más información debe conservar ${label}`);
}
assert.ok(!details.includes('<Info label='), 'seis tarjetas gigantes dejan de usarse dentro del acordeón');
assert.ok(details.includes('{(legacyId || legacySheet || legacyStatus) &&'), 'el grupo de origen sólo aparece si hay datos');
assert.match(css, /\.opportunity-more-info>summary\{[^}]*list-style:none/, 'el acordeón deja de verse como un <details> nativo');
assert.match(css, /\.opportunity-more-info>summary::-webkit-details-marker\{display:none\}/);
assert.match(css, /\.opportunity-more-info>summary:focus-visible\{[^}]*outline:3px solid/, 'el foco sigue siendo visible y accesible');
assert.match(css, /\.opportunity-more-info-group\{/);

// --- marca ---------------------------------------------------------------------------------------------------
assert.ok(!/VIG-IA/.test(main), 'en main.tsx la identidad visible se interpola, nunca se escribe literal');
assert.equal(/Vig-IA/.test(copilot), false, 'el panel nunca escribe `Vig-IA`');

console.log('AGT-003 first analysis refinement static checks passed');
