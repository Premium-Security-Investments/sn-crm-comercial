import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

// AGT-003 approved adjustment (TDD RED): rename the visible "Activos aprobados"
// heading to "Adjuntos sugeridos" and render the whole section only when
// brief.recommended_asset_ids.length > 0. When the array is empty, neither the
// heading nor the previous fallback text ("No hay activos aprobados
// recomendados.") should render. The recommended_asset_ids contract, the asset
// catalog, the runtime, and every other section must stay untouched.
const component = readFileSync(new URL('../src/vigia/VigiaOpportunityCopilot.tsx', import.meta.url), 'utf8');

assert.equal(
  component.includes('Activos aprobados'),
  false,
  'el encabezado "Activos aprobados" debe reemplazarse por "Adjuntos sugeridos"',
);
assert.ok(
  component.includes('>Adjuntos sugeridos<'),
  'debe existir el nuevo encabezado exacto "Adjuntos sugeridos"',
);
assert.equal(
  component.includes('No hay activos aprobados recomendados.'),
  false,
  'el texto de estado vacío "No hay activos aprobados recomendados." ya no debe renderizarse',
);

// The section (heading + list) must be gated behind a `.length > 0 &&` guard so
// that an empty recommended_asset_ids array renders nothing at all, instead of
// the previous ternary that always rendered the heading plus an empty-state <p>.
assert.match(
  component,
  /\{brief\.recommended_asset_ids\.length > 0 && <section><h4>Adjuntos sugeridos<\/h4><ul>\{brief\.recommended_asset_ids\.map\(id => <li key=\{id\}>\{id\}<\/li>\)\}<\/ul><\/section>\}/,
  'la sección de adjuntos sugeridos debe montarse solo cuando brief.recommended_asset_ids.length > 0, sin heading ni texto de vacío en caso contrario',
);

// The contract key itself must remain unchanged elsewhere in the component
// (e.g. the state typing usage), only the visible copy/conditional changes.
assert.ok(
  component.includes('brief.recommended_asset_ids'),
  'el contrato recommended_asset_ids no debe modificarse',
);

console.log('Vig-IA opportunity copilot suggested-attachments static contract passed');
