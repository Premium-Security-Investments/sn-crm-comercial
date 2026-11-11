// Punto 4 del encargo de Aliados (Juan, 2026-11-11: «sería útil para procesos futuros… no estamos haciendo mejoras para
// un proceso sino para todo lo que venga»): combinaciones de dos socios cuando ninguno solo cubre las ciudades.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rankAllyPairs } from '../verticales/licitaciones/tender-allies.js';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const city = key => ({ city: key.toUpperCase(), city_key: key });
const company = (nit, name, cities, role = 'sin_clasificar', participations = []) => ({ nit, name, role, cities: cities.map(city), participations });

test('si ningún socio solo cubre Armenia y Quibdó, propone parejas, sin repetir socio', () => {
  const companies = [
    company('1', 'CUANGARE', ['quibdo']),
    company('2', 'GRANADINA', ['armenia'], 'aliado_potencial'),
    company('3', 'ATLAS', ['armenia', 'cali']),
    company('4', 'CHOCOANA', ['quibdo', 'medellin'], 'competidor'),
  ];
  const pairs = rankAllyPairs(companies, { cityKeys: ['armenia', 'quibdo'] });
  assert.deepEqual(pairs.map(pair => [pair.first.name, pair.second.name]), [['GRANADINA', 'CUANGARE'], ['ATLAS', 'CHOCOANA']]);
  assert.deepEqual(pairs[0].first.covered, ['ARMENIA']);
});

test('si alguno solo cubre todo, o falta una sola ciudad, no hay parejas', () => {
  assert.deepEqual(rankAllyPairs([company('1', 'SOLO', ['armenia', 'quibdo']), company('2', 'OTRO', ['quibdo'])], { cityKeys: ['armenia', 'quibdo'] }), []);
  assert.deepEqual(rankAllyPairs([company('1', 'A', ['armenia'])], { cityKeys: ['armenia'] }), []);
  assert.deepEqual(rankAllyPairs([company('1', 'A', ['cali']), company('2', 'B', ['quibdo'])], { cityKeys: ['armenia', 'quibdo'] }), []);
});

test('sólo donde se puede sumar: se_suma, o la lista «sólo si la Entidad acepta»; Decidir y la Mesa las muestran', () => {
  const board = read('verticales/licitaciones/tender-allies-board.js');
  assert.match(board, /pairs: reading\?\.mode === 'se_suma' \? pairs\(missing\) : \[\]/);
  assert.match(board, /alternative: \{ label: ALTERNATIVE_LABEL, cities: sum\.cities, candidates: others, pairs: pairs\(missing\) \}/);
  assert.match(read('src/tenders/components/TenderAllyCandidates.tsx'), /<PairList pairs=\{data\.pairs\}/);
  assert.match(read('catalogo-fuentes.js'), /combinaciones: Object\.freeze\(\(board\.pairs \|\| \[\]\)/);
});
