const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const sourceRoot = path.resolve(__dirname, '../src');
const unauthorized = () => ({ error: { status: 401, data: { error: 'Expired session' } } });
const ok = () => ({ data: { ok: true } });
const deferred = () => {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
};

// Run the actual TypeScript query wrapper and auth middleware, replacing only
// transport/framework edges. No browser, credentials or backend is required.
function harness(transport, browser = {}) {
  const modules = new Map();
  const calls = [];
  const actions = [];
  let state = { auth: { isAuthenticated: true, user: { id: 3, role: 'student' } } };
  const persistor = { pause() {}, async flush() {}, async purge() {}, persist() {} };
  const mocks = {
    '@reduxjs/toolkit/query/react': {
      fetchBaseQuery: () => async (args, queryApi) => {
        const call = { url: typeof args === 'string' ? args : args.url, userId: state.auth.user?.id, args };
        calls.push(call);
        return transport(call, calls, queryApi);
      },
      createApi: (configuration) => ({ ...configuration, util: { resetApiState: () => ({ type: 'api/resetApiState' }) } }),
    },
    '@reduxjs/toolkit': { isAction: (action) => Boolean(action && typeof action.type === 'string') },
    'js-cookie': { default: { get: () => 'fixture-csrf' } },
    '@/domains/auth/slice': { resetUser: () => ({ type: 'auth/resetUser' }) },
  };
  function load(file) {
    file = path.resolve(file);
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const source = fs.readFileSync(file, 'utf8').replaceAll('import.meta.env.VITE_API_URL', '"http://fixture.invalid"');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const requireFixture = (name) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === './store' && file.endsWith('/store/middleware.ts')) return { persistor };
      let resolved = name.startsWith('@/') ? path.join(sourceRoot, name.slice(2))
        : name.startsWith('.') ? path.resolve(path.dirname(file), name) : null;
      if (!resolved) throw new Error(`Unexpected dependency in session test: ${name}`);
      if (fs.existsSync(`${resolved}.ts`)) resolved += '.ts';
      else if (fs.existsSync(path.join(resolved, 'index.ts'))) resolved = path.join(resolved, 'index.ts');
      return load(resolved);
    };
    vm.runInNewContext(compiled, {
      module, exports: module.exports, require: requireFixture, console,
      AbortController, AbortSignal, setTimeout, clearTimeout, ...browser,
    }, { filename: file });
    return module.exports;
  }
  const { api } = load(path.join(sourceRoot, 'api/api.ts'));
  const { purgeMiddleware } = load(path.join(sourceRoot, 'store/middleware.ts'));
  const store = { getState: () => state, dispatch: (action) => dispatch(action) };
  const dispatch = purgeMiddleware(store)((action) => {
    actions.push(action);
    if (action.type === 'auth/setUser') state = { auth: { isAuthenticated: true, user: action.payload.user } };
    if (action.type === 'auth/resetUser') state = { auth: { isAuthenticated: false, user: null } };
    return action;
  });
  return {
    calls, actions, state: () => state,
    observe: () => load(path.join(sourceRoot, 'api/auth-session.ts')).observeAuthSessionChanges(() => {
      dispatch({ type: 'auth/resetUser', meta: { authSessionRemote: true } });
    }),
    prepareStorage: () => load(path.join(sourceRoot, 'api/auth-session.ts')).prepareAuthSessionStorage(),
    switchUser: (id = 1) => dispatch({ type: 'auth/setUser', payload: { user: { id, role: 'admin' } } }),
    request: (url, method = 'GET') => api.baseQuery({ url, method }, {
      ...store, signal: new AbortController().signal, endpoint: 'fixture', type: method === 'GET' ? 'query' : 'mutation',
    }, {}),
  };
}

async function until(condition) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise(setImmediate);
  }
  assert.fail('Expected async stage was not reached');
}

test('concurrent expired requests in one session share a single refresh', async () => {
  const refresh = deferred();
  const attempts = new Map();
  const h = harness(({ url }) => {
    if (url === '/auth/refresh') return refresh.promise;
    const count = attempts.get(url) || 0;
    attempts.set(url, count + 1);
    return count === 0 ? unauthorized() : ok();
  });
  const first = h.request('/dashboard');
  const second = h.request('/account/me');
  await until(() => h.calls.some(({ url }) => url === '/auth/refresh'));
  refresh.resolve(ok());
  const results = await Promise.all([first, second]);
  assert.equal(h.calls.filter(({ url }) => url === '/auth/refresh').length, 1);
  assert.ok(results.every((result) => result.data?.ok));
  assert.equal(h.actions.filter(({ type }) => type === 'auth/resetUser').length, 0);
});

