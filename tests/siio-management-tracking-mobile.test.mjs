import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tracking = readFileSync(new URL('../src/siio/SiioManagementTrackingView.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

assert.match(tracking, /const visibleItems = useMemo/, 'Tracking must derive a single named visibleItems collection shared by desktop and mobile views');
assert.equal((tracking.match(/visibleItems\.length/g) || []).length, 1, 'The empty-state check must reference the single visibleItems collection, not a duplicate');
assert.equal((tracking.match(/visibleItems\.map/g) || []).length, 2, 'Tracking must render exactly one desktop table and one mobile card presentation of the same visibleItems, no duplicated derivation');

assert.match(tracking, /siio-management-table/, 'Tracking view must mark the desktop table for responsive hiding');
assert.match(tracking, /siio-management-cards/, 'Tracking view must render mobile management cards');

const cardsBlock = tracking.match(/<div className="siio-management-cards">[\s\S]*?<\/article>\)\}<\/div>/)?.[0] || '';
assert.ok(cardsBlock, 'Mobile management cards block must exist inside the tracking panel');
for (const field of ['Tipo', 'Asunto', 'Frente', 'Responsable', 'Estado', 'Vigencia', 'Semáforo', 'Próxima acción', 'Fecha disponible']) {
  assert.match(cardsBlock, new RegExp(field), `Mobile management cards must preserve the "${field}" field shown in the desktop table`);
}
assert.match(cardsBlock, /item\.kind/, 'Mobile cards must reuse the same item fields as the desktop table (kind)');
assert.match(cardsBlock, /item\.title/, 'Mobile cards must reuse the same item fields as the desktop table (title)');
assert.match(cardsBlock, /item\.frontId/, 'Mobile cards must reuse the same item fields as the desktop table (frontId)');
assert.match(cardsBlock, /item\.owner/, 'Mobile cards must reuse the same item fields as the desktop table (owner)');
assert.match(cardsBlock, /item\.status/, 'Mobile cards must reuse the same item fields as the desktop table (status)');
assert.match(cardsBlock, /ACTIVITY_TONES\[item\.activityState\]/, 'Mobile cards must reuse the same activity-state derivation as the desktop table');
assert.match(cardsBlock, /item\.semaphore/, 'Mobile cards must reuse the same item fields as the desktop table (semaphore)');
assert.match(cardsBlock, /item\.nextAction/, 'Mobile cards must reuse the same item fields as the desktop table (nextAction)');
assert.match(cardsBlock, /fmtSiioDate\(item\.dueDate\)/, 'Mobile cards must reuse the same date formatting as the desktop table');

assert.match(styles, /\.siio-management-cards\{display:none\}/, 'Management cards must be hidden by default on desktop');
assert.match(styles, /@media\(max-width:760px\)[\s\S]*\.siio-management-table\{display:none\}/, 'Mobile must hide the desktop management table');
assert.match(styles, /@media\(max-width:760px\)[\s\S]*\.siio-management-cards\{display:grid[^}]*\}/, 'Mobile must show the management cards');
assert.match(styles, /\.siio-management-card\{/, 'Management card style token must be defined');

console.log('SIIO management tracking mobile cards contract OK');
