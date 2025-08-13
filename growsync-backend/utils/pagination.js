exports.parsePage = (v, def = 1) => Math.max(parseInt(v || def, 10), 1);
exports.parsePageSize = (v, def = 20, max = 200) => {
  const n = Math.max(parseInt(v || def, 10), 1);
  return Math.min(n, max);
};