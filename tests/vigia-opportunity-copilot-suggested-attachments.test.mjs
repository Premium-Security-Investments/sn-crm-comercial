import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

// AGT-003 — contrato estático de "Adjuntos sugeridos": la sección sólo se monta
// cuando la presentación defensiva (`copilot-presentation.ts`) indica activos
// aprobados, nunca por acceso directo al brief crudo. El comportamiento de
// renderizado (vacío vs. con activos) ya se verifica end-to-end en
// tests/agt003-copilot-proposal-render.test.mjs; este test sólo fija los
// marcadores estructurales que ese comportamiento requiere, sin acoplarse al
// markup exacto (tag de heading, espaciado, etc.).
const component = readFileSync(new URL('../src/vigia/VigiaOpportunityCopilot.tsx', import.meta.url), 'utf8');
const presentation = readFileSync(new URL('../src/vigia/copilot-presentation.ts', import.meta.url), 'utf8');

assert.equal(
  component.includes('Activos aprobados'),
  false,
  'el encabezado "Activos aprobados" no debe reaparecer: la copia visible es "Adjuntos sugeridos"',
);
assert.ok(
  component.includes('>Adjuntos sugeridos<'),
  'debe existir el encabezado visible "Adjuntos sugeridos"',
);
assert.equal(
  component.includes('No hay activos aprobados recomendados.'),
  false,
  'el texto de estado vacío "No hay activos aprobados recomendados." no debe renderizarse',
);

// La sección debe montarse condicionada al flag defensivo `hasApprovedAssets`,
// no a un acceso directo `brief.recommended_asset_ids.length > 0` en el JSX.
assert.ok(
  component.includes('presented.hasApprovedAssets &&'),
  'el montaje de "Adjuntos sugeridos" debe depender de presented.hasApprovedAssets, no de un acceso directo al brief',
);
assert.equal(
  /\{brief\.recommended_asset_ids\.length > 0/.test(component),
  false,
  'el JSX no debe acceder directamente a brief.recommended_asset_ids.length; debe usar la presentación defensiva',
);

// Los ids listados deben venir de la presentación (recommendedAssetIds), e iterarse con map.
assert.ok(
  component.includes('presented.recommendedAssetIds.map('),
  'los ids sugeridos deben iterarse desde presented.recommendedAssetIds',
);

// La presentación defensiva debe derivar el flag a partir del contrato recommended_asset_ids,
// que no debe modificarse.
assert.ok(
  presentation.includes('brief.recommended_asset_ids'),
  'el contrato recommended_asset_ids no debe modificarse en la capa de presentación',
);
assert.ok(
  presentation.includes('hasApprovedAssets: recommendedAssetIds.length > 0'),
  'hasApprovedAssets debe derivarse de recommended_asset_ids.length > 0',
);

console.log('Vig-IA opportunity copilot suggested-attachments static contract passed');
