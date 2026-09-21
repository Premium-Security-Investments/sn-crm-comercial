// AGT-002 / Vig-IA document preselection — TenderGovernedDocumentWorkset.tsx source integration
// regression. (.hermes/plans/2026-09-21-vigia-document-preselection.md)
//
// Pins that the preselection wiring applies buildAgt002RecommendedWorksetSelection exactly once
// per loaded package via a useRef guard inside a useEffect, surfaces "Sugerido por Vig-IA" plus
// explicit add/remove-freedom copy, never filters the rendered candidate list by recommendation,
// and preserves the existing explicit freeze confirmation and CTA copy untouched.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../src/tenders/components/TenderGovernedDocumentWorkset.tsx', import.meta.url), 'utf8');

// --- react imports: useEffect + useRef are required to apply a one-time preselection guard. ------
assert.match(component, /import \{[^}]*\buseEffect\b[^}]*\} from 'react'/s, "debe importar useEffect de 'react'");
assert.match(component, /import \{[^}]*\buseRef\b[^}]*\} from 'react'/s, "debe importar useRef de 'react'");

// --- imports/uses the future preselection builder. ------------------------------------------------
assert.match(component, /buildAgt002RecommendedWorksetSelection/, 'debe importar y usar buildAgt002RecommendedWorksetSelection');

// --- a ref-based guard proves the preselection is applied at most once per loaded package. -------
const effectStart = component.indexOf('useEffect(');
assert.notEqual(effectStart, -1, 'debe existir un useEffect que aplique la preselección de Vig-IA');
const effectBlock = component.slice(effectStart, effectStart + 800);
assert.match(effectBlock, /buildAgt002RecommendedWorksetSelection\(/, 'el useEffect debe invocar buildAgt002RecommendedWorksetSelection');
assert.match(effectBlock, /\.current/, 'el guard de aplicar-una-vez debe apoyarse en un ref (`.current`)');

// --- UI copy: explicit Vig-IA suggestion label + explicit add/remove freedom for Licitaciones. ---
assert.match(component, /Sugerido por Vig-IA/, 'debe mostrar la etiqueta "Sugerido por Vig-IA" junto al documento recomendado');
assert.match(component, /agregar o quitar|agregar y quitar|incluir o excluir/i, 'debe declarar explícitamente que Licitaciones puede agregar o quitar libremente');

// --- existing freeze confirmation and CTA copy must be preserved untouched. ----------------------
assert.match(component, /AGT002_GOVERNED_WORKSET_FREEZE_CONFIRMATION_COPY/, 'la confirmación explícita de congelamiento debe seguir presente');
assert.match(component, /Congelar paquete y ejecutar AGT-002/, 'el texto del botón de la corrida no debe cambiar');

// --- every current candidate is still mapped/rendered: preselection never filters the list. ------
assert.match(component, /candidates\.map\(document =>/, 'la lista completa de candidatos vigentes debe seguir renderizándose sin filtrar por recomendación');
assert.doesNotMatch(component, /candidates\.filter\([^)]*recommended/i, 'no debe filtrarse la lista de candidatos por analysis_suggestion.recommended');
assert.doesNotMatch(component, /candidates\.filter\([^)]*analysis_suggestion/i, 'no debe filtrarse la lista de candidatos por presencia/ausencia de analysis_suggestion');

// --- selectionScopeKey: the draft selection/confirmation must reset when the mounted component is
// reused across a different opportunity (same component instance, different scope), instead of
// silently carrying a stale selection or a stale "confirmed" checkbox across tenders. ----------
assert.match(component, /selectionScopeKey:\s*string;/, 'el contrato de props debe declarar selectionScopeKey: string');
assert.match(component, /function TenderGovernedDocumentWorkset\([^)]*\bselectionScopeKey\b[^)]*\)/s, 'el componente debe desestructurar selectionScopeKey de sus props');

// --- a ref keyed by selectionScopeKey tracks the last-applied scope. ------------------------------
assert.match(component, /\.current\s*=\s*selectionScopeKey/, 'debe existir un ref cuyo valor se actualiza a selectionScopeKey (el ref que rastrea el alcance vigente)');

// --- an effect reacting to selectionScopeKey changes clears selection + confirmation. -------------
const scopeEffectMatch = component.match(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?\},\s*\[[^\]]*selectionScopeKey[^\]]*\]\)/);
assert.notEqual(scopeEffectMatch, null, 'debe existir un useEffect con selectionScopeKey en su arreglo de dependencias');
const scopeEffectBody = scopeEffectMatch ? scopeEffectMatch[0] : '';
assert.match(scopeEffectBody, /\.current/, 'el efecto de cambio de alcance debe apoyarse en un ref (`.current`) para distinguir el primer render de un cambio real de alcance');
assert.match(scopeEffectBody, /setSelection\(\s*\{\s*\}\s*\)/, 'al cambiar selectionScopeKey debe limpiarse la selección (setSelection({}))');
assert.match(scopeEffectBody, /setConfirmed\(false\)/, 'al cambiar selectionScopeKey debe limpiarse la confirmación de congelamiento (setConfirmed(false))');

// --- TenderAnalysisSection must thread selectionScopeKey={opportunityId} through. -----------------
const section = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');
assert.match(
  section,
  /<TenderGovernedDocumentWorkset[\s\S]*?selectionScopeKey=\{opportunityId\}[\s\S]*?\/>/,
  'TenderAnalysisSection debe pasar selectionScopeKey={opportunityId} a TenderGovernedDocumentWorkset',
);

console.log('AGT-002 Vig-IA document preselection component integration contract passed');
