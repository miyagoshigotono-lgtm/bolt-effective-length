const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const commands = [
  ["scripts/build-data.cjs", "--check"],
  ...[
    "js/defaults.js",
    "js/calculator.js",
    "js/drawing.js",
    "js/app.js",
    "js/suite.js",
    "js/site-assets.js",
    "sw.js",
    "scripts/build-data.cjs",
    "scripts/build-site.cjs",
    "scripts/check.cjs",
  ].map((file) => ["--check", file]),
];

for (const args of commands) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log("初期データとJavaScriptの構文を確認しました。");
