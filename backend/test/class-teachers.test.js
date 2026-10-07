const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { ApiError } = require("../src/utils/api-error");

function loadWithMocks(relativePath, mocks) {
  const filename = require.resolve(relativePath);
  const original = Module._load;
  delete require.cache[filename];
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === filename && Object.hasOwn(mocks, request)) return mocks[request];
    return original.call(this, request, parent, isMain);
  };
  try { return require(filename); } finally { Module._load = original; }
}

function fixture({ teacherExists = true, duplicate = false, previous, failSync = false, sectionList = "A, B", extraSections = [] } = {}) {
  const queries = [];
  let released = false;
  const client = {
    query: async (sql, parameters) => {
      queries.push({ sql, parameters });
      if (sql.includes("SELECT sections FROM classes")) return { rows: [{ sections: sectionList }] };
      if (sql.includes("SELECT id, name FROM sections")) return { rows: [{ id: 1, name: "A" }, { id: 2, name: "B" }, ...extraSections] };
      if (sql.includes("role_id=2 FOR SHARE")) return { rows: teacherExists ? [{ id: 8 }] : [] };
      if (sql.includes("SELECT class_name, section_name")) return { rows: previous ? [previous] : [] };
      if (sql.includes("AND ($3::INTEGER IS NULL")) return { rows: duplicate ? [{ id: 1 }] : [] };
      if (sql.startsWith("UPDATE users") && failSync) throw new Error("injected student update failure");
      return { rows: [], rowCount: 1 };
    },
    release: () => { released = true; },
  };
  const repository = loadWithMocks("../src/modules/class-teacher/class-teacher-repository", {
    "../../utils": { ApiError }, "../../config": { db: { connect: async () => client } },
  });
  return { repository, queries, released: () => released };
}

test("teacher assignment commits the assignment and existing students' reporting line together", async () => {
  const { repository, queries, released } = fixture();
  await repository.addClassTeacher({ className: "Grade 1", section: "B", teacher: 8 });
  const sync = queries.find(({ sql }) => sql.startsWith("UPDATE users"));
  assert.deepEqual(sync.parameters, ["Grade 1", "B"]);
  assert.match(sync.sql, /u\.role_id=3/);
  assert.equal(queries.at(-1).sql, "COMMIT");
  assert.equal(released(), true);
});

test("teacher assignment resolves numeric section names before legacy IDs", async () => {
  const { repository } = fixture({ sectionList: "1", extraSections: [{ id: 7, name: "1" }] });
  await assert.rejects(repository.addClassTeacher({ className: "Grade 1", section: "A", teacher: 8 }), { statusCode: 400 });
  await repository.addClassTeacher({ className: "Grade 1", section: "1", teacher: 8 });
});

test("moving an assignment synchronizes students in both the old and new classes", async () => {
  const { repository, queries } = fixture({ previous: { class_name: "Old Grade", section_name: "A" } });
  await repository.updateClassTeacherById({ id: 1, className: "New Grade", section: "B", teacher: 8 });
  assert.deepEqual(queries.filter(({ sql }) => sql.startsWith("UPDATE users")).map(({ parameters }) => parameters),
    [["Old Grade", "A"], ["New Grade", "B"]]);
});

test("non-teachers, unrelated sections and duplicate assignments are rejected before writing", async () => {
  for (const [options, payload, statusCode] of [
    [{ teacherExists: false }, { section: "A" }, 400],
    [{}, { section: "C" }, 400],
    [{ duplicate: true }, { section: "A" }, 409],
  ]) {
    const { repository, queries, released } = fixture(options);
    await assert.rejects(repository.addClassTeacher({ className: "Grade 1", teacher: 8, ...payload }), { statusCode });
    assert.equal(queries.some(({ sql }) => sql.startsWith("INSERT INTO")), false);
    assert.equal(queries.at(-1).sql, "ROLLBACK");
    assert.equal(released(), true);
  }
});

test("reporting-line update failure rolls back the assignment", async () => {
  const { repository, queries, released } = fixture({ failSync: true });
  await assert.rejects(repository.addClassTeacher({ className: "Grade 1", section: "A", teacher: 8 }), { statusCode: 500 });
  assert.equal(queries.some(({ sql }) => sql === "COMMIT"), false);
  assert.equal(queries.at(-1).sql, "ROLLBACK");
  assert.equal(released(), true);
});
