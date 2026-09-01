import fs from 'node:fs';
import assert from 'node:assert/strict';

const config = fs.readFileSync('vite.config.ts', 'utf8');

assert.doesNotMatch(config, /\bmanualChunks\b/, 'manualChunks está deprecado en Rolldown; usa build.rolldownOptions.output.codeSplitting.');
assert.doesNotMatch(config, /\badvancedChunks\b/, 'advancedChunks está deprecado en Rolldown; usa build.rolldownOptions.output.codeSplitting.');
assert.doesNotMatch(config, /\bchunkSizeWarningLimit\b/, 'chunkSizeWarningLimit no debe tocarse: el warning de >500 kB debe permanecer visible, no oculto ni elevado.');

assert.match(
  config,
  /rolldownOptions\s*:\s*\{[\s\S]*?output\s*:\s*\{[\s\S]*?codeSplitting\s*:\s*\{/,
  'build.rolldownOptions.output.codeSplitting (API vigente de Rolldown 1.1.5) debe estar configurado como objeto.'
);

const groupsMatch = config.match(/groups\s*:\s*\[([\s\S]*?)\n\s*\],?\s*\n\s*\}/);
assert.ok(groupsMatch, 'codeSplitting.groups debe existir como arreglo de CodeSplittingGroup.');
const groupsSource = groupsMatch[1];

function extractGroup(source, name) {
  const start = source.indexOf(`name: '${name}'`);
  assert.ok(start !== -1, `codeSplitting.groups debe incluir un grupo determinista con name: '${name}'.`);
  const end = source.indexOf('},', start);
  return source.slice(start, end === -1 ? source.length : end);
}

// Portable separator: rolldown docs recommend `[\\/]` (matches literal `\` or `/`)
// over a bare `/`, so paths resolve the same on POSIX and Windows.
const PORTABLE_SEP = '[' + '\\' + '\\' + '/' + ']';

const vendorGroup = extractGroup(groupsSource, 'vendor');
assert.ok(vendorGroup.includes('node_modules'), "el grupo 'vendor' debe filtrar node_modules.");
assert.ok(vendorGroup.includes(PORTABLE_SEP), "el grupo 'vendor' debe usar un separador de ruta portable ([\\/]) en su regex test.");

for (const dir of ['tenders', 'siio', 'vigia']) {
  const group = extractGroup(groupsSource, dir);
  assert.ok(group.includes(`src${PORTABLE_SEP}${dir}`), `el grupo '${dir}' debe filtrar src/${dir} con separador portable.`);
  assert.ok(group.includes(PORTABLE_SEP), `el grupo '${dir}' debe usar un separador de ruta portable ([\\/]) en su regex test.`);
}

console.log('vite bundle code splitting static checks passed');
