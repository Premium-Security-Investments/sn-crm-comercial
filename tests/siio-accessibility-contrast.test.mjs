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
const eyebrowRule = styles.match(/\.siio-eyebrow\{[^}]*\}/)?.[0] || '';
assert.match(eyebrowRule, /color:#1e40af/, 'the SIIO eyebrow token must keep its AA-compliant text color');
assert.match(eyebrowRule, /background:#dbeafe/, 'the SIIO eyebrow token must keep its AA-compliant background');
assert.match(eyebrowRule, /display:inline-flex/, 'the SIIO eyebrow token must be a self-contained visual token, not just a color pair');
assert.match(eyebrowRule, /padding:/, 'the SIIO eyebrow token must define its own padding');
assert.match(eyebrowRule, /border-radius:/, 'the SIIO eyebrow token must define its own shape');
assert.match(eyebrowRule, /font-size:/, 'the SIIO eyebrow token must define its own type scale');
assert.match(eyebrowRule, /font-weight:/, 'the SIIO eyebrow token must define its own weight');
assert.match(styles, /\.siio-secondary\{color:#475569\}/, 'the SIIO secondary text token must be defined locally with an AA-compliant color');

const executive = readFileSync(new URL('../src/siio/SiioExecutiveView.tsx', import.meta.url), 'utf8');
const tracking = readFileSync(new URL('../src/siio/SiioManagementTrackingView.tsx', import.meta.url), 'utf8');
const intelligence = readFileSync(new URL('../src/siio/SiioSourcesIntelligenceView.tsx', import.meta.url), 'utf8');
const agentsView = readFileSync(new URL('../src/siio/SiioAgentsView.tsx', import.meta.url), 'utf8');

for (const [name, source] of [['SiioExecutiveView', executive], ['SiioSourcesIntelligenceView', intelligence], ['SiioAgentsView', agentsView]]) {
  assert.match(source, /siio-eyebrow/, `${name} must use the locally-contrasted siio-eyebrow token`);
  assert.doesNotMatch(source, /className="eyebrow"/, `${name} must not render the low-contrast global eyebrow on a light SIIO surface`);
}
assert.match(tracking, /siio-secondary/, 'SiioManagementTrackingView must use the locally-contrasted siio-secondary token for secondary text');

assert.ok(contrast('#ffffff', '#1b64f2') >= 4.5, 'white text must meet WCAG AA against the management-signal button gradient start');
assert.ok(contrast('#ffffff', '#174ea6') >= 4.5, 'white text must meet WCAG AA against the management-signal button gradient end');

const managementSignalsWhiteRules = [...styles.matchAll(/\.siio-management-signals[^{}]*\{[^}]*\}/g)]
  .map(match => match[0])
  .filter(rule => /:not\(\.siio-management-signal-static\)/.test(rule) && /color:#fff\b/.test(rule));
assert.ok(managementSignalsWhiteRules.length >= 1, 'a CSS rule must force white text on the blue management-signal buttons while excluding the non-clickable payroll alert card');
const managementSignalsWhiteRuleText = managementSignalsWhiteRules.join(' ');
assert.doesNotMatch(managementSignalsWhiteRuleText, /opacity/, 'the white contrast fix must not be undermined by an opacity rule');

console.log('SIIO accessibility contrast contract OK');
