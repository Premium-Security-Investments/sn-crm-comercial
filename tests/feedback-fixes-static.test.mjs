import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');

assert(src.includes('/api/opportunity-detail?id='), 'Opportunity detail must use Vercel-safe single-segment API alias');
assert(api.includes("app.get('/api/opportunity-detail'"), 'API must expose opportunity-detail alias');
assert(!src.includes('} B`'), 'Compact money must not use B/billones for COP');
assert(src.includes("return name.charAt(0).toUpperCase() + name.slice(1);"), 'Month names must be capitalized');
assert(src.includes('Concentración y avance del pipeline'), 'Manager dashboard must show the actionable stage pipeline table');
assert(src.includes('Ranking comercial ejecutivo'), 'Manager dashboard must include executive commercial scorecards');
assert(css.includes('.stage-action-table'), 'Dashboard actionable stage table CSS must exist');
assert(css.includes('.filters input,.filters select{font-size:13px'), 'Opportunity filters must use smaller text');

console.log('feedback-fixes-static: ok');
