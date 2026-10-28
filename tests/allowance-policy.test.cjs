const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const calc = require("../js/calculator.js");
const drawing = require("../js/drawing.js");
const data = require("../data/defaults.json");
const appSource = fs.readFileSync(path.join(__dirname, "../js/app.js"), "utf8");
const canPrintSource = appSource.match(
  /  function canPrint\(\) \{[\s\S]*?\n  \}/,
)?.[0];
assert.ok(canPrintSource);

function model(type = "single", effective = "450.9") {
  const m = calc.createModel(data);
  Object.assign(m, { boltType: type, mode: "direct", effective });
  return m;
}
function run(m) {
  const result = calc.calculate(m, data);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}
function canPrint(result, confirmed = false) {
  return vm.runInNewContext(`${canPrintSource}; canPrint()`, {
    calc,
    result,
    $: (id) => {
      assert.equal(id, "output-confirmed");
      return { checked: confirmed };
    },
  });
}
function hasAllowanceWarning(result) {
  return result.warnings.some((warning) =>
    warning.includes("ナットからの飛び出しが10 mmを超え"),
  );
}

test("ナットからの飛び出し9.9・10・10.1 mmの境界、10 mmまでは許容・超過は警告だけ", () => {
  for (const [effective, actual, warning] of [
    ["451.1", 9.9, false],
    ["451", 10, false],
    ["450.9", 10.1, true],
  ]) {
    const r = run(model("single", effective));
    assert.equal(r.selected, 480);
    assert.equal(r.protrusion.right, actual);
    assert.equal(hasAllowanceWarning(r), warning);
    assert.equal(r.status, warning ? "over" : "fit");
    assert.equal(calc.requiresOutputConfirmation(r), false);
    assert.equal(canPrint(r), true);
  }
  for (const [effective, actual, warning] of [
    ["161.2", 9.9, false],
    ["161", 10, false],
    ["160.8", 10.1, true],
  ]) {
    const r = run(model("double", effective));
    assert.equal(r.selected, 210);
    assert.equal(r.protrusion.left, actual);
    assert.equal(r.protrusion.right, actual);
    assert.equal(hasAllowanceWarning(r), warning);
    assert.equal(canPrint(r), true);
  }
});

test("警告時も候補・JSON保存・SVG出力・確認なしの印刷判定を維持", () => {
  const m = model();
  const r = run(m);
  assert.equal(r.effective, 450.9);
  assert.equal(r.required, 469.9);
  assert.equal(r.proposal, 480);
  assert.equal(r.selected, 480);
  assert.equal(r.projection.right, 20.1);
  assert.equal(canPrint(r), true);
  const document = calc.exportDocument(m, data);
  assert.equal(document.state, "calculated");
  assert.deepEqual(calc.importDocument(document, data), m);
  for (const options of [
    {},
    { compact: true },
    { compact: true, print: true },
  ]) {
    const svg = drawing.render(r, data, options);
    assert.ok(svg.includes('data-effective="450.9"'));
    assert.ok(svg.includes('data-selected="480"'));
    if (!options.compact)
      assert.ok(svg.includes("ナットからの飛び出しが10 mmを超え"));
  }
});

test("有効長を450.9→453へ変更すると再計算で警告が消え、余りを木部へ自動加算しない", () => {
  const m = model();
  assert.equal(hasAllowanceWarning(run(m)), true);
  assert.equal(m.effective, "450.9");
  m.effective = "453";
  const r = run(m);
  assert.equal(r.effective, 453);
  assert.equal(r.selected, 480);
  assert.equal(r.protrusion.right, 8);
  assert.equal(hasAllowanceWarning(r), false);
  assert.equal(canPrint(r), true);
});

test("10 mm超を指定でき、左右の最低限の座金からの出を配分で減らさない", () => {
  for (const [left, right] of [
    ["15", "10"],
    ["10", "15"],
    ["15", "15"],
  ]) {
    const m = model("double", left === right ? "250" : "262");
    Object.assign(m, { leftProjection: left, rightProjection: right });
    const r = run(m);
    assert.equal(r.selected, 300);
    assert.ok(r.projection.left >= Number(left));
    assert.ok(r.projection.right >= Number(right));
    assert.equal(r.projection.left + r.projection.right, 300 - r.coreLength);
    assert.equal(hasAllowanceWarning(r), left === right);
    assert.equal(canPrint(r), true);
    assert.deepEqual(
      calc.importDocument(calc.exportDocument(m, data), data),
      m,
    );
  }
  const single = model("single", "220");
  single.rightProjection = "15";
  assert.equal(run(single).required, 244);
  assert.equal(run(single).projection.right, 26);
});

test("不足・該当なしの既存確認だけは維持、入力エラーは印刷しない", () => {
  const shortModel = model("double", "277");
  shortModel.candidate = "210";
  for (const r of [run(shortModel), run(model("double", "600"))]) {
    assert.equal(calc.requiresOutputConfirmation(r), true);
    assert.equal(canPrint(r), false);
    assert.equal(canPrint(r, true), true);
  }
  assert.equal(canPrint({ ok: false }, true), false);
});

test("確認欄・ボタン・ブラウザ印刷前判定は同じ警告方針を参照", () => {
  assert.ok(
    appSource.includes(
      '$("output-confirmation").hidden = !calc.requiresOutputConfirmation(result)',
    ),
  );
  assert.ok(appSource.includes('$("print").disabled = !canPrint()'));
  assert.ok(
    appSource.includes(
      'document.body.classList.toggle("print-blocked", !canPrint())',
    ),
  );
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.ok(!html.includes("不足・締め代超過・該当なし"));
  assert.match(html, /ナットからの飛び出し10\s+mmまで許容/);
});
