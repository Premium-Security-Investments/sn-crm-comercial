import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const vigia = fs.readFileSync(new URL('../src/vigia/VigiaCommercial.tsx', import.meta.url), 'utf8');

// main.tsx: the CRM opportunity list and detail summary must render the date-only
// `expected_close_date` field with the new timezone-safe formatter, not the generic
// `fmtDate` (which wraps `new Date(value)` and mis-renders date-only Postgres columns
// one day early in zones behind UTC, e.g. America/Bogota).
assert.match(main, /import\s*\{[^}]*formatDateOnly[^}]*\}\s*from\s*['"]\.\/dateOnly['"]/, 'main.tsx must import formatDateOnly from ./dateOnly');
assert.doesNotMatch(main, /fmtDate\(o\.expected_close_date\)/, 'expected_close_date must no longer be rendered through the timestamp-oriented fmtDate helper');
const expectedCloseDateRenderSites = main.match(/fmtDateOnly\(o\.expected_close_date\)/g) || [];
assert.ok(expectedCloseDateRenderSites.length >= 3, `Expected at least 3 expected_close_date render sites (list row + 2 detail Info fields) using fmtDateOnly, found ${expectedCloseDateRenderSites.length}`);

// Timestamp fields must keep using fmtDate untouched — this bug fix must not change
// created_at (or other true timestamp) rendering.
assert.match(main, /fmtDate\(o\.created_at\)/, 'created_at rendering must remain on fmtDate (unchanged)');
assert.match(main, /fmtDate\(o\.last_interaction_at\)/, 'last_interaction_at rendering must remain on fmtDate (unchanged)');
assert.match(main, /fmtDate\(o\.next_action_at\)/, 'next_action_at rendering must remain on fmtDate (unchanged)');

// VigiaCommercial.tsx: the "Cierre esperado" deadline display must use the same
// timezone-safe formatter for expected_close_date, while the as_of timestamp keeps
// using the existing displayDate helper.
assert.match(vigia, /import\s*\{[^}]*formatDateOnly[^}]*\}\s*from\s*['"]\.\.\/dateOnly['"]/, 'VigiaCommercial.tsx must import formatDateOnly from ../dateOnly');
assert.doesNotMatch(vigia, /displayDate\(priority\.evidence\.expected_close_date\)/, 'expected_close_date must no longer be rendered through the timestamp-oriented displayDate helper');
assert.match(vigia, /Cierre esperado: \{displayDateOnly\(priority\.evidence\.expected_close_date\)\}/, 'Cierre esperado must render expected_close_date via displayDateOnly');
assert.match(vigia, /displayDate\(payload\?\.source\.as_of \|\| null\)/, 'as_of timestamp rendering must remain on displayDate (unchanged)');

console.log('Opportunity list/summary and VigiaCommercial deadline display use the date-only formatter for expected_close_date only');
