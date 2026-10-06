// Public configuration tokens, never SQL. Queries remain fixed in the repository.
const noticeAudienceForRole = (roleId) => {
  if (Number(roleId) === 2) return { primaryDependentName: "Department", primaryDependentSelect: "departments" };
  if (Number(roleId) === 3) return { primaryDependentName: "Class", primaryDependentSelect: "classes" };
  return { primaryDependentName: "", primaryDependentSelect: "none" };
};

module.exports = { noticeAudienceForRole };
