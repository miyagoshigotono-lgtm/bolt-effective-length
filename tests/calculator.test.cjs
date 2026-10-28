const test = require("node:test");
const assert = require("node:assert/strict");
const data = require("../data/defaults.json");
const calc = require("../js/calculator.js");
const drawing = require("../js/drawing.js");
const fs = require("node:fs");
const vm = require("node:vm");
function model(type = "double", effective = null) {
  const m = calc.createModel(data);
  m.boltType = type;
  if (effective != null) {
    m.mode = "direct";
    m.effective = String(effective);
  }
  return m;
}
function run(m) {
  const r = calc.calculate(m, data);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
test("柱105 − 座彫り28 + 逃げ200 = 有効長277", () => {
  const r = run(model());
  assert.equal(r.effective, 277);
  assert.equal(r.required, 306);
  assert.equal(r.selected, 315);
  assert.equal(r.nuts, 2);
  assert.deepEqual(r.projection, {
    left: 14.5,
    right: 14.5,
    rightShortfall: 0,
    requestedLeft: 10,
    requestedRight: 10,
  });
  assert.equal(r.geometry.start, 28);
  assert.equal(r.geometry.end, 305);
  assert.equal(r.geometry.boltEnd - r.geometry.boltStart, 315);
  assert.equal(
    r.breakdown.reduce((s, r) => s + r.value, 0),
    306,
  );
});
test("片引きは座金2枚、ナット1個、座金からの出1か所", () => {
  const r = run(model("single"));
  assert.equal(r.required, 296);
  assert.equal(r.selected, 300);
  assert.equal(r.nuts, 1);
  assert.equal(r.projection.left, 0);
  assert.equal(r.projection.right, 14);
  assert.equal(r.engagement.right, 10);
  assert.equal(r.protrusion.right, 4);
  assert.equal(r.geometry.boltStart, 23.5);
});
test("穴の内〜内を測り、箱〜箱・箱〜座彫り・座彫り〜座彫りに対応", () => {
  const m = model();
  m.leftSeat = "box";
  m.leftBoxPosition = "70";
  assert.equal(run(m).effective, 235);
  m.rightSeat = "recess";
  assert.equal(run(m).effective, 207);
  m.leftSeat = "recess";
  assert.equal(run(m).effective, 249);
});
test("直接入力では穴の種類を変えても有効長を動かさない", () => {
  const m = model("double", 225);
  for (const left of ["box", "recess"])
    for (const right of ["box", "recess"]) {
      m.leftSeat = left;
      m.rightSeat = right;
      assert.equal(run(m).effective, 225);
    }
});
test("ボルト深さと桁の幅・高さを有効長やボルト長へ加減しない", () => {
  const m = model();
  m.boltDepth = "60";
  m.beamHeight = "120";
  m.beamWidth = "120";
  const r = run(m);
  assert.equal(r.effective, 277);
  assert.equal(r.geometry.boltDepth, 60);
  assert.equal(r.required, 306);
  assert.equal(r.selected, 315);
});
test("種別は最初に必須、プリセット・固定30/40ルールはない", () => {
  assert.equal(calc.calculate(calc.createModel(data), data).ok, false);
  assert.equal(data.presets, undefined);
  assert.equal(model().rule, undefined);
  assert.equal(data.catalogs.single.lengths.length, 29);
  assert.equal(data.catalogs.double.lengths.length, 18);
});
test("資料の座金4種類と左右の組合せを反映", () => {
  for (const p of data.parts.filter((p) => p.id !== "custom")) {
    const m = model();
    m.washers.left = { partId: p.id, axial: p.axial, outer: p.outer };
    const r = run(m);
    assert.equal(r.required, 301.5 + Number(p.axial));
  }
  const m = model();
  m.washers.left = { partId: "spring", axial: "10.5", outer: "39" };
  m.washers.right = { partId: "tight", axial: "20.5", outer: "46.5" };
  const r = run(m);
  assert.equal(r.required, 328);
  assert.equal(r.selected, 330);
  assert.equal(r.geometry.leftOuter, 7.5);
  assert.equal(r.geometry.rightOuter, 335.5);
});
test("座金の手入力と未設定外形を分ける", () => {
  const m = model();
  m.washers.left = { partId: "custom", axial: "5.1", outer: "" };
  const r = run(m);
  assert.equal(r.required, 306.6);
  assert.ok(r.warnings.some((w) => w.includes("外形")));
  m.washers.left.axial = "";
  assert.equal(calc.calculate(m, data).ok, false);
  m.washers.left = { partId: "square", axial: "5", outer: "39" };
  assert.equal(calc.calculate(m, data).ok, false);
});
test("全掲載長の一致・0.1 mm超過・最大超過", () => {
  for (const type of ["single", "double"])
    for (const length of data.catalogs[type].lengths) {
      const end = type === "single" ? 19 : 29;
      const m = model(type, (length * 10 - end * 10) / 10);
      assert.equal(run(m).required, length);
      assert.equal(run(m).selected, length);
      m.effective = String((length * 10 - end * 10 + 1) / 10);
      assert.equal(
        run(m).selected,
        data.catalogs[type].lengths.find((n) => n > length) ?? null,
      );
    }
});
test("最小・最大候補を超える場合と余りによる座金からの出超過", () => {
  assert.equal(run(model("single", 1)).selected, 110);
  assert.equal(run(model("double", 1)).status, "over");
  const r = run(model("single", 450.9));
  assert.equal(r.required, 469.9);
  assert.equal(r.selected, 480);
  assert.equal(r.projection.right, 20.1);
  assert.equal(r.protrusion.right, 10.1);
  assert.equal(r.status, "over");
  assert.equal(r.effective, 450.9);
  const none = run(model("double", 600));
  assert.equal(none.status, "none");
  assert.equal(none.selected, null);
});
test("左右の最低かかりを守って配分し、0.1 mmの余りも保存", () => {
  const m = model("double", 276);
  m.leftProjection = "10";
  m.rightProjection = "20";
  const r = run(m);
  assert.equal(r.selected, 315);
  assert.equal(r.projection.left, 10);
  assert.equal(r.projection.right, 20);
  assert.equal(r.status, "fit");
  const odd = run(model("double", 276.9));
  assert.equal(odd.projection.left, 14.5);
  assert.equal(odd.projection.right, 14.6);
});
test("座金からの出は10 mm以上、10 mm超も計算を止めず片引きの左欄は未使用", () => {
  for (const v of ["9.9", "", "10.01"]) {
    const m = model();
    m.rightProjection = v;
    assert.equal(calc.calculate(m, data).ok, false);
  }
  for (const v of ["10", "10.1", "15", "20"]) {
    const m = model();
    m.rightProjection = v;
    run(m);
  }
  const m = model("single");
  m.leftProjection = "";
  run(m);
});
test("短い候補でも木部の距離を変更しない、負の座金からの出を表示しない", () => {
  const m = model();
  m.candidate = "210";
  const r = run(m);
  assert.equal(r.status, "short");
  assert.equal(r.effective, 277);
  assert.equal(r.projection.right, null);
  assert.equal(r.projection.rightShortfall, 96);
  assert.ok(r.warnings.some((w) => w.includes("不足")));
  m.boltType = "double";
  m.candidate = "255";
  assert.equal(calc.calculate(m, data).ok, false);
});
test("数値の不正・丸め・極端値を拒否", () => {
  for (const v of [
    "",
    "0",
    "-1",
    "0.01",
    "1e3",
    "Infinity",
    "NaN",
    "10000.1",
  ]) {
    const m = model("double", v);
    assert.equal(calc.calculate(m, data).ok, false, v);
  }
  assert.equal(run(model("double", "10000")).effective, 10000);
});
test("穴・部材の矛盾をエラーにする", () => {
  for (const [key, value] of [
    ["column", "28"],
    ["clearance", "0"],
    ["beamWidth", "57.9"],
    ["boltDepth", "105"],
    ["recessWidth", "106"],
  ]) {
    const m = model();
    m[key] = value;
    assert.equal(calc.calculate(m, data).ok, false, key);
  }
  const m = model();
  m.leftSeat = "box";
  for (const v of ["", "57.9", "105"]) {
    m.leftBoxPosition = v;
    assert.equal(calc.calculate(m, data).ok, false);
  }
});
test("ボルト深さを穴の底までの距離として納まり判定しない", () => {
  const m = model();
  assert.equal(m.boltDepth, "52");
  assert.equal(m.boxDepth, undefined);
  assert.equal(m.axisDepth, undefined);
  assert.equal(run(m).warnings.length, 0);
  m.boltDepth = "60";
  assert.equal(run(m).warnings.length, 0);
  m.washers.right = { partId: "custom", axial: "5", outer: "60" };
  assert.ok(run(m).warnings.some((w) => w.includes("幅を超え")));
  m.washers.left = { partId: "tight", axial: "20.5", outer: "46.5" };
  m.washers.right = { partId: "square", axial: "4.5", outer: "39" };
  m.boltDepth = "20";
  assert.ok(!run(m).warnings.some((w) => w.includes("収まり")));
});
test("JSONは新仕様6、保存された結果を信用せず再計算", () => {
  const m = model();
  const doc = calc.exportDocument(m, data);
  assert.equal(doc.version, 6);
  doc.result.effective = 1;
  assert.equal(run(calc.importDocument(doc, data)).effective, 277);
  const draft = model();
  draft.clearance = "";
  const d = calc.exportDocument(draft, data, true);
  assert.equal(d.state, "draft");
  assert.equal(d.result, null);
  assert.equal(calc.importDocument(d, data).clearance, "");
});
test("旧仕様・カタログ違い・破損JSONを拒否", () => {
  const doc = calc.exportDocument(model(), data);
  for (const changed of [
    { ...doc, version: 1 },
    { ...doc, specVersion: "old" },
    { ...doc, catalogVersion: "old" },
    { ...doc, model: null },
    { ...doc, model: { ...doc.model, leftSeat: "bad" } },
    { ...doc, model: { ...doc.model, specVersion: "old" } },
  ])
    assert.throws(() => calc.importDocument(changed, data));
  const old = { ...model(), specVersion: undefined };
  assert.throws(() => calc.validateShape(old, data, true));
});
function legacyDocument(axisDepth = "", boxDepth = "52", draft = false) {
  const doc = calc.exportDocument(model(), data);
  doc.version = 3;
  doc.specVersion = "2026-10-08-wood";
  doc.model.specVersion = doc.specVersion;
  doc.model.boxDepth = boxDepth;
  doc.model.axisDepth = axisDepth;
  doc.model.leftTightening = doc.model.leftProjection;
  doc.model.rightTightening = doc.model.rightProjection;
  delete doc.model.leftProjection;
  delete doc.model.rightProjection;
  delete doc.model.boltDepth;
  if (draft) {
    doc.state = "draft";
    doc.result = null;
  }
  return doc;
}
test("旧形式3の52 mmをボルト深さへ引き継ぎ、元データを変更しない", () => {
  for (const axisDepth of ["", "52", "52.0", 52]) {
    const doc = legacyDocument(axisDepth);
    doc.model.name = "保存していた構成";
    doc.model.clearance = "210";
    const original = JSON.stringify(doc);
    const next = calc.importDocument(doc, data);
    assert.equal(next.boltDepth, "52");
    assert.equal(next.boxDepth, undefined);
    assert.equal(next.axisDepth, undefined);
    assert.equal(next.name, "保存していた構成");
    assert.equal(next.clearance, "210");
    assert.equal(run(next).effective, 287);
    assert.equal(next.specVersion, data.specVersion);
    assert.equal(JSON.stringify(doc), original);
    assert.deepEqual(calc.upgradeModel(doc.model, data), next);
    assert.equal(calc.exportDocument(next, data).version, 6);
  }
  assert.equal(
    calc.importDocument(legacyDocument("", "", true), data).boltDepth,
    "",
  );
});
test("旧データの深さ2値が異なる場合は勝手に選ばず読み込みを拒否", () => {
  for (const axisDepth of ["26", "50", "0", "bad", null]) {
    const doc = legacyDocument(axisDepth);
    const original = JSON.stringify(doc);
    assert.throws(() => calc.importDocument(doc, data));
    assert.throws(() => calc.upgradeModel(doc.model, data));
    assert.equal(JSON.stringify(doc), original);
  }
});
test("ボルト深さは全ての穴の組合せで使い、材料の内部・0.1 mm単位に限定", () => {
  for (const leftSeat of ["box", "recess"])
    for (const rightSeat of ["box", "recess"]) {
      const m = model();
      Object.assign(m, { leftSeat, rightSeat, leftBoxPosition: "70" });
      assert.equal(run(m).geometry.boltDepth, 52);
      for (const value of ["", "0", "-1", "105", "106", "52.01", "NaN"]) {
        m.boltDepth = value;
        const r = calc.calculate(m, data);
        assert.equal(r.ok, false, value);
        assert.equal(r.errors[0].field, "boltDepth");
      }
      m.boltDepth = "52.1";
      assert.equal(run(m).geometry.boltDepth, 52.1);
    }
});
test("入力欄はボルト深さ1つ、旧穴深さ・別の芯深さ欄はない", () => {
  const html = fs.readFileSync(require.resolve("../index.html"), "utf8");
  assert.equal((html.match(/id="boltDepth"/g) || []).length, 1);
  assert.ok(html.includes("ボルト深さ<span"));
  assert.ok(!/id="(?:boxDepth|axisDepth|box-fields)"/.test(html));
  const app = fs.readFileSync(require.resolve("../js/app.js"), "utf8");
  assert.ok(!/boxDepth|axisDepth|box-fields/.test(app));
  assert.ok(app.includes("外ツラからボルト芯まで ${model.boltDepth} mm"));
});
test("画面・印刷・SVGに同じ寸法、外部参照なし・XMLエスケープ", () => {
  const m = model();
  m.name = '<script>&"図"';
  m.note = "長いメモ".repeat(200);
  const r = run(m);
  for (const options of [
    {},
    { compact: true },
    { compact: true, print: true },
  ]) {
    const svg = drawing.render(r, data, options);
    assert.ok(svg.includes('data-effective="277"'));
    assert.ok(svg.includes('data-selected="315"'));
    assert.ok(svg.includes('data-required="306"'));
    assert.ok(svg.includes('data-bolt-depth="52"'));
    assert.ok(svg.includes("ボルト深さ"));
    assert.ok(!/穴の深さ|ボルト中心.*未確認/.test(svg));
    assert.ok(!svg.includes("<script>"));
    assert.ok(!/NaN|Infinity/.test(svg));
    assert.ok(svg.includes("&lt;script&gt;"));
  }
});
test("生成済み初期データはJSONと一致", () => {
  const sandbox = { window: {} };
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../js/defaults.js"), "utf8"),
    sandbox,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(sandbox.window.BOLT_DEFAULTS)),
    data,
  );
});
