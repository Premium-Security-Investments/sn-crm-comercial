import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Shared esbuild + react-dom/server harness: loads a real TSX component (no mocks, no
// hand-copied markup) and produces the actual static HTML React would render. Tests assert on
// this HTML, not on the source text, so the evidence tracks real component behavior.

const repoRoot = new URL('../../', import.meta.url);
const cacheDir = new URL('node_modules/.cache/bundle-react-component/', repoRoot);
mkdirSync(cacheDir, { recursive: true });

let sequence = 0;
// Includes the pid so two test files bundling the same component in parallel processes (the
// normal `node --test` execution model) never race on the same cache file.
const outNameFor = relativePath => `${relativePath.replace(/[^a-zA-Z0-9]+/g, '-')}-${process.pid}-${sequence++}.mjs`;

// Bundles `relativePath` (repo-root-relative) into a standalone ESM module. `react`,
// `react/jsx-runtime` and `react-dom` stay external so the bundled module shares the exact same
// React instance as this test process — otherwise hooks and react-dom/server break silently.
export function bundleReactModule(relativePath, outName = outNameFor(relativePath)) {
  const outfile = new URL(outName, cacheDir).pathname;
  buildSync({
    entryPoints: [new URL(relativePath, repoRoot).pathname],
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', 'react-dom'],
    outfile,
    write: true,
  });
  return import(pathToFileURL(outfile).href);
}

// Bundles `relativePath` and returns the named export `exportName` (the component function).
export async function loadReactComponent(relativePath, exportName, outName) {
  const module = await bundleReactModule(relativePath, outName);
  const Component = module[exportName];
  if (!Component) {
    throw new Error(`bundle-react-component: "${exportName}" is not exported from ${relativePath}`);
  }
  return Component;
}

// Convenience wrapper around createElement + renderToStaticMarkup, so call sites don't repeat
// the same two imports for every render.
export function renderReactComponent(Component, props) {
  return renderToStaticMarkup(createElement(Component, props));
}
