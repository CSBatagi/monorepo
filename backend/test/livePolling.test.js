// Tests execute the real hooks with controlled effects, timers, and network responses.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('../../frontend-nextjs/node_modules/typescript');
function mount(file, name, options) {
  const effects = [], state = [], refs = [], listeners = {};
  let stateIndex = 0, refIndex = 0, effectIndex = 0;
  const react = {
    useState(initial) { const i = stateIndex++; if (!(i in state)) state[i] = initial; return [state[i], v => { state[i] = typeof v === 'function' ? v(state[i]) : v; }]; },
    useRef(current) { const i = refIndex++; return refs[i] || (refs[i] = { current }); },
    useCallback: fn => fn, useMemo: fn => fn(),
    useEffect(fn, deps) {
      const i = effectIndex++, previous = effects[i];
      if (!previous || !deps || deps.some((value, j) => value !== previous.deps[j])) {
        effects[i] = { fn, deps, cleanup: previous?.cleanup, pending: true };
      }
    },
  };
  const document = { visibilityState: 'visible', addEventListener: (n, fn) => { listeners[n] = fn; }, removeEventListener: n => { delete listeners[n]; } };
  const exports = {}, fetch = jest.fn();
  const source = fs.readFileSync(path.join(__dirname, '../../frontend-nextjs/src/lib', file), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: () => react, fetch, document, window: document, navigator: { onLine: true }, AbortController,
      URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval, Date, localStorage: { getItem: () => '999' } });
  const render = next => {
    stateIndex = 0; refIndex = 0; effectIndex = 0;
    return exports[name](next);
  };
  const runEffects = () => effects.forEach(effect => {
    if (effect.pending) { effect.cleanup?.(); effect.cleanup = effect.fn(); effect.pending = false; }
  });
  const result = render(options);
  return { state, fetch, document, listeners, result,
    rerender: next => { render(next); runEffects(); },
    start: () => { runEffects(); return () => effects.forEach(effect => effect.cleanup?.()); } };
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

test('a failed first attendance request recovers after one second without a page refresh', async () => {
  const h = mount('useLivePolling.ts', 'useLivePolling', { url: '/live', initialData: {} });
  h.fetch.mockResolvedValueOnce({ status: 503, ok: false }).mockResolvedValueOnce(payload(7, 'today'));
  const stop = h.start(); await flush();
  jest.advanceTimersByTime(1000); await flush();
  expect(h.state[0]).toEqual({ value: 'today' });
  expect(h.fetch.mock.calls[1][0]).toBe('/live?v=0'); stop();
});

test('an initial 304 cannot mark missing attendance as loaded', async () => {
  const h = mount('useLivePolling.ts', 'useLivePolling', { url: '/live', initialData: {} });
  h.fetch.mockResolvedValueOnce({ status: 304 }).mockResolvedValueOnce(payload(2, 'full'));
  const stop = h.start(); await flush();
  expect(h.state[2]).toBe('Live data snapshot missing');
  jest.advanceTimersByTime(1000); await flush();
  expect(h.state[0]).toEqual({ value: 'full' }); stop();
});

test.each(['visibilitychange', 'offline'])('attendance cancels interrupted reads on %s and resumes immediately', async event => {
  const h = mount('useLivePolling.ts', 'useLivePolling', { url: '/live', initialData: {} });
  let old;
  h.fetch.mockImplementationOnce(() => new Promise(resolve => { old = resolve; })).mockResolvedValueOnce(payload(9, 'new'));
  const stop = h.start();
  if (event === 'visibilitychange') h.document.visibilityState = 'hidden';
  h.listeners[event]();
  expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  h.document.visibilityState = 'visible'; h.listeners.online(); await flush();
  old(payload(8, 'old')); await flush();
  expect(h.state[0]).toEqual({ value: 'new' }); stop();
});

const equipment = onData => mount('useRecoveringRead.ts', 'useRecoveringRead', { url: '/api/cosmetics/me', onData });
test('equipment first-visit server failure retries automatically and clears its error', async () => {
  const onData = jest.fn(), h = equipment(onData);
  h.fetch.mockResolvedValueOnce({ status: 503, ok: false, json: async () => ({ error: 'temporarily unavailable' }) })
    .mockResolvedValueOnce(payload(1, 'equipment'));
  const stop = h.start(); await flush();
  expect(h.state[1]).toBe('temporarily unavailable');
  jest.advanceTimersByTime(1000); await flush();
  expect(onData).toHaveBeenCalledWith({ version: 1, value: 'equipment' });
  expect(h.state).toEqual([false, '']);
  expect(h.fetch.mock.calls[1][1].cache).toBe('no-store'); stop();
});

test('equipment times out a hanging first read, then recovers without overlapping requests', async () => {
  const onData = jest.fn(), h = equipment(onData);
  h.fetch.mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  })).mockResolvedValueOnce(payload(1, 'recovered'));
  const stop = h.start(); jest.advanceTimersByTime(15000); await flush();
  expect(h.fetch).toHaveBeenCalledTimes(1);
  expect(h.state[0]).toBe(false);
  jest.advanceTimersByTime(1000); await flush();
  expect(onData).toHaveBeenCalledTimes(1); expect(h.state[1]).toBe(''); stop();
});

