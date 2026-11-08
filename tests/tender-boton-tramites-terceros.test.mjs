// Juan, 2026-11-08: botón «Crear trámites con terceros» en Preparar para las licitaciones con GO anterior a la mejora 3
// (Fiscalía, Manizales). Usa la misma siembra idempotente del GO; sólo aparece si hay requisitos y ningún trámite.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const view = readFileSync(new URL('../src/tenders/workspace/TenderWorkspace.tsx', import.meta.url), 'utf8');

test('el botón aparece sólo con requisitos y sin trámites, y usa la siembra del GO', () => {
  const block = view.slice(view.indexOf('hasRequirementItems && report && !workspace.checklist.some(item => item.item_key.startsWith(TRAMITE_ITEM_KEY_PREFIX))'));
  assert.ok(block.length > 0, 'condición del botón');
  assert.match(block.slice(0, 600), />Crear trámites con terceros</);
  assert.match(block.slice(0, 600), /onClick=\{\(\) => void seed\(\)\}/);
});

test('si el análisis no pide trámites, lo dice en vez de quedarse callado', () => {
  assert.match(view, /result\.tramites === 0\) setSeedNote\('El análisis de esta licitación no pide trámites con terceros que falten\.'\)/);
  // El estado va con los demás hooks, antes del primer return condicional.
  assert.ok(view.indexOf("const [seedNote, setSeedNote] = useState('')") < view.indexOf('if (!workspace) return'));
});
