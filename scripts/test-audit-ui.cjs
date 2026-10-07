// Browser regressions for the application review. Only run against a local demo.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.PRODUCT_URL || 'http://localhost:5173';
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname));
const username = process.env.PRODUCT_TEST_ADMIN_USERNAME || 'admin@school-admin.com';
const password = process.env.PRODUCT_TEST_ADMIN_PASSWORD || '3OU4zn3q6Zh9';

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }) });
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let checks = 0;
  let noticeId;
  let departmentId;
  const api = async (path, method = 'GET', data) => {
    const csrf = (await context.cookies()).find(c => c.name === 'csrfToken')?.value || '';
    const response = await context.request.fetch(`/api/v1${path}`, { method, data,
      headers: { 'x-csrf-token': csrf } });
    const body = await response.json();
    assert(response.ok(), JSON.stringify(body));
    return body;
  };
  const check = name => { checks++; console.log(`PASS: ${name}`); };
  try {
    await page.goto('/auth/login');
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.waitForURL('**/app');
    await page.getByRole('heading', { name: 'School workspace' }).waitFor();

    for (const path of ['/app/students/2147483647', '/app/students/edit/2147483647',
      '/app/staffs/2147483647', '/app/staffs/edit/2147483647']) {
      await page.goto(path);
      await page.getByText(/not found|does not exist/i).first().waitFor();
      assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).count(), 0);
      check(`${path}: missing record displays an error without an editable blank record`);
    }

    // Two queries fail concurrently; delaying the real refresh makes the race repeatable.
    const expired = new Set();
    let refreshes = 0;
    await page.route('**/api/v1/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/auth/refresh')) {
        refreshes++;
        await new Promise(resolve => setTimeout(resolve, 250));
      } else if (['/api/v1/leave/request', '/api/v1/leave/policies/me'].includes(path) && !expired.has(path)) {
        expired.add(path);
        return route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"Expired token"}' });
      }
      return route.continue();
    });
    await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/api/v1/leave/request') && r.status() === 200),
      page.waitForResponse(r => r.url().endsWith('/api/v1/leave/policies/me') && r.status() === 200),
      page.goto('/app/leave/request')
    ]);
    await page.getByText('Leave Request History', { exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('[role="progressbar"]'));
    assert.equal(expired.size, 2);
    assert.equal(refreshes, 1, 'Concurrent expired requests share one refresh');
    assert(new URL(page.url()).pathname.startsWith('/app/'));
    await page.unroute('**/api/v1/**');
    check('Concurrent expired requests share one refresh and retain the session');

    let departmentReads = 0;
    await page.route('**/api/v1/departments', route => {
      if (route.request().method() === 'GET' && departmentReads++ === 0) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"departments":[]}' });
      }
      return route.continue();
    });
    await page.goto('/app/departments');
    await page.getByText('No records to display', { exact: false }).waitFor();
    const departmentName = `Browser review ${Date.now()}`;
    await page.getByLabel('Department Name', { exact: true }).fill(departmentName);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('cell', { name: departmentName, exact: true }).waitFor();
    departmentId = (await api('/departments')).departments.find(d => d.name === departmentName)?.id;
    assert(departmentId);
    assert(departmentReads >= 2);
    await page.unroute('**/api/v1/departments');
    check('Creating a department refreshes a previously empty list without a page reload');

    // Keep this in the same SPA: a full navigation would discard the cache and hide the bug.
    await page.locator('header').getByRole('button').last().click();
    await page.getByRole('menuitem', { name: 'Logout', exact: true }).click();
    await page.waitForURL('**/auth/login');
    let readsAfterLogin = 0;
    await page.route('**/api/v1/departments', route => {
      if (route.request().method() === 'GET') {
        readsAfterLogin++;
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"departments":[]}' });
      }
      return route.continue();
    });
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.waitForURL('**/app');
    await page.getByRole('button', { name: 'Human Resource', exact: true }).click();
    await page.locator('a[href="/app/departments"]:visible').click();
    await page.getByText('No records to display', { exact: false }).waitFor();
    assert(readsAfterLogin > 0, 'A new session must fetch its own data');
    assert.equal(await page.getByRole('cell', { name: departmentName, exact: true }).count(), 0);
    await page.unroute('**/api/v1/departments');
    check('Logout and new login clear the prior session query cache in the same SPA');

    // UI validation and network-failure feedback use controlled responses, not fake server evidence.
    let submissions = 0;
    await page.route('**/api/v1/leave/policies/me', route => route.fulfill({ status: 200,
      contentType: 'application/json', body: JSON.stringify({ leavePolicies: [
        { id: 999999, name: 'Browser regression policy', icon: '', totalDaysUsed: 0 }
      ] }) }));
    await page.route('**/api/v1/leave/request', route => {
      if (route.request().method() === 'POST') {
        submissions++;
        return route.fulfill({ status: 400, contentType: 'application/json',
          body: '{"message":"Regression: leave request rejected"}' });
      }
      return route.continue();
    });
    // The previous check ends on Departments. Enter Leave Request after installing its mocks.
    await page.goto('/app/leave/request');
    await page.getByRole('button', { name: 'Request Leave', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Note', { exact: true }).fill('Browser regression only');
    await dialog.getByLabel('From', { exact: true }).fill('');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await dialog.getByText(/valid.*date|required/i).first().waitFor();
    assert.equal(submissions, 0);
    check('Empty leave date is rejected before sending a request');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Request Leave', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Note', { exact: true }).fill('Browser regression only');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Regression: leave request rejected', { exact: true }).waitFor();
    assert.equal(submissions, 1);
    assert(await dialog.isVisible());
    check('Rejected leave request shows the server error and keeps the form open');
    await page.unroute('**/api/v1/leave/policies/me');
    await page.unroute('**/api/v1/leave/request');

    const title = `Review deletion ${Date.now()}`;
    await api('/notices', 'POST', { title, description: 'Fictional browser regression notice',
      status: 1, recipientType: 'EV' });
    noticeId = (await api('/notices')).notices.find(n => n.title === title)?.id;
    assert(noticeId);
    await page.goto(`/app/notices/${noticeId}`);
    await page.getByRole('button', { name: 'Delete notice', exact: true }).click();
    const deletion = page.waitForResponse(r => r.url().endsWith(`/notices/${noticeId}/status`));
    await page.getByRole('dialog').getByRole('button', { name: 'Yes', exact: true }).click();
    assert.equal((await deletion).status(), 200);
    await page.waitForURL('**/app/notices');
    assert.equal((await api(`/notices/${noticeId}`)).status, 6);
    check('Administrator notice deletion applies deleted status instead of requesting approval');

    const secondTab = await context.newPage();
    secondTab.on('pageerror', e => errors.push(e.message));
    await secondTab.goto('/auth/login');
    await secondTab.getByLabel('Username').fill(username);
    await secondTab.getByLabel('Password').fill(password);
    await secondTab.getByRole('button', { name: 'Sign In', exact: true }).click();
    await secondTab.waitForURL('**/app');
    await secondTab.getByRole('heading', { name: 'School workspace' }).waitFor();
    await page.waitForURL('**/auth/login');
    await page.getByLabel('Username').waitFor();
    await secondTab.close();
    check('A login in another tab invalidates the old tab identity and protected view');

    await page.goto('/verify');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel('Certificate ID or verification link').waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    check('Public verification fits a mobile viewport');
    assert.deepEqual(errors, [], 'No uncaught browser exceptions');
    console.log(`AUDIT UI PASS: ${checks} regression checks`);
  } catch (e) {
    await page.screenshot({ path: process.env.AUDIT_FAILURE_SCREENSHOT || '/tmp/school-audit-ui-failure.png', fullPage: true }).catch(() => {});
    throw e;
  } finally {
    // The browser context still holds the second tab's valid cookies even though the first
    // tab's Redux identity was cleared. Read the current CSRF cookie for each cleanup call.
    const cleanupErrors = [];
    if (noticeId) await api(`/notices/${noticeId}/status`, 'POST', { status: 6 })
      .catch(error => cleanupErrors.push(`Notice cleanup: ${error.message}`));
    if (departmentId) await api(`/departments/${departmentId}`, 'DELETE')
      .catch(error => cleanupErrors.push(`Department cleanup: ${error.message}`));
    await browser.close();
    if (cleanupErrors.length) {
      console.error('Browser regression fixture cleanup failed:', cleanupErrors);
      process.exitCode = 1;
    }
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
