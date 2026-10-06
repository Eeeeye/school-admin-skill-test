/* Run against the local demo only: PRODUCT_URL=http://localhost:5173 node scripts/test-product-ui.cjs.
 * Requires Playwright and a Chrome/Chromium installation. No wallet extension or real funds are used.
 * NODE_PATH may point to an existing Playwright installation; CHROME_PATH overrides the browser.
 */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.PRODUCT_URL || 'http://localhost:5173';
const host = new URL(baseURL).hostname;
assert(['localhost', '127.0.0.1', '[::1]'].includes(host), 'UI smoke test is restricted to a local demo');
const username = process.env.PRODUCT_TEST_ADMIN_USERNAME || 'admin@school-admin.com';
const password = process.env.PRODUCT_TEST_ADMIN_PASSWORD || '3OU4zn3q6Zh9';
const stamp = Date.now();
let studentName = `UI smoke ${stamp}`;
const className = `UI class ${stamp}`;
const sectionName = `UI section ${stamp}`;
const title = `UI completion ${stamp}`;
const recipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' })
  });
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  const uncaught = [];
  page.on('pageerror', (error) => uncaught.push(error.message));
  page.setDefaultTimeout(20000);
  let studentId;
  let classId;
  let sectionId;
  let noticeId;
  let csrf;
  const request = async (path, options = {}) => {
    const response = await context.request.fetch(`/api/v1${path}`, {
      ...options, headers: { 'x-csrf-token': csrf || '', ...(options.headers || {}) }
    });
    return { response, data: await response.json().catch(() => null) };
  };
  try {
    await page.goto('/auth/login');
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.waitForURL('**/app');
    await page.getByRole('heading', { name: 'School workspace' }).waitFor();
    csrf = (await context.cookies()).find((cookie) => cookie.name === 'csrfToken')?.value;
    assert(csrf, 'Login sets a CSRF token');
    const config = await request('/certificates/config');
    assert.equal(config.data.available, true, 'Certificate network must be ready');
    assert.equal(config.data.demoMode, true, 'Only a local demonstration is permitted');
    for (const [path, label] of [
      ['/app/students', 'Student Information'], ['/app/classes', 'Class Information'],
      ['/app/class-teachers', 'Class Teacher Information'], ['/app/sections', 'Section Information'],
      ['/app/staffs', 'Staff Information'], ['/app/departments', 'Department Information'],
      ['/app/notices', 'Notices'], ['/app/notices/manage', 'Manage Notices'],
      ['/app/notices/recipients', 'Notice Recipients Information'],
      ['/app/leave/define', 'Leave Define'], ['/app/leave/pending', 'Pending Leave Requests'],
      ['/app/roles-and-permissions', 'Roles & Permissions Setting']
    ]) {
      await page.goto(path);
      await page.getByText(label, { exact: true }).last().waitFor();
      assert.equal(await page.getByText('No permission data available', { exact: true }).count(), 0);
      assert.equal(await page.getByText('Unknown Error', { exact: true }).count(), 0);
    }
    await page.goto('/app/staffs/add');
    await page.getByRole('combobox', { name: 'Department', exact: true }).waitFor();
    await page.goto('/app/notices/recipients');
    await page.getByLabel('Group recipients by', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Primary Dependent Select', { exact: true }).count(), 0, 'No SQL configuration field in the product');
    const sectionCreated = await request('/sections', { method: 'POST', data: { name: sectionName } });
    assert.equal(sectionCreated.response.status(), 200, JSON.stringify(sectionCreated.data));
    sectionId = (await request('/sections')).data.sections.find((row) => row.name === sectionName)?.id;
    assert(sectionId);
    const classCreated = await request('/classes', { method: 'POST', data: { name: className, sections: sectionName } });
    assert.equal(classCreated.response.status(), 200, JSON.stringify(classCreated.data));
    classId = (await request('/classes')).data.classes.find((row) => row.name === className)?.id;
    assert(classId);
    await page.goto('/app/students/add');
    await page.getByLabel('Full Name', { exact: true }).fill(studentName);
    await page.getByRole('combobox', { name: 'Gender', exact: true }).click();
    await page.getByRole('option', { name: 'Male', exact: true }).click();
    await page.getByLabel('Phone Number', { exact: true }).fill('123456789');
    await page.getByLabel('Email', { exact: true }).fill(`ui-${stamp}@example.invalid`);
    await page.getByRole('combobox', { name: 'Class', exact: true }).click();
    await page.getByRole('option', { name: className, exact: true }).click();
    await page.getByRole('combobox', { name: 'Section', exact: true }).click();
    await page.getByRole('option', { name: sectionName, exact: true }).click();
    await page.getByLabel('Roll', { exact: true }).fill('42');
    for (const [label, value] of [
      ['Father Name', 'Test parent'], ['Guardian Name', 'Test guardian'],
      ['Guardian Phone', '123456789'], ['Relation of Guardian', 'Parent'],
      ['Current Address', 'Test address'], ['Permanent Address', 'Test address']
    ]) await page.getByLabel(label, { exact: true }).fill(value);
    const [studentResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/api/v1/students') && response.request().method() === 'POST'),
      page.getByRole('button', { name: 'Save', exact: true }).click()
    ]);
    const created = await studentResponse.json();
    assert.equal(studentResponse.status(), 201, JSON.stringify(created));
    studentId = created.userId;
    assert(studentId, 'Student created through the form');
    await page.waitForURL('**/app/students');
    await page.goto(`/app/students/edit/${studentId}`);
    await page.waitForFunction((name) => document.querySelector('input[name="name"]')?.value === name, studentName);
    studentName += ' Edited';
    await page.getByLabel('Full Name', { exact: true }).fill(studentName);
    const [studentUpdated] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith(`/api/v1/students/${studentId}`) && response.request().method() === 'PUT'),
      page.getByRole('button', { name: 'Save', exact: true }).click()
    ]);
    assert.equal(studentUpdated.status(), 200, await studentUpdated.text());
    assert.equal((await request(`/students/${studentId}`)).data.name, studentName);
    await page.goto('/app/notices/add');
    await page.getByLabel('Title', { exact: true }).fill(`UI notice ${stamp}`);
    await page.getByLabel('Description', { exact: true }).fill('Persisted notice content from the real browser form.');
    await page.getByRole('combobox', { name: 'Status', exact: true }).click();
    await page.getByRole('option', { name: 'Draft', exact: true }).click();
    await page.getByRole('radio', { name: 'Specific', exact: true }).check();
    await page.getByRole('combobox', { name: 'Role', exact: true }).click();
    await page.getByRole('option', { name: /^student$/i }).click();
    await page.getByRole('combobox', { name: 'Class', exact: true }).click();
    await page.getByRole('option', { name: className, exact: true }).click();
    const [noticeResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/api/v1/notices') && response.request().method() === 'POST'),
      page.getByRole('button', { name: 'Save', exact: true }).click()
    ]);
    assert.equal(noticeResponse.status(), 200, await noticeResponse.text());
    noticeId = (await request('/notices')).data.notices.find((notice) => notice.title === `UI notice ${stamp}`)?.id;
    assert(noticeId, 'Draft notice saved');
    const notice = (await request(`/notices/${noticeId}`)).data;
    assert.equal(notice.description, 'Persisted notice content from the real browser form.');
    assert.equal(notice.firstField, className);
    await page.goto(`/app/notices/${noticeId}`);
    await page.getByText(notice.description, { exact: true }).waitFor();
    await page.goto(`/app/certificates?studentId=${studentId}`);
    await page.getByRole('button', { name: 'Issue certificate', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Student' }).waitFor();
    await page.waitForFunction((name) => document.querySelector('[role="dialog"] input[role="combobox"]')?.value.includes(name), studentName);
    await dialog.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await dialog.getByText(/No wallet detected/).waitFor();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    // Controlled EIP-1193 simulation tests UI event handling, not a real MetaMask installation.
    await page.evaluate(({ recipient, chainId }) => {
      const listeners = new Map();
      let rejected = false;
      let currentChain = '0x1';
      const calls = [];
      const emit = (event, payload) => (listeners.get(event) || []).forEach((listener) => listener(payload));
      window.ethereum = {
        on(event, listener) { listeners.set(event, [...(listeners.get(event) || []), listener]); },
        removeListener(event, listener) { listeners.set(event, (listeners.get(event) || []).filter((item) => item !== listener)); },
        async request({ method, params }) {
          calls.push(method);
          if (method === 'eth_requestAccounts') {
            if (!rejected) { rejected = true; throw { code: 4001, message: 'User rejected' }; }
            return [recipient];
          }
          if (method === 'eth_chainId') return currentChain;
          if (method === 'wallet_switchEthereumChain') throw { code: 4902, message: 'Unknown chain' };
          if (method === 'wallet_addEthereumChain') {
            if (params[0].chainId !== `0x${chainId.toString(16)}`) throw new Error('Unexpected chain');
            currentChain = params[0].chainId;
            emit('chainChanged', currentChain);
            return null;
          }
          throw new Error(`Unexpected wallet method ${method}`);
        }
      };
      window.__walletTest = { emit, calls, listenerCount: () => [...listeners.values()].flat().length };
    }, { recipient, chainId: Number(config.data.chainId) });
    await page.getByRole('button', { name: 'Issue certificate', exact: true }).click();
    await dialog.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await dialog.getByText(/The wallet request was cancelled/).waitFor();
    await dialog.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await dialog.getByRole('button', { name: 'Use this recipient address', exact: true }).click();
    assert.equal(await dialog.getByLabel('Student’s recipient address').inputValue(), recipient);
    await dialog.getByRole('button', { name: 'Switch network', exact: true }).click();
    await dialog.getByRole('button', { name: 'Switch network', exact: true }).waitFor({ state: 'hidden' });
    assert((await page.evaluate(() => window.__walletTest.calls)).includes('wallet_addEthereumChain'));
    await page.evaluate(() => window.__walletTest.emit('accountsChanged', []));
    await dialog.getByRole('button', { name: 'Connect wallet', exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Use this recipient address', exact: true }).waitFor({ state: 'hidden' });
    const changedAccount = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
    await page.evaluate((account) => window.__walletTest.emit('accountsChanged', [account]), changedAccount);
    await dialog.getByRole('button', { name: 'Use this recipient address', exact: true }).click();
    assert.equal(await dialog.getByLabel('Student’s recipient address').inputValue(), changedAccount);
    await page.evaluate(() => window.__walletTest.emit('disconnect', {}));
    await dialog.getByRole('button', { name: 'Use this recipient address', exact: true }).waitFor({ state: 'hidden' });
    await dialog.getByLabel('Certificate title').fill(title);
    await dialog.getByLabel('Description (public)').fill('Automated local end-to-end demonstration.');
    await dialog.getByLabel('Student’s recipient address').fill(recipient);
    await dialog.getByRole('button', { name: 'Issue certificate', exact: true }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 40000 });
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    await page.getByText('issued', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__walletTest.listenerCount()), 0, 'Wallet event listeners are removed on dialog close');
    await page.screenshot({ path: process.env.PRODUCT_LIST_SCREENSHOT || '/tmp/web3-product-certificate-list.png', fullPage: true });
    const verifyPath = await page.getByRole('link', { name: 'Verify', exact: true }).getAttribute('href');
    assert(verifyPath?.startsWith('/verify/0x'), 'Card exposes a public verification link');
    const publicContext = await browser.newContext({ baseURL });
    const publicPage = await publicContext.newPage();
    publicPage.on('pageerror', (error) => uncaught.push(error.message));
    await publicPage.goto(verifyPath);
    await publicPage.getByText('Valid certificate', { exact: true }).waitFor();
    await publicPage.getByRole('heading', { name: title, exact: true }).waitFor();
    await publicPage.screenshot({ path: process.env.PRODUCT_VERIFY_SCREENSHOT || '/tmp/web3-product-verified.png', fullPage: true });
    const metadataHref = await publicPage.getByRole('link', { name: 'View certificate metadata on IPFS' }).getAttribute('href');
    const metadataResponse = await publicContext.request.get(metadataHref);
    assert.equal(metadataResponse.status(), 200, 'IPFS metadata is accessible');
    const metadata = await metadataResponse.json();
    assert.equal(metadata.title, title);
    assert.equal(JSON.stringify(metadata).includes(studentName), false, 'Public metadata omits student name');
    await page.getByRole('button', { name: 'Revoke', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Revoke certificate', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 40000 });
    await page.getByText('revoked', { exact: true }).waitFor();
    await publicPage.reload();
    await publicPage.getByText('Certificate revoked', { exact: true }).waitFor();
    await publicPage.goto('/verify');
    await publicPage.getByLabel('Certificate ID or verification link').fill('invalid-id');
    await publicPage.getByRole('button', { name: 'Verify', exact: true }).click();
    await publicPage.getByText(/Enter a certificate ID starting with 0x/).waitFor();
    await page.goto(`/app/students/${studentId}`);
    await page.getByRole('link', { name: 'Student certificates', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Delete student', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete student', exact: true }).click();
    await page.waitForURL('**/app/students');
    const deleted = await request(`/students/${studentId}`);
    assert.equal(deleted.response.status(), 404);
    studentId = undefined;
    if (process.env.PRODUCT_DEMO_STUDENT_ID) {
      await page.goto(`/app/certificates?studentId=${encodeURIComponent(process.env.PRODUCT_DEMO_STUDENT_ID)}`);
      await page.getByRole('heading', { name: 'Backend Fundamentals (Demo)', exact: true }).waitFor();
      await page.getByText('issued', { exact: true }).waitFor();
      await page.screenshot({ path: '/tmp/web3-product-final.png', fullPage: true });
    }
    if (process.env.PRODUCT_DEMO_CERTIFICATE_ID) {
      await publicPage.goto(`/verify/${encodeURIComponent(process.env.PRODUCT_DEMO_CERTIFICATE_ID)}`);
      await publicPage.getByText('Valid certificate', { exact: true }).waitFor();
      await publicPage.screenshot({ path: '/tmp/web3-product-final-verify.png', fullPage: true });
    }
    await publicContext.close();
    assert.deepEqual(uncaught, [], 'No uncaught browser errors');
    console.log('UI PASS: login, all module routes, real student add/edit/delete forms, specific class notice save/read, certificate issue, simulated wallet lifecycle/rejection/network switch, wallet absence, public verification/IPFS, revoke, invalid ID, student delete');
  } catch (error) {
    await page.screenshot({ path: '/tmp/web3-product-ui-failure.png', fullPage: true }).catch(() => null);
    throw error;
  } finally {
    if (studentId) {
      const certificates = await request(`/certificates?studentId=${studentId}`).catch(() => null);
      for (const certificate of certificates?.data?.certificates || []) {
        if (certificate.status === 'issued') await request(`/certificates/${certificate.id}/revoke`, { method: 'POST' }).catch(() => null);
      }
      await request(`/students/${studentId}`, { method: 'DELETE' }).catch(() => null);
    }
    if (noticeId) await request(`/notices/${noticeId}/status`, { method: 'POST', data: { status: 6 } }).catch(() => null);
    if (classId) await request(`/classes/${classId}`, { method: 'DELETE' }).catch(() => null);
    if (sectionId) await request(`/sections/${sectionId}`, { method: 'DELETE' }).catch(() => null);
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
