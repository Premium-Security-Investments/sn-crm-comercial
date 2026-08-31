import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const GLOBAL_KEYS = ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'MouseEvent', 'CustomEvent'];

function setGlobal(key, value) {
  Object.defineProperty(globalThis, key, {
    value, writable: true, enumerable: true, configurable: true,
  });
}

function restoreGlobal(key, descriptor) {
  if (descriptor === undefined) {
    delete globalThis[key];
  } else {
    Object.defineProperty(globalThis, key, descriptor);
  }
}

export function mountWithJsdom(Component, initialProps) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  const previousDescriptors = {};
  for (const key of GLOBAL_KEYS) {
    previousDescriptors[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    setGlobal(key, dom.window[key]);
  }
  const previousActEnvDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  setGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = dom.window.document.getElementById('root');
  const root = createRoot(container);
  act(() => { root.render(createElement(Component, initialProps)); });
  return {
    window: dom.window, container,
    async click(selector) {
      const el = container.querySelector(selector);
      if (!el) throw new Error(`mountWithJsdom: no element matches "${selector}"`);
      await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    },
    async flush() { await act(async () => { await Promise.resolve(); }); },
    async unmount() {
      try {
        await act(async () => { root.unmount(); });
        // Drain one jsdom event-loop turn so React's deferred post-unmount
        // callbacks run while window/document globals are still installed,
        // instead of firing later against a torn-down global scope.
        await new Promise((resolve) => { dom.window.setTimeout(resolve, 0); });
      } finally {
        try {
          dom.window.close();
        } finally {
          for (const key of GLOBAL_KEYS) restoreGlobal(key, previousDescriptors[key]);
          restoreGlobal('IS_REACT_ACT_ENVIRONMENT', previousActEnvDescriptor);
        }
      }
    },
  };
}
