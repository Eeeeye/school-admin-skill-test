const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const file = path.resolve(__dirname, '../src/utils/helpers/get-staff-permission.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const fixture = { exports: {} };
vm.runInNewContext(compiled, { module: fixture, exports: fixture.exports }, { filename: file });
const { canCreateStaff, canEditStaff, canDisableStaff, prepareStaffUpdate } = fixture.exports;

test('delegated profile editors cannot create staff identities or manage administrator targets', () => {
  for (const role of ['teacher', 'office-editor', 'student', undefined]) {
    assert.equal(canCreateStaff(role), false);
    for (const targetRole of [1, '1', 'admin']) {
      assert.equal(canEditStaff(role, targetRole), false);
      assert.equal(canDisableStaff(role, 9, targetRole, 1), false);
    }
  }
  assert.equal(canEditStaff('office-editor', 2), true, 'Delegated editors retain ordinary profile editing');
  assert.equal(canEditStaff('office-editor', 'teacher'), true, 'List and detail role representations agree');
  assert.equal(canEditStaff(undefined, 2), false);
});

test('administrators can manage staff but no actor can disable their own account', () => {
  assert.equal(canCreateStaff('admin'), true);
  assert.equal(canEditStaff('admin', 1), true);
  assert.equal(canEditStaff('admin', 2), true);
  assert.equal(canDisableStaff('admin', 1, 'teacher', 2), true);
  assert.equal(canDisableStaff('admin', 1, 'admin', 1), false);
  assert.equal(canDisableStaff('teacher', 2, 'teacher', 2), false);
});

test('a delegated edit keeps original login identity without losing permitted profile changes', () => {
  const original = { email: 'teacher@example.invalid', role: 2 };
  const values = { email: 'changed@example.invalid', role: 1, name: 'Updated name',
    departmentId: null, phone: '123456', systemAccess: true };
  const payload = prepareStaffUpdate(values, original, 'office-editor');
  assert.equal(payload.email, original.email);
  assert.equal(payload.role, original.role);
  assert.equal(payload.name, values.name);
  assert.equal(payload.departmentId, null);
  assert.equal(payload.phone, values.phone);
  assert.equal(payload.systemAccess, true);
  assert.equal(values.email, 'changed@example.invalid', 'Preparing a request must not mutate form data');
});

test('administrator identity changes remain available and unchanged fields are preserved', () => {
  const original = { email: 'teacher@example.invalid', role: 2 };
  const values = { email: 'updated@example.invalid', role: 4, name: 'Updated name' };
  assert.equal(prepareStaffUpdate(values, original, 'admin'), values);
  const delegated = prepareStaffUpdate({ ...original, name: 'Profile only' }, original, 'teacher');
  assert.equal(delegated.email, original.email);
  assert.equal(delegated.role, original.role);
  assert.equal(delegated.name, 'Profile only');
});
