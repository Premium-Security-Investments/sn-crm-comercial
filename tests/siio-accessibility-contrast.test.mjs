import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function relativeLuminance(hex) {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = channel => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(foregroundHex, backgroundHex) {
  const l1 = relativeLuminance(foregroundHex);
  const l2 = relativeLuminance(backgroundHex);
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

assert.ok(contrast('#1e40af', '#dbeafe') >= 4.5, 'the SIIO eyebrow token must meet WCAG AA for normal text');
assert.ok(contrast('#475569', '#ffffff') >= 4.5, 'the SIIO secondary text token must meet WCAG AA for normal text');

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
assert.match(styles, /\.siio-eyebrow\{color:#1e40af;background:#dbeafe\}/, 'the SIIO eyebrow token must be defined locally with an AA-compliant color pair');
assert.match(styles, /\.siio-secondary\{color:#475569\}/, 'the SIIO secondary text token must be defined locally with an AA-compliant color');

const executive = readFileSync(new URL('../src/siio/SiioExecutiveView.tsx', import.meta.url), 'utf8');
const tracking = readFileSync(new URL('../src/siio/SiioManagementTrackingView.tsx', import.meta.url), 'utf8');
const intelligence = readFileSync(new URL('../src/siio/SiioSourcesIntelligenceView.tsx', import.meta.url), 'utf8');

for (const [name, source] of [['SiioExecutiveView', executive], ['SiioSourcesIntelligenceView', intelligence]]) {
  assert.match(source, /siio-eyebrow/, `${name} must use the locally-contrasted siio-eyebrow token`);
  assert.doesNotMatch(source, /className="eyebrow"/, `${name} must not render the low-contrast global eyebrow on a light SIIO surface`);
}
assert.match(tracking, /siio-secondary/, 'SiioManagementTrackingView must use the locally-contrasted siio-secondary token for secondary text');

console.log('SIIO accessibility contrast contract OK');
