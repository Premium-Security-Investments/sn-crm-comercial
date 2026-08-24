import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

// 1) módulo puro conectado
assert.match(main, /import \{ buildFollowUpHistory, followUpInteractionTypeLabel \} from '\.\/opportunity-followup-presentation\.js';/);
assert.match(main, /const followUpHistory = buildFollowUpHistory\(o, detail\.interactions\);/);
assert.ok(!main.includes("const visibleInteractions = detail.interactions.filter"));

// 2) chips del banner, sólo en la rama no licitatoria
assert.match(main, /\{o\.service_type_code !== 'licitacion_publica' && <div className="hero-chip-row">/);
assert.match(main, /<Badge>Servicio: \{o\.service_type_name \|\| o\.tipo_producto_original \|\| 'Sin servicio'\}<\/Badge>/);
assert.match(main, /<Badge>Tipo de cliente: \{customerSegmentLabel\(o\.customer_segment\)\}<\/Badge>/);
assert.match(main, /\{locationChip && <Badge>Ubicación: \{locationChip\}<\/Badge>\}/);
assert.ok(!/hero-chip-row[\s\S]{0,600}Área comercial/.test(main), 'no debe existir chip de Área comercial');

// 3) cuatro tarjetas de prioridad reemplazan el grid de once campos
assert.match(main, /<section className="opportunity-insight-grid opportunity-priority-grid" aria-label="Resumen prioritario de la oportunidad">/);
const gridStart = main.indexOf('opportunity-priority-grid');
const gridEnd = main.indexOf('</section>}', gridStart);
const priorityGrid = main.slice(gridStart, gridEnd);
assert.deepEqual([...priorityGrid.matchAll(/<small>([^<]+)<\/small>/g)].map(m => m[1]),
  ['Próxima gestión', 'Último seguimiento', 'Cierre estimado', 'Contacto decisor']);
assert.ok(!/opportunity-insight-card (blue|green|amber|purple)/.test(priorityGrid));
for (const removed of ['label="Área comercial"', 'label="Próxima acción"', 'label="Estado próxima gestión"', 'label="Días sin seguimiento"', 'label="Decisor"', 'label="Correo decisor"', 'label="Teléfono"']) {
  assert.ok(!priorityGrid.includes(removed), `${removed} no debe sobrevivir en el resumen`);
}

// 4) valores derivados
assert.match(main, /const locationChip = \[o\.quote_city, o\.sede\]/);
assert.match(main, /const decisionMakerSummary = \[o\.decision_maker_name, o\.decision_maker_email, o\.decision_maker_phone\][\s\S]{0,120}'Por completar'/);

// 5) Datos comerciales y Línea de seguimientos desaparecen
assert.ok(!main.includes('Panel title="Datos comerciales"'));
assert.ok(!main.includes('Panel title="Línea de seguimientos"'));
assert.ok(!main.includes('<Dt label='), 'Dt deja de usarse (el componente se conserva sin cambios)');

// 6) Seguimiento comercial: formulario primero en el DOM, historial después, antes del copiloto
const section = main.indexOf('<h2 className="followup-section-title">Seguimiento comercial</h2>');
const formSlot = main.indexOf('followup-form-slot', section);
const history = main.indexOf('<Panel title="Historial de seguimiento" className="followup-history">', section);
const copilot = main.indexOf('canRenderOpportunityCopilot(data.currentProfile, o.service_type_code)', history);
const moreInfo = main.indexOf('<summary>Más información</summary>', copilot);
assert.ok(section > 0 && section < formSlot && formSlot < history && history < copilot && copilot < moreInfo,
  'orden: sección → formulario → historial → copiloto → Más información');
assert.match(main, /id="opportunity-follow-up" className="opportunity-follow-up-anchor followup-form-slot" tabIndex=\{-1\} ref=\{followUpRef\}/);
assert.match(main, /<div className="timeline followup-timeline">/);
assert.match(main, /<strong>\{followUpInteractionTypeLabel\(i\.interaction_type\)\}<\/strong>/);
assert.match(main, /\{i\.actor_label \|\| i\.psi_sales_profiles\?\.full_name \|\| 'Migrado \/ sistema'\}/);
assert.ok(main.includes('Sin seguimientos registrados.'));

// 7) Más información
assert.match(main, /\{o\.service_type_code !== 'licitacion_publica' && <details className="opportunity-more-info">/);
const detailsStart = main.indexOf('opportunity-more-info');
const details = main.slice(detailsStart, main.indexOf('</details>}', detailsStart));
for (const label of ['Fecha creación', 'Área comercial', 'Sector', 'ID legacy', 'Hoja origen', 'Estado original']) {
  assert.ok(details.includes(`label="${label}"`), `Más información debe incluir ${label}`);
}
assert.ok(!details.includes('observaciones'), 'observaciones nunca aparece en Más información');
for (const guard of ['{legacyId &&', '{legacySheet &&', '{legacyStatus &&']) assert.ok(details.includes(guard));

// 8) FollowUpForm: copy nuevo, mecánica intacta
const followUp = main.slice(main.indexOf('function FollowUpForm('), main.indexOf('\nconst publicActuationOptions'));
assert.match(main, /const FOLLOW_UP_NOTES_PLACEHOLDER = 'Resultado de la gestión\\nAcuerdos o compromisos\\nSiguiente paso';/);
assert.match(followUp, /<p className="followup-form-hint">Este registro alimenta el historial comercial y las recomendaciones de \{VIGIA_VISIBLE_NAMES\.commercial\}\. Describa hechos, acuerdos, responsables y el siguiente paso\.<\/p>/);
assert.match(followUp, /<textarea required placeholder=\{FOLLOW_UP_NOTES_PLACEHOLDER\}/);
assert.ok(!followUp.includes('placeholder="Registre el resultado'));
assert.ok(!followUp.includes('minLength'), 'no se agregan validaciones nuevas al formulario');
assert.ok(!/VIG-IA/.test(main), 'la identidad visible se interpola, nunca se escribe literal');

// 9) CSS aditivo
for (const rule of [
  '.hero-chip-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}',
  '.opportunity-priority-grid .opportunity-insight-card strong{',
  '.followup-section-title{', '.followup-section-grid{', '.followup-section-grid>.followup-history{order:1',
  '.followup-section-grid>.followup-form-slot{order:2', '.followup-timeline .event strong{text-transform:none}',
  '.followup-form-hint{', '.opportunity-more-info>summary{', '.opportunity-more-info>.grid{',
  '@media(max-width:760px){.followup-section-grid{grid-template-columns:1fr}',
]) assert.ok(css.includes(rule), `styles.css debe incluir ${rule}`);
assert.ok(css.includes('.event strong{text-transform:capitalize}'), 'la regla global compartida no se toca');
assert.match(css, /\.followup-section-grid\{[^}]*grid-template-columns:minmax\(0,3fr\) minmax\(280px,2fr\)/);

console.log('agt003 follow-up priority layout static checks passed');
