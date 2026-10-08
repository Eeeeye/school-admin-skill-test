const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const { configureStore } = require('@reduxjs/toolkit');
const { createApi } = require('@reduxjs/toolkit/query');

function load(file, imports = {}) {
  const filename = path.resolve(__dirname, '../src', file);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports,
    require: name => {
      assert.ok(name in imports, `Unexpected import ${name}`);
      return imports[name];
    }
  }, { filename });
  return module.exports;
}

function harness() {
  const { Tag } = load('api/tag-types.ts');
  const state = { name: 'Annual leave', active: true, associated: true };
  const reads = new Map();
  const api = createApi({ reducerPath: 'api', tagTypes: Object.values(Tag), endpoints: () => ({}),
    baseQuery: async args => {
      const { url, method = 'GET', body = {} } = typeof args === 'string' ? { url: args } : args;
      if (method === 'GET') {
        reads.set(url, (reads.get(url) || 0) + 1);
        const policy = { id: 7, name: state.name, isActive: state.active,
          totalUsersAssociated: Number(state.associated), totalDaysUsed: 0 };
        if (url === '/leave/policies') return { data: { leavePolicies: [policy] } };
        if (url === '/leave/policies/me') return { data: {
          leavePolicies: state.active && state.associated ? [policy] : [] } };
        if (url === '/leave/request') return { data: { leaveHistory: [{ id: 2, policy: state.name }] } };
        if (url === '/leave/pending') return { data: { pendingLeaves: [{ id: 2, policy: state.name }] } };
        if (url === '/dashboard') return { data: { policy: state.name, associated: state.associated } };
        throw new Error(`Unexpected GET ${url}`);
      }
      if (url === '/leave/policies/7' && method === 'PUT') state.name = body.name;
      else if (url === '/leave/policies/7/status') state.active = body.status;
      else if (url === '/leave/policies/7/users' && method === 'DELETE') state.associated = false;
      else throw new Error(`Unexpected mutation ${method} ${url}`);
      return { data: { message: 'Saved' } };
    }
  });
  load('domains/leave/api/leave-api.ts', { '@/api': { api, Tag } });
  load('domains/dashboard/api/dashboard-api.ts', { '@/api': { api, Tag } });
  const store = configureStore({ reducer: { api: api.reducer }, middleware: getDefault => getDefault().concat(api.middleware) });
  const query = async name => { await store.dispatch(api.endpoints[name].initiate()).unwrap(); };
  const value = name => api.endpoints[name].select()(store.getState()).data;
  return { api, store, query, value, reads };
}

async function settle() { for (let i = 0; i < 10; i++) await new Promise(setImmediate); }

test('renaming a leave policy refreshes subscribed personal, history, pending and dashboard views', async () => {
  const h = harness();
  try {
    for (const name of ['getLeavePolicies', 'getMyLeavePolicies', 'getMyLeaveHistory', 'getLeavePending', 'getDashboardData']) await h.query(name);
    await h.store.dispatch(h.api.endpoints.updateLeavePolicy.initiate({ id: 7, name: 'Renamed leave' })).unwrap();
    await settle();
    assert.equal(h.value('getLeavePolicies').leavePolicies[0].name, 'Renamed leave');
    assert.equal(h.value('getMyLeavePolicies').leavePolicies[0].name, 'Renamed leave');
    assert.equal(h.value('getMyLeaveHistory').leaveHistory[0].policy, 'Renamed leave');
    assert.equal(h.value('getLeavePending').pendingLeaves[0].policy, 'Renamed leave');
    assert.equal(h.value('getDashboardData').policy, 'Renamed leave');
  } finally { h.store.dispatch(h.api.util.resetApiState()); }
});

test('disabling an active policy removes it from the already cached request options', async () => {
  const h = harness();
  try {
    await h.query('getMyLeavePolicies');
    assert.equal(h.value('getMyLeavePolicies').leavePolicies.length, 1);
    await h.store.dispatch(h.api.endpoints.handleLeavePolicy.initiate({ id: 7, status: false })).unwrap();
    await settle();
    assert.equal(h.value('getMyLeavePolicies').leavePolicies.length, 0);
  } finally { h.store.dispatch(h.api.util.resetApiState()); }
});

test('removing a policy member updates its displayed member count and dashboard without reload', async () => {
  const h = harness();
  try {
    await h.query('getLeavePolicies');
    await h.query('getDashboardData');
    await h.store.dispatch(h.api.endpoints.removeUserFromPolicy.initiate({ policyId: 7, userId: 1 })).unwrap();
    await settle();
    assert.equal(h.value('getLeavePolicies').leavePolicies[0].totalUsersAssociated, 0);
    assert.equal(h.value('getDashboardData').associated, false);
  } finally { h.store.dispatch(h.api.util.resetApiState()); }
});