test('a delayed old 401 after successful refresh retries without refreshing twice', async () => {
  const late = deferred();
  const attempts = new Map();
  const h = harness(({ url }) => {
    if (url === '/auth/refresh') return ok();
    const count = attempts.get(url) || 0;
    attempts.set(url, count + 1);
    if (count !== 0) return ok();
    return url === '/late' ? late.promise : unauthorized();
  });
  const delayed = h.request('/late');
  await h.request('/dashboard');
  late.resolve(unauthorized());
  assert.ok((await delayed).data?.ok);
  assert.equal(h.calls.filter(({ url }) => url === '/auth/refresh').length, 1);
});

test('an old identity mutation is never refreshed or replayed under a new login', async () => {
  const oldRequest = deferred();
  const h = harness((_call, calls) => calls.length === 1 ? oldRequest.promise : ok());
  const pending = h.request('/students/9', 'PUT');
  h.switchUser(1);
  oldRequest.resolve(unauthorized());
  await pending;
  assert.equal(h.calls.length, 1, 'An old mutation must not issue refresh or retry after an account switch');
  assert.equal(h.state().auth.user.id, 1);
});

for (const authEndpoint of ['/auth/login', '/auth/logout']) {
  test(`${authEndpoint} cancels old requests before its own response changes Redux auth`, async () => {
    const oldRequest = deferred();
    let oldSignal;
    const h = harness((call, calls, queryApi) => {
      if (calls.length === 1) { oldSignal = queryApi.signal; return oldRequest.promise; }
      return ok();
    });
    const pending = h.request('/students/9', 'PUT');
    await h.request(authEndpoint, 'POST');
    assert.equal(oldSignal.aborted, true);
    oldRequest.resolve(unauthorized());
    await pending;
    assert.deepEqual(h.calls.map(({ url }) => url), ['/students/9', authEndpoint]);
  });
}

for (const [label, refreshResult] of [['success', ok()], ['unauthorized', unauthorized()]]) {
  test(`an old refresh ${label} cannot replay requests or clear the newly logged-in identity`, async () => {
    const refresh = deferred();
    const h = harness(({ url }) => url === '/auth/refresh' ? refresh.promise : unauthorized());
    const pending = h.request('/students/9', 'PUT');
    await until(() => h.calls.some(({ url }) => url === '/auth/refresh'));
    h.switchUser(1);
    refresh.resolve(refreshResult);
    await pending;
    assert.equal(h.calls.length, 2, 'A stale refresh must not replay the old mutation');
    assert.equal(h.state().auth.user.id, 1);
    assert.equal(h.actions.filter(({ type }) => type === 'auth/resetUser').length, 0);
  });
}

test('finishing an old refresh does not clear a newer session refresh in progress', async () => {
  const oldRefresh = deferred();
  const newRefresh = deferred();
  let refreshes = 0;
  let currentSessionRefreshed = false;
  const h = harness(({ url }) => {
    if (url === '/auth/refresh') return ++refreshes === 1 ? oldRefresh.promise : newRefresh.promise;
    return currentSessionRefreshed ? ok() : unauthorized();
  });
  const oldRequest = h.request('/old-request');
  await until(() => refreshes === 1);
  h.switchUser(1);
  const freshRequest = h.request('/new-request');
  await until(() => refreshes === 2);
  oldRefresh.resolve(ok());
  await oldRequest;
  const waitingRequest = h.request('/new-waiter');
  await new Promise(setImmediate);
  assert.equal(h.calls.some(({ url }) => url === '/new-waiter'), false,
    'New requests must continue waiting for the new refresh');
  currentSessionRefreshed = true;
  newRefresh.resolve(ok());
  assert.ok((await freshRequest).data?.ok);
  assert.ok((await waitingRequest).data?.ok);
  assert.equal(refreshes, 2);
});

test('temporary refresh failure keeps the current local identity', async () => {
  const h = harness(({ url }) => url === '/auth/refresh'
    ? { error: { status: 503, data: { error: 'Temporarily unavailable' } } } : unauthorized());
  await h.request('/dashboard');
  assert.equal(h.state().auth.user.id, 3);
  assert.equal(h.actions.filter(({ type }) => type === 'auth/resetUser').length, 0);
});

