// Exercise the actual touch handlers without a browser or new dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/components/PullToRefresh.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;

function app() {
  const listeners = new Map(), effects = [], state = [], timers = [];
  let reloads = 0;
  class Element {
    constructor({ owner = false, overflowX = 'visible', overflowY = 'visible' } = {}) {
      Object.assign(this, { owner, overflowX, overflowY });
    }
    matches() { return this.owner; }
  }
  const document = { body: new Element(), documentElement: new Element() };
  const window = {
    scrollY: 0, getComputedStyle: node => node,
    location: { reload: () => reloads++ }, setTimeout: fn => timers.push(fn),
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
  };
  const react = {
    useState: initial => { const i = state.length; state.push(initial); return [initial, v => { state[i] = v; }]; },
    useRef: current => ({ current }), useEffect: fn => effects.push(fn),
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, window, document, Element, require: name =>
    name === 'react' ? react : name === 'react/jsx-runtime' ? { jsx: () => null } : { RefreshCw: () => null } });
  exports.default();
  const cleanup = effects[0]();
  const target = new Element();
  const fire = (name, { x = 50, y = 100, count = 1, ancestors = [] } = {}) => {
    const event = {
      touches: Array.from({ length: count }, () => ({ clientX: x, clientY: y })),
      composedPath: () => [target, ...ancestors, document.body, document.documentElement, window],
      cancelable: true, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    listeners.get(name)(event);
    return event;
  };
  return { fire, Element, state, window, cleanup, listeners, flush: () => { timers.splice(0).forEach(fn => fn()); return reloads; } };
}

// Both native scrolling directions and boundary pulls belong to the nested UI.
for (const options of [{ owner: true }, { overflowY: 'auto' }, { overflowY: 'scroll' }, { overflowX: 'auto' }]) {
  for (const scrollTop of [0, 100, 500]) {
    const h = app(), scroller = new h.Element(options);
    scroller.scrollTop = scrollTop;
    h.fire('touchstart', { ancestors: [scroller] });
    assert.equal(h.fire('touchmove', { y: 300 }).defaultPrevented, false);
    h.fire('touchend', { count: 0 });
    assert.equal(h.flush(), 0, 'Nested UI must never reload the background page');
    assert.equal(h.state[0], 0);
    h.fire('touchstart', { ancestors: [scroller] });
    assert.equal(h.fire('touchmove', { y: 20 }).defaultPrevented, false);
  }
}

let h = app();
h.fire('touchstart');
assert.equal(h.fire('touchmove', { y: 260 }).defaultPrevented, true);
h.fire('touchend', { count: 0 });
assert.equal(h.flush(), 1, 'A deliberate page-top pull still refreshes');

h = app(); h.fire('touchstart'); h.fire('touchmove', { y: 140 }); h.fire('touchend', { count: 0 });
assert.equal(h.flush(), 0, 'A short pull does not refresh'); assert.equal(h.state[0], 0);

for (const cancel of ['touchcancel', 'multitouch', 'page-scroll']) {
  h = app(); h.fire('touchstart'); h.fire('touchmove', { y: 300 });
  if (cancel === 'touchcancel') h.fire('touchcancel', { count: 0 });
  if (cancel === 'multitouch') h.fire('touchmove', { y: 300, count: 2 });
  if (cancel === 'page-scroll') { h.window.scrollY = 10; h.fire('touchmove', { y: 310 }); }
  h.fire('touchend', { count: 0 });
  assert.equal(h.flush(), 0, `${cancel} must cancel rather than refresh`);
  assert.equal(h.state[0], 0);
}

for (const firstMove of [{ x: 200, y: 110 }, { y: 60 }]) {
  h = app(); h.fire('touchstart');
  assert.equal(h.fire('touchmove', firstMove).defaultPrevented, false);
  assert.equal(h.fire('touchmove', { y: 300 }).defaultPrevented, false, 'Do not steal a native gesture when it reverses');
  h.fire('touchend', { count: 0 }); assert.equal(h.flush(), 0);
}
h = app(); h.window.scrollY = 100; h.fire('touchstart'); h.window.scrollY = 0;
assert.equal(h.fire('touchmove', { y: 300 }).defaultPrevented, false);
h.cleanup(); assert.equal(h.listeners.size, 0);
console.log('Pull-to-refresh checks passed: nested scrollers/overlays, boundaries, page refresh, cancellation, multitouch, direction changes, cleanup.');
