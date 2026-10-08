// Controlled browser regressions: every API request is intercepted; no real data is changed.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.PRODUCT_URL || 'http://localhost:5173';
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname));

const paths = ['sections/edit/:id', 'departments/edit/:id', 'classes/edit/:id',
  'class-teachers/edit/:id', 'notices/edit/:id', 'notices/:id',
  'notices/recipients/edit/:id', 'roles-and-permissions', 'leave/define', 'leave/request'];
const permissions = {
  menus: paths.filter(path => path.endsWith('edit/:id')).map((path, id) => ({
    id, name: `Next ${path}`, path: path.replace(':id', '102'), subMenus: []
  })),
  apis: [], uis: paths.map((path, id) => ({ id, path }))
};
const roles = [{ id: 1, name: 'admin', usersAssociated: 1, status: true },
  { id: 2, name: 'teacher', usersAssociated: 1, status: true }];
const user = { id: 1, name: 'Browser fixture', email: 'fixture@example.invalid', role: 'admin', ...permissions };
const json = (route, body, status = 200) => route.fulfill({ status,
  contentType: 'application/json', body: JSON.stringify(body) });
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }) });
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.addInitScript(user => {
    sessionStorage.setItem('persist:root', JSON.stringify({
      auth: JSON.stringify({ isAuthenticated: true, user }),
      _persist: JSON.stringify({ version: -1, rehydrated: true })
    }));
  }, user);
  const errors = [];
  const mutations = [];
  page.on('pageerror', error => errors.push(error.message));
  let override;
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const method = route.request().method();
    if (method !== 'GET') mutations.push({ path, method, body: route.request().postDataJSON() });
    if (override && await override(route, path, method)) return;
    if (path === '/access-controls/me') return json(route, { permissions });
    if (path === '/roles') return json(route, { roles });
    if (path === '/sections') return json(route, { sections: [{ id: 10, name: 'A' }] });
    if (path === '/teachers') return json(route, { teachers: [{ id: 10, name: 'Fixture teacher' }] });
    if (path === '/notices/recipients/list') return json(route, { noticeRecipients: [] });
    // Unhandled endpoints fail loudly instead of reaching a live backend.
    return json(route, { message: `Unexpected test request: ${method} ${path}` }, 500);
  });
  const navigate = path => page.locator(`a[href="${path}"]:visible`).click();
  let checks = 0;
  const pass = label => { checks++; console.log(`PASS: ${label}`); };
  try {
    const cases = [
      { route: 'sections', endpoint: '/sections', label: 'Section Name', record: id => ({ id, name: `Section ${id}` }) },
      { route: 'departments', endpoint: '/departments', label: 'Department Name', record: id => ({ id, name: `Department ${id}` }) },
      { route: 'classes', endpoint: '/classes', label: 'Class Name', record: id => ({ id, name: `Class ${id}`, sections: 'A' }) },
      { route: 'class-teachers', endpoint: '/class-teachers', label: 'Class Name', record: id => ({ id, class: `Class ${id}`, section: 'A', teacher: 10 }) },
      { route: 'notices', endpoint: '/notices', label: 'Title', record: id => ({ id, title: `Notice ${id}`, description: `Description ${id}`, status: 1, authorId: 1, author: 'Fixture', createdDate: '2026-10-01', recipientType: 'EV', recipientRole: 0, firstField: '' }) },
      { route: 'notices/recipients', endpoint: '/notices/recipients', label: 'Recipient role', role: 'combobox', record: id => ({ id, roleId: 2, primaryDependentName: 'Department', primaryDependentSelect: 'departments' }) }
    ];
    for (const item of cases) {
      console.log(`Checking record navigation: ${item.route}`);
      const pending = defer();
      const requested = defer();
      override = async (route, path) => {
        if (path === `${item.endpoint}/101`) { await json(route, item.record(101)); return true; }
        if (path === `${item.endpoint}/102`) {
          requested.resolve();
          await pending.promise;
          await json(route, item.record(102));
          return true;
        }
        return false;
      };
      await page.goto(`/app/${item.route}/edit/101`);
      const field = page.getByRole(item.role || 'textbox', { name: item.label, exact: true });
      await field.waitFor();
      if (!item.role) await page.waitForFunction(label => [...document.querySelectorAll('input')]
        .some(input => input.value === label), Object.values(item.record(101)).find(value => typeof value === 'string'));
      await navigate(`/app/${item.route}/edit/102`);
      await requested.promise;
      try {
        await page.getByText(/loading/i).first().waitFor();
        assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).count(), 0,
          `${item.route}: the previous record must not be editable under the next ID`);
      } finally { pending.resolve(); }
      await field.waitFor();
      if (!item.role) {
        const expected = Object.values(item.record(102)).find(value => typeof value === 'string');
        await page.waitForFunction(value => [...document.querySelectorAll('input')]
          .some(input => input.value === value), expected);
        assert.equal(await field.inputValue(), expected,
          'The newly loaded edit form must belong to the new record');
      }
      pass(`${item.route}: changing record IDs hides the previous edit form until the new record loads`);
    }

    const rolePermissionsReady = defer();
    const rolePermissionsRequested = defer();
    let permissionsFailed = true;
    override = async (route, path) => {
      if (path === '/access-controls') {
        await json(route, { permissions: [{ id: 8, name: 'Students', path: 'students', type: 'UI', method: 'GET', subMenus: [] }] });
        return true;
      }
      if (path === '/roles/2/users') { await json(route, { users: [] }); return true; }
      if (path === '/roles/2/permissions') {
        rolePermissionsRequested.resolve();
        await rolePermissionsReady.promise;
        await json(route, permissionsFailed ? { message: 'Permission lookup unavailable' }
          : { permissions: [{ id: 8 }] }, permissionsFailed ? 503 : 200);
        return true;
      }
      return false;
    };
    await page.goto('/app/roles-and-permissions');
    await page.getByRole('tab', { name: 'teacher (1)', exact: true }).click();
    await page.getByRole('tab', { name: 'Permissions', exact: true }).click();
    await rolePermissionsRequested.promise;
    try {
      await page.getByRole('progressbar', { name: 'Loading role permissions' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).count(), 0);
    } finally { rolePermissionsReady.resolve(); }
    pass('Loading role permissions cannot be saved as an empty permission set');
    await page.getByText('Permission lookup unavailable', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).count(), 0);
    pass('Failed role-permission lookup cannot expose an empty editable permission set');
    permissionsFailed = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('cell', { name: 'Students', exact: true }).waitFor();
    assert(await page.getByRole('button', { name: 'Save', exact: true }).isEnabled());
    assert(await page.getByRole('row').filter({ hasText: 'Students' }).getByRole('checkbox').isChecked(),
      'Retry must recover the existing granted permission');
    pass('Permission lookup Retry restores existing grants instead of clearing them');

    override = async (route, path) => {
      if (path === '/access-controls') { await json(route, { message: 'Permission catalogue unavailable' }, 503); return true; }
      return false;
    };
    await page.goto('/app/roles-and-permissions');
    await page.getByText('Permission catalogue unavailable', { exact: false }).waitFor();
    assert.equal(await page.getByRole('tab', { name: 'teacher (1)', exact: true }).count(), 0);
    pass('Failed permission catalogue load blocks role editing and displays recovery action');
    assert.deepEqual(mutations, [], 'Read-only regression navigation must never submit mutations');
    assert.deepEqual(errors, [], 'No unhandled browser errors');
    console.log(JSON.stringify({ success: true, checks }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
