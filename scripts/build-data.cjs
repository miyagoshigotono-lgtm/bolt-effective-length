const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const calc = require("../js/calculator.js");
const root = path.resolve(__dirname, "..");
const data = JSON.parse(
  fs.readFileSync(path.join(root, "data/defaults.json"), "utf8"),
);
for (const catalog of Object.values(data.catalogs)) {
  assert.equal(
    new Set(catalog.lengths).size,
    catalog.lengths.length,
    "掲載長に重複があります。",
  );
  assert.deepEqual(
    catalog.lengths,
    [...catalog.lengths].sort((a, b) => a - b),
    "掲載長の順序が不正です。",
  );
  assert.ok(
    catalog.lengths.every((length) => Number.isInteger(length) && length > 0),
    "掲載長が不正です。",
  );
}
const model = calc.createModel(data);
model.boltType = "double";
const result = calc.calculate(model, data);
assert.ok(
  result.ok &&
    result.effective === 277 &&
    result.required === 306 &&
    result.selected === 315,
  "柱105 − 座彫り28 + 逃げ200の計算が不整合です。",
);
assert.deepEqual(data.dimensions, {
  recess: 28,
  box: 58,
  nut: 10,
  boltDiameter: 12,
});
assert.deepEqual(data.selectionRules, {
  minimumProjection: 10,
  maximumProtrusion: 10,
});
const generated =
  "/* defaults.json から生成。変更は元の JSON に行う。 */\nwindow.BOLT_DEFAULTS = " +
  JSON.stringify(data, null, 2) +
  ";\n";
const target = path.join(root, "js/defaults.js");
if (process.argv.includes("--check")) {
  // 書き換えず、元データと生成物の意味を比較する。
  const vm = require("node:vm"),
    sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(target, "utf8"), sandbox);
  assert.deepEqual(
    JSON.parse(JSON.stringify(sandbox.window.BOLT_DEFAULTS)),
    data,
    "生成済みデータを更新してください。",
  );
  console.log("初期データの検証・生成物との一致を確認しました。");
} else {
  fs.writeFileSync(target, generated);
  console.log("初期データを検証し、生成しました。");
}
