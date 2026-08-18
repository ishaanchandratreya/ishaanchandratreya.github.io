let pass = 0, fail = 0;
const failures = [];

function T(name, fn) {
  try { fn(); pass++; process.stdout.write("."); }
  catch (e) { fail++; failures.push([name, e.message]); process.stdout.write("F"); }
}
function ok(v, msg) { if (!v) throw new Error(msg || "expected truthy, got " + v); }
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg ? msg + ": " : "") + "expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
}
function close(a, b, tol) {
  tol = tol === undefined ? 1e-9 : tol;
  if (!(Math.abs(a - b) <= tol)) throw new Error("expected ~" + b + " (±" + tol + "), got " + a);
}
function deepEq(a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error((msg ? msg + ": " : "") + "expected " + B + ", got " + A);
}
function report(label) {
  console.log("\n" + (label || "") + "  " + pass + " passed, " + fail + " failed");
  if (failures.length) {
    failures.forEach(([n, m]) => console.log("  FAIL  " + n + "\n        " + m));
    process.exitCode = 1;
  }
}
module.exports = { T, ok, eq, close, deepEq, report };
