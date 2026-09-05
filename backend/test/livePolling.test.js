// Tests execute the real hooks with controlled effects, timers, and network responses.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('../../frontend-nextjs/node_modules/typescript');
function mount(file, name, options) {
  const effects = [], state = [], listeners = {};
  const react = {
    useState(initial) { const i = state.length; state.push(initial); return [initial, v => { state[i] = v; }]; },
    useRef: current => ({ current }), useCallback: fn => fn, useMemo: fn => fn(), useEffect: fn => effects.push(fn),
  };
  const document = { visibilityState: 'visible', addEventListener: (n, fn) => { listeners[n] = fn; }, removeEventListener: n => { delete listeners[n]; } };
  const exports = {}, fetch = jest.fn();
  const source = fs.readFileSync(path.join(__dirname, '../../frontend-nextjs/src/lib', file), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: () => react, fetch, document, window: document, navigator: { onLine: true }, AbortController,
      URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval, Date, localStorage: { getItem: () => '999' } });
  const result = exports[name](options);
  return { state, fetch, document, listeners, result, start: () => { const cleanups = effects.map(fn => fn()); return () => cleanups.forEach(fn => fn?.()); } };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const payload = (version, value) => ({ status: 200, ok: true, json: async () => ({ version, value }) });
beforeEach(() => jest.useFakeTimers()); afterEach(() => jest.useRealTimers());
test('live polling remembers BIGINT strings, avoids overlap, and clears errors on 304', async () => {
  const h = mount('useLivePolling.ts', 'useLivePolling', { url: '/live', initialData: {} });
  let resolve; h.fetch.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const stop = h.start(); jest.advanceTimersByTime(9000); expect(h.fetch).toHaveBeenCalledTimes(1);
  resolve(payload('42', 'fresh')); await flush(); expect(h.state[3]).toBe(42);
  h.fetch.mockRejectedValueOnce(new Error('offline')); jest.advanceTimersByTime(3000); await flush();
  expect(h.fetch.mock.calls[1][0]).toBe('/live?v=42'); expect(h.state[2]).toBeTruthy();
  h.fetch.mockResolvedValueOnce({ status: 304 }); jest.advanceTimersByTime(3000); await flush();
  expect(h.state[2]).toBe(null); stop();
});
test('post-write refresh ignores late pre-write responses and bypasses HTTP caches', async () => {
  const h = mount('useLivePolling.ts', 'useLivePolling', { url: '/live', initialData: {} });
  let old; h.fetch.mockImplementationOnce(() => new Promise(r => { old = r; })).mockResolvedValueOnce(payload(2, 'new'));
  const stop = h.start(); await h.result.refetch(); old(payload(1, 'old')); await flush();
  expect(h.state[0]).toEqual({ value: 'new' }); expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(h.fetch.mock.calls[1][1].cache).toBe('no-store'); stop();
});
test('hidden tabs stop polling and resume immediately', async () => {
  const h = mount('useLivePolling.ts', 'useLivePolling', { url: '/live', initialData: {} });
  h.fetch.mockResolvedValue(payload(3, 'fresh')); const stop = h.start(); await flush();
  h.document.visibilityState = 'hidden'; h.listeners.visibilitychange(); jest.advanceTimersByTime(60000); await flush();
  expect(h.fetch).toHaveBeenCalledTimes(1);
  h.document.visibilityState = 'visible'; h.listeners.visibilitychange(); await flush();
  expect(h.fetch.mock.calls[1][0]).toBe('/live?v=3'); stop();
});
test('each stats consumer requests its own data before sending a version', async () => {
  for (let i = 0; i < 2; i++) {
    const onData = jest.fn();
    const h = mount('useStatsRefresh.ts', 'useStatsRefresh', { keys: ['night_avg_periods'], onData });
    h.fetch.mockResolvedValue({ ok: true, json: async () => ({ updated: true, statsVersion: 5, night_avg_periods: {} }) });
    const stop = h.start(); await flush();
    expect(h.fetch.mock.calls[0][0]).toContain('lastKnownVersion=0'); expect(onData).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(90000); await flush(); expect(h.fetch.mock.calls[1][0]).toContain('lastKnownVersion=5'); stop();
  }
});

test('timed-out live reads report failure and retry without overlapping', async () => {
  const h = mount('useLivePolling.ts', 'useLivePolling', { url: '/live', initialData: {} });
  h.fetch.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')));
  })).mockResolvedValueOnce(payload(4, 'recovered'));
  const stop = h.start();
  jest.advanceTimersByTime(15000); await flush();
  expect(h.state[2]).toBe('Live data request timed out');
  expect(h.fetch).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(3000); await flush();
  expect(h.state[0]).toEqual({ value: 'recovered' });
  expect(h.state[2]).toBe(null); stop();
});

test('unmount aborts live requests and ignores their late responses', async () => {
  const h = mount('useLivePolling.ts', 'useLivePolling', { url: '/live', initialData: {} });
  let resolve; h.fetch.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const stop = h.start(); stop();
  expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  resolve(payload(8, 'late')); await flush();
  expect(h.state[0]).toEqual({});
  jest.advanceTimersByTime(30000); expect(h.fetch).toHaveBeenCalledTimes(1);
});
