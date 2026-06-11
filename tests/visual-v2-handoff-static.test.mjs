import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const requiredMainMarkers = [
  'crm-v2-shell',
  'sidebar-logo-mark',
  'nav-section-label',
  'topbar-status',
  'CRM · Seguridad Nacional',
  'tender-score-ring',
  'score-ring-svg',
  'Marcar en revisión',
  '¿Descartar esta licitación?',
];

for (const marker of requiredMainMarkers) {
  assert.ok(main.includes(marker), `main.tsx missing visual v2 marker: ${marker}`);
}

const requiredCssMarkers = [
  'Space Grotesk',
  'Manrope',
  'JetBrains Mono',
  '--bg:#070B16',
  '--surface:#0E1426',
  '--accent:#3D7BFF',
  '.crm-v2-shell',
  '.sidebar-logo-mark',
  '.nav-section-label',
  '.topbar-status',
  '.tender-score-ring',
  '.score-ring-svg',
  '.score-ring-progress',
  '.lic-card',
];

for (const marker of requiredCssMarkers) {
  assert.ok(css.includes(marker), `styles.css missing visual v2 marker: ${marker}`);
}

assert(css.includes('.login-shell{background:radial-gradient(circle at 78% 0%'), 'Login debe quedar alineado al sistema visual oscuro V2, no mixto claro/oscuro.');
assert(css.includes('.login-card h1{color:#fff'), 'Login debe usar títulos claros sobre tarjeta oscura.');
console.log('visual v2 handoff static checks passed');
