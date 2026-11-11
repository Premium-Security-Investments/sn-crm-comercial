// Decidir más fácil de leer (Juan, 2026-11-11: «muy saturadas de texto… espacios entre frases y párrafos»). Sólo
// presentación: el texto de Vig-IA no cambia, se parte para leerlo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paragraphs, recommendationParts, sentences } from '../src/tenders/readableText.ts';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('la recomendación de Fiscalía sale como titular y puntos', () => {
  const { lead, points } = recommendationParts('Solo en unión temporal: sin sede ni agencia autorizada en Armenia (resolución pendiente) ni en Quibdó; el socio debería aportar presencia con licencia de la SuperVigilancia en ambas ciudades. La empresa cumple las modalidades de licencia y los tres códigos exigidos, y el cierre es el 12 de noviembre de 2026.');
  assert.equal(lead, 'Solo en unión temporal');
  assert.deepEqual(points, [
    'Sin sede ni agencia autorizada en Armenia (resolución pendiente) ni en Quibdó.',
    'El socio debería aportar presencia con licencia de la SuperVigilancia en ambas ciudades.',
    'La empresa cumple las modalidades de licencia y los tres códigos exigidos, y el cierre es el 12 de noviembre de 2026.',
  ]);
  assert.deepEqual(recommendationParts('Esperar a confirmar el RUP.'), { lead: 'Esperar a confirmar el RUP.', points: [] });
});

test('las frases no se cortan en abreviaturas ni en números', () => {
  assert.deepEqual(sentences('La Adenda Nº 1 confirma 14.985 SMMLV. Falta el RUP.'), ['La Adenda Nº 1 confirma 14.985 SMMLV.', 'Falta el RUP.']);
  assert.deepEqual(sentences('Ver el art. 5 del pliego. Luego.'), ['Ver el art. 5 del pliego.', 'Luego.']);
  assert.deepEqual(paragraphs('Corto.'), ['Corto.']);
  assert.equal(paragraphs('x'.repeat(150) + '. ' + 'Y'.repeat(150) + '.').length, 2);
});

test('Decidir usa el titular, las frases sueltas, las fuentes plegadas y los avisos como etiquetas', () => {
  const workspace = read('src/tenders/workspace/TenderWorkspace.tsx');
  assert.match(workspace, /<RecommendationText text=\{initialReportRecommendationText\(report\.recommendation\.label\)\} \/>/);
  assert.match(workspace, /<summary>Fuentes \(\{row\.sources\.length\}\)<\/summary>/);
  assert.doesNotMatch(read('src/tenders/workspace/TenderManualReanalysis.tsx'), /className="tw-reanalysis-changes" open>/);
  assert.match(read('src/tenders/components/TenderAllyCandidates.tsx'), /className="tw-ally-tag"/);
});