test.each([401, 403, 404])('equipment does not keep retrying HTTP %s', async status => {
  const h = equipment(jest.fn());
  h.fetch.mockResolvedValue({ status, ok: false, json: async () => ({ error: 'denied' }) });
  const stop = h.start(); await flush(); jest.advanceTimersByTime(120000); await flush();
  expect(h.fetch).toHaveBeenCalledTimes(1); stop();
});

test('equipment suspends retries while hidden and refreshes on return after a day', async () => {
  const onData = jest.fn(), h = equipment(onData);
  h.fetch.mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValueOnce(payload(2, 'fresh'));
  const stop = h.start(); await flush();
  h.document.visibilityState = 'hidden'; h.listeners.visibilitychange();
  jest.advanceTimersByTime(86400000); await flush(); expect(h.fetch).toHaveBeenCalledTimes(1);
  h.document.visibilityState = 'visible'; h.listeners.visibilitychange(); h.listeners.pageshow(); h.listeners.focus(); await flush();
  expect(h.fetch).toHaveBeenCalledTimes(2); expect(onData).toHaveBeenCalledTimes(1); stop();
});

test('equipment resumes a successful snapshot, ignoring the interrupted older read', async () => {
  const onData = jest.fn(), h = equipment(onData);
  let old;
  h.fetch.mockImplementationOnce(() => new Promise(resolve => { old = resolve; })).mockResolvedValueOnce(payload(2, 'fresh'));
  const stop = h.start(); h.listeners.offline(); h.listeners.online(); await flush();
  old(payload(1, 'stale')); await flush();
  expect(onData).toHaveBeenCalledTimes(1); expect(onData).toHaveBeenCalledWith({ version: 2, value: 'fresh' }); stop();
});

test('disabled equipment reads never start, and unmount cancels pending callbacks', async () => {
  const onData = jest.fn();
  const disabled = mount('useRecoveringRead.ts', 'useRecoveringRead', { url: '/me', onData, enabled: false });
  disabled.start()(); expect(disabled.fetch).not.toHaveBeenCalled();
  const h = equipment(onData); let old;
  h.fetch.mockImplementation(() => new Promise(resolve => { old = resolve; }));
  const stop = h.start(); stop(); old(payload(1, 'late')); await flush();
  expect(onData).not.toHaveBeenCalled(); expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true);
});

test('catalog search is debounced and cancelled before obsolete results can arrive', async () => {
  const h = mount('useRecoveringRead.ts', 'useRecoveringRead', { url: '/catalog?q=old', onData: jest.fn(), debounceMs: 250 });
  const stop = h.start(); jest.advanceTimersByTime(200); stop(); jest.advanceTimersByTime(1000);
  expect(h.fetch).not.toHaveBeenCalled();
});

test('pausing equipment for editing cancels the old read and re-enabling fetches current state', async () => {
  const onData = jest.fn(), h = equipment(onData); let old;
  h.fetch.mockImplementationOnce(() => new Promise(resolve => { old = resolve; })).mockResolvedValueOnce(payload(2, 'saved'));
  const stop = h.start();
  h.rerender({ url: '/api/cosmetics/me', onData, enabled: false });
  old(payload(1, 'before-edit')); await flush();
  expect(onData).not.toHaveBeenCalled(); expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  h.rerender({ url: '/api/cosmetics/me', onData, enabled: true }); await flush();
  expect(onData).toHaveBeenCalledTimes(1); expect(onData).toHaveBeenCalledWith({ version: 2, value: 'saved' }); stop();
});

test('a late old catalog search cannot overwrite the new search', async () => {
  const onData = jest.fn();
  const h = mount('useRecoveringRead.ts', 'useRecoveringRead', { url: '/catalog?q=old', onData }); let old;
  h.fetch.mockImplementationOnce(() => new Promise(resolve => { old = resolve; })).mockResolvedValueOnce(payload(2, 'new search'));
  const stop = h.start(); h.rerender({ url: '/catalog?q=new', onData }); await flush();
  old(payload(1, 'old search')); await flush();
  expect(onData).toHaveBeenCalledTimes(1); expect(onData).toHaveBeenCalledWith({ version: 2, value: 'new search' }); stop();
});

test.each(['useLivePolling', 'useRecoveringRead'])('%s replaces a suspended request before delayed browser timers run', async hook => {
  const onData = jest.fn();
  const h = mount(`${hook}.ts`, hook, { url: '/live', initialData: {}, onData });
  h.fetch.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(payload(2, 'current'));
  const stop = h.start();
  jest.setSystemTime(Date.now() + 86400000); h.listeners.pageshow(); await flush();
  expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true); expect(h.fetch).toHaveBeenCalledTimes(2); stop();
});
