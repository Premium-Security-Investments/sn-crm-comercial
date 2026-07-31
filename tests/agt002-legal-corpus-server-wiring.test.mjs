import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../agt002-preview-runtime.js', import.meta.url), 'utf8');

function count(source, token) {
  return source.split(token).length - 1;
}

assert.equal(server, api, 'server/index.js y api/[...path].js deben permanecer byte-idénticos');
assert.match(server, /import \{ loadPublishedAgt002LegalCorpus \} from '\.\.\/agt002-legal-corpus-store\.js';/);
assert.equal(count(server, 'await loadAgt002LegalCorpusContextIfEnabled(database)'), 3, 'los tres flujos canónicos deben cargar el corpus antes del claim');
assert.equal(count(server, 'legalCorpusVersionId: legalCorpusContext?.legal_corpus_version_id'), 3, 'las tres claves deben ligarse al UUID publicado');
assert.equal(count(server, 'legalCorpusContext,'), 3, 'los tres runtimes deben recibir el mismo contexto validado');
assert.doesNotMatch(runtime, /legal-corpus-v1\.json|readFileSync|readFile\(/, 'runtime E5 no puede leer fixtures locales');

for (const keyIndex of [...server.matchAll(/legalCorpusVersionId: legalCorpusContext\?\.legal_corpus_version_id/g)].map(match => match.index)) {
  const precedingLoad = server.lastIndexOf('await loadAgt002LegalCorpusContextIfEnabled(database)', keyIndex);
  const followingClaim = server.indexOf('claimAgt002PreviewRun(database', keyIndex);
  assert.ok(precedingLoad >= 0 && precedingLoad < keyIndex, 'el corpus debe cargarse antes de calcular la clave');
  assert.ok(followingClaim > keyIndex, 'la clave ligada al corpus debe calcularse antes del claim');
}

console.log('AGT-002 E5 production server wiring contract passed');
