// Behavioral checks for the interface switch; no browser, network, or new dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/contexts/ThemeContext.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
function app(saved = {}, search = '', storageBlocked = false) {
  const storage = new Map(Object.entries(saved)), state = [], deps = [];
  let stateCursor = 0, effectCursor = 0, queue = [], result;
  const classes = () => ({ values: new Set(), toggle(name, on) { on ? this.values.add(name) : this.values.delete(name); } });
  const document = { documentElement: { dataset: {}, classList: classes() }, body: { classList: classes() } };
  const window = { location: { search, href: `http://localhost/${search}` }, history: { state: {}, replaceState(_state, _title, url) { window.location.href = String(url); } } };
  const react = {
    createContext: () => ({ Provider: 'provider' }), createElement: (_type, props) => props.value,
    useState(initial) { const i = stateCursor++; if (!(i in state)) state[i] = initial; return [state[i], v => { state[i] = typeof v === 'function' ? v(state[i]) : v; }]; },
    useEffect(fn, nextDeps) { const i = effectCursor++; if (!deps[i] || nextDeps.some((v, j) => v !== deps[i][j])) { queue.push(fn); deps[i] = nextDeps; } },
    useCallback: fn => fn,
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: () => react, window, document, URL, URLSearchParams,
    localStorage: { getItem(key) { if (storageBlocked) throw new Error('blocked'); return storage.get(key) ?? null; }, setItem(key, val) { if (storageBlocked) throw new Error('blocked'); storage.set(key, val); } } });
  const render = () => { for (let i = 0; i < 3; i++) { stateCursor = effectCursor = 0; result = exports.ThemeProvider({ children: null }); const effects = queue; queue = []; effects.forEach(fn => fn()); } return result; };
  return { render, storage, document, window };
}
let h = app();
assert.equal(h.render().design, 'modern'); assert.equal(h.render().theme, 'dark');
assert.equal(h.document.documentElement.dataset.design, 'modern');
assert(h.document.body.classList.values.has('dark-theme'));
h = app({ 'cs-batagi-theme': 'light', 'cs-batagi-modern-theme': 'dark' });
h.render().setDesign('classic'); assert.equal(h.render().theme, 'light');
assert.equal(h.storage.get('cs-batagi-design'), 'classic');
h.render().toggleTheme(); assert.equal(h.render().theme, 'dark');
h.render().setDesign('modern'); assert.equal(h.render().theme, 'dark');
h.render().toggleTheme(); assert.equal(h.render().theme, 'light');
h.render().setDesign('classic'); assert.equal(h.render().theme, 'dark');
assert.equal(h.storage.get('cs-batagi-modern-theme'), 'light');
h = app({ 'cs-batagi-design': 'classic' }); assert.equal(h.render().design, 'classic');
h = app({ 'cs-batagi-design': 'modern' }, '?ui=classic'); assert.equal(h.render().design, 'classic');
h.render().setDesign('modern'); h.render(); assert.equal(new URL(h.window.location.href).searchParams.get('ui'), 'modern');
h = app({}, '', true); h.render().setDesign('classic'); assert.equal(h.render().design, 'classic');
h.render().toggleTheme(); assert.equal(h.render().theme, 'dark');
console.log('Interface checks passed: default, saved choice, independent themes, URL override, URL switching, blocked storage.');

// The comparison starts at the pre-image design and wraps through all four snapshots.
h = app();
assert.equal(h.render().clubVersion, 'original');
for (const version of ['panels', 'warm', 'graphite', 'original']) {
  h.render().cycleClubVersion();
  assert.equal(h.render().clubVersion, version);
  assert.equal(h.document.documentElement.dataset.clubVersion, version);
  assert.equal(h.storage.get('cs-batagi-club-version'), version);
}
h = app({ 'cs-batagi-club-version': 'graphite' });
assert.equal(h.render().clubVersion, 'graphite');
h.render().setDesign('classic'); h.render().setDesign('modern');
assert.equal(h.render().clubVersion, 'graphite');
h = app({ 'cs-batagi-club-version': 'unknown' });
assert.equal(h.render().clubVersion, 'original');
h = app({}, '', true);
h.render().cycleClubVersion();
assert.equal(h.render().clubVersion, 'panels');
console.log('Version checks passed: cycle, wraparound, persistence, classic switch, invalid value, blocked storage.');

// Cinematic is a separate mode, so visiting it must not overwrite earlier palettes.
h = app({ 'cs-batagi-modern-theme': 'light', 'cs-batagi-theme': 'dark', 'cs-batagi-club-version': 'graphite' }, '?ui=cinematic');
assert.equal(h.render().design, 'cinematic');
assert.equal(h.render().theme, 'dark');
assert.equal(h.document.documentElement.dataset.design, 'cinematic');
assert.equal(h.storage.get('cs-batagi-modern-theme'), 'light');
h.render().setDesign('modern');
assert.equal(h.render().theme, 'light');
assert.equal(h.render().clubVersion, 'graphite');
h.render().setDesign('cinematic'); h.render().setDesign('classic');
assert.equal(h.render().theme, 'dark');
h = app({ 'cs-batagi-design': 'cinematic' }); assert.equal(h.render().design, 'cinematic');
h = app({}, '?ui=cinematic', true); assert.equal(h.render().design, 'cinematic');
h.render().setDesign('modern'); assert.equal(h.render().design, 'modern');
assert.equal(new URL(h.window.location.href).searchParams.get('ui'), 'modern');
console.log('Cinematic checks passed: direct URL, saved mode, palette/version preservation, blocked storage, exit switch.');
