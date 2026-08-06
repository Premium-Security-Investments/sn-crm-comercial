import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';

const migrationsDir = new URL('../supabase/migrations/', import.meta.url);

test('Supabase migration numeric prefixes are unique', async () => {
  const files = (await readdir(migrationsDir))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();

  const byPrefix = new Map();
  for (const file of files) {
    const [prefix] = file.split('_', 1);
    const grouped = byPrefix.get(prefix) || [];
    grouped.push(file);
    byPrefix.set(prefix, grouped);
  }

  const duplicates = Object.fromEntries(
    [...byPrefix.entries()].filter(([, grouped]) => grouped.length > 1),
  );

  assert.deepEqual(
    duplicates,
    {},
    `Duplicate migration prefixes detected: ${JSON.stringify(duplicates)}`,
  );
});