test('rejected refresh in the same session immediately clears auth and query cache', async () => {
  const h = harness(() => unauthorized());
  await h.request('/dashboard');
  assert.equal(h.state().auth.isAuthenticated, false);
  assert.ok(h.actions.some(({ type }) => type === 'api/resetApiState'));
});


function browserHub(useBroadcastChannel = true) {
  const storage = new Map();
  const tabs = [];
  const channels = [];
  const queue = [];
  let writes = 0;
  const storageApi = (map) => ({
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  });
  return {
    storage,
    get writes() { return writes; },
    discardEvents: () => { queue.length = 0; },
    flush: () => {
      let deliveries = 0;
      while (queue.length) {
        assert.ok(++deliveries < 100, 'Session notifications must not loop between tabs');
        queue.shift()();
      }
    },
    createTab: () => {
      const listeners = new Map();
      const tab = {
        sessionStorage: storageApi(new Map()),
        addEventListener: (name, fn) => listeners.set(name, fn),
        removeEventListener: (name) => listeners.delete(name),
        emit: (name, event) => listeners.get(name)?.(event),
      };
      tab.localStorage = {
        ...storageApi(storage),
        setItem: (key, value) => {
          const oldValue = storage.get(key) ?? null;
          storage.set(key, String(value));
          writes++;
          for (const target of tabs.filter((other) => other !== tab)) {
            queue.push(() => target.emit('storage', { key, newValue: String(value), oldValue }));
          }
        },
      };
      tabs.push(tab);
      const browser = { window: tab };
      if (useBroadcastChannel) browser.BroadcastChannel = class {
        constructor(name) { this.name = name; channels.push(this); }
        postMessage(data) {
          for (const target of channels.filter((other) => other !== this && other.name === this.name)) {
            queue.push(() => target.onmessage?.({ data }));
          }
        }
        close() { channels.splice(channels.indexOf(this), 1); }
      };
      return browser;
    },
  };
}

for (const useBroadcast of [true, false]) {
  test(`account changes clear other tabs without replay or broadcast loops (${useBroadcast ? 'channel and storage' : 'storage fallback'})`, async () => {
    const hub = browserHub(useBroadcast);
    const oldRequest = deferred();
    let oldSignal;
    const first = harness((_call, _calls, queryApi) => { oldSignal = queryApi.signal; return oldRequest.promise; }, hub.createTab());
    const second = harness(() => ok(), hub.createTab());
    first.observe();
    second.observe();
    const pending = first.request('/students/9', 'PUT');
    second.switchUser(1);
    hub.flush();
    assert.equal(oldSignal.aborted, true);
    assert.equal(first.state().auth.isAuthenticated, false);
    assert.equal(second.state().auth.user.id, 1);
    assert.equal(first.actions.filter(({ type }) => type === 'auth/resetUser').length, 1, 'Duplicate channel/storage deliveries must be ignored');
    assert.equal(hub.writes, 1, 'Remote resets must not broadcast another event');
    oldRequest.resolve(unauthorized());
    await pending;
    assert.equal(first.calls.length, 1, 'Old tab mutation must not replay with the new shared cookies');
  });
}

test('a resumed tab checks the latest nonce even if notifications were missed', () => {
  const hub = browserHub(false);
  const firstBrowser = hub.createTab();
  const first = harness(() => ok(), firstBrowser);
  const second = harness(() => ok(), hub.createTab());
  first.observe();
  second.observe();
  second.switchUser(1);
  hub.discardEvents();
  assert.equal(first.state().auth.user.id, 3);
  firstBrowser.window.emit('focus');
  assert.equal(first.state().auth.isAuthenticated, false);
});

test('startup removes legacy shared auth and stale tab auth before rehydration', () => {
  const hub = browserHub(false);
  const browser = hub.createTab();
  const otherTab = hub.createTab();
  hub.storage.set('persist:root', 'legacy shared identity');
  hub.storage.set('school-admin:session-change', 'latest-event');
  browser.window.sessionStorage.setItem('persist:root', 'old tab identity');
  browser.window.sessionStorage.setItem('school-admin:session-change', 'old-event');
  otherTab.window.sessionStorage.setItem('persist:root', 'other tab identity');
  const h = harness(() => ok(), browser);
  h.prepareStorage();
  assert.equal(hub.storage.has('persist:root'), false);
  assert.equal(browser.window.sessionStorage.getItem('persist:root'), null);
  assert.equal(otherTab.window.sessionStorage.getItem('persist:root'), 'other tab identity');
});
