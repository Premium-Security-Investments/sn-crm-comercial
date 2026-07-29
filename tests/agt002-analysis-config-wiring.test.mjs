import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../tender-processing-worker.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const vercel = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');

assert.match(worker, /analysisConfig\s*=\s*Object\.freeze\(\{\}\)/, 'worker must accept an injected config with a behavior-neutral default');
assert.match(server, /import \{ buildAgt002AnalysisConfig \} from '\.\.\/agt002-analysis-config\.js';/, 'backend must import the centralized config builder');
assert.match(server, /const agt002AnalysisConfig = buildAgt002AnalysisConfig\(process\.env\);/, 'backend must build config once at startup');
assert.match(server, /analysisConfig:\s*agt002AnalysisConfig,/, 'real worker dependencies must receive the centralized config');
assert.equal(vercel, server, 'server/index.js and api/[...path].js must remain byte-identical');

console.log('agt002 analysis config wiring contract passed');
