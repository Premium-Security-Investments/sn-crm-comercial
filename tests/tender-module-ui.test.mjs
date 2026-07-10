import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const source = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert.match(source, /tender-subnav/, 'Licitaciones debe renderizar un submenú desplegable en el menú izquierdo');
assert.match(source, /Radar de oportunidades/, 'El submenú debe incluir Radar de oportunidades');
assert.match(source, /Seguimiento/, 'El submenú debe incluir Seguimiento');
assert.match(source, /Expedientes/, 'El submenú debe incluir Expedientes');
assert.match(source, /Perfiles de búsqueda/, 'El submenú debe incluir Perfiles de búsqueda');
assert.match(source, /regionFilter/, 'El módulo debe tener estado de filtro por región');
assert.match(source, /Región SN/, 'La vista debe exponer un filtro Región SN');
assert.match(source, /BOG - Bogotá\/Cundinamarca/, 'Los perfiles deben contemplar regiones donde SN tiene presencia');
assert.match(source, /tenderMatchesRegion\(t, regionFilter\)/, 'El filtro regional debe aplicarse a la lista de licitaciones');

console.log('Tender module UI expectations passed');
