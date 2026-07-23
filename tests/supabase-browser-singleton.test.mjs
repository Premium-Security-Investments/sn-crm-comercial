import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.tsx?$/.test(entry.name) ? [target] : [];
  });
}

const clientCreations = sourceFiles(src).flatMap(file => {
  const contents = fs.readFileSync(file, 'utf8');
  return [...contents.matchAll(/\bcreateClient\s*\(/g)].map(match => ({
    file: path.relative(root, file),
    offset: match.index,
  }));
});

assert.deepEqual(
  clientCreations.map(entry => entry.file),
  ['src/supabaseBrowser.ts'],
  'El frontend debe crear exactamente un cliente Supabase compartido para evitar múltiples GoTrueClient con la misma sesión.',
);

const singleton = fs.readFileSync(path.join(src, 'supabaseBrowser.ts'), 'utf8');
assert.match(singleton, /export const supabaseBrowser\s*=\s*createClient\s*\(/);

const main = fs.readFileSync(path.join(src, 'main.tsx'), 'utf8');
const tenderConfiguration = fs.readFileSync(path.join(src, 'tenders', 'TenderConfigurationView.tsx'), 'utf8');
assert.match(main, /import \{ supabaseBrowser \} from '\.\/supabaseBrowser';/);
assert.match(tenderConfiguration, /import \{ supabaseBrowser \} from '\.\.\/supabaseBrowser';/);
assert.doesNotMatch(main, /import \{[^}]*createClient[^}]*\} from '@supabase\/supabase-js';/);
assert.doesNotMatch(tenderConfiguration, /import \{[^}]*createClient[^}]*\} from '@supabase\/supabase-js';/);

console.log('Supabase browser singleton contract OK');
