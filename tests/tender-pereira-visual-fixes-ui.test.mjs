import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const projectionPath = new URL('../src/tenders/components/TenderOperationalPendingProjection.tsx', import.meta.url);
const main = read('src/main.tsx');
const styles = read('src/styles.css');
const axis = read('src/tenders/components/TenderDecisionAxisSurface.tsx');
const axisStyles = read('src/tenders/components/tender-decision-axis-surface.css');
const navigation = read('src/tenders/components/TenderDetailNavigation.tsx');
const analysis = read('src/tenders/components/TenderAnalysisSection.tsx');

test('proyección compartida: Análisis posee la lista y Decisión sólo el puntero', () => {
  assert.equal(existsSync(projectionPath), true, 'Debe existir un componente compartido para los pendientes V3.');
  const projection = existsSync(projectionPath) ? read('src/tenders/components/TenderOperationalPendingProjection.tsx') : '';
  assert.match(projection, /export function TenderOperationalPendingProjection/);
  assert.match(analysis, /<TenderOperationalPendingProjection/);
  assert.doesNotMatch(axis, /function OperationalPendingCard|function OperationalPendingProjection/);
  assert.doesNotMatch(axis, /<TenderOperationalPendingProjection/);
  assert.match(axis, /focusTenderDetailSection\(document\.getElementById\('tender-analysis'\)\)/);
});

test('ids, foco, navegación e intersección permanecen en los seis contenedores canónicos', () => {
  assert.match(main, /id="tender-analysis"[^>]*tabIndex=\{-1\}/);
  assert.match(main, /id="tender-decision"[^>]*tabIndex=\{-1\}/);
  assert.doesNotMatch(main, /id="tender-decision-operational-pending"/);
  assert.match(navigation, /createTenderDetailSectionObserver/);
  assert.match(navigation, /TENDER_DETAIL_SECTIONS[\s\S]*?resolveElement/);
  assert.match(styles, /#tender-analysis:focus-visible/);
});

test('Resumen y control formal usan densidad acotada, también en responsive', () => {
  assert.match(main, /className="tender-summary-anchor tender-detail-anchor"/);
  assert.match(main, /<Panel title="Resumen de la oportunidad" className="tender-opportunity-summary-panel">/);
  assert.match(styles, /\.tender-opportunity-summary-panel\{/);
  assert.match(axisStyles, /\.tender-decision-axis-formal \.tender-go-no-go-panel\s*\{/);
  assert.match(axisStyles, /@media \(max-width: 640px\)[\s\S]*?tender-decision-axis-formal/);
});

test('timeline presenta el copy correcto sin reescribir historial', () => {
  assert.match(main, /converted: 'Convertida en oportunidad'/);
  assert.doesNotMatch(main, /Convertida En Oportunidad/);
  assert.match(main, /className="timeline tender-business-timeline"/);
  assert.match(styles, /\.tender-business-timeline \.event strong\{text-transform:none\}/);
});

test('Guardar actuación explica el requisito vacío sin cambiar la validación', () => {
  assert.match(main, /id="tender-follow-up-note"[^>]*required[^>]*aria-describedby=\{!note\.trim\(\) \? 'tender-follow-up-note-help' : undefined\}/);
  assert.match(main, /id="tender-follow-up-note-help"[^>]*>Escriba una descripción para habilitar Guardar actuación\./);
  assert.match(main, /<button disabled=\{!note\.trim\(\)\}>Guardar actuación<\/button>/);
});
