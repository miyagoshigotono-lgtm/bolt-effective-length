const test = require("node:test");
const assert = require("node:assert/strict");
const calc = require("../js/calculator.js");
const data = require("../data/defaults.json");

function model(type = "single", effective = "138") {
  return Object.assign(calc.createModel(data), {
    boltType: type,
    mode: "direct",
    effective,
  });
}
function run(m) {
  const r = calc.calculate(m, data);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
function legacyDocument(candidate = "auto") {
  const m = model("double", "277");
  m.candidate = candidate;
  m.specVersion = "2026-10-09-bolt-depth";
  m.leftTightening = "3";
  m.rightTightening = "3";
  delete m.leftProjection;
  delete m.rightProjection;
  return {
    format: "bolt-effective-length",
    version: 4,
    specVersion: m.specVersion,
    state: "calculated",
    catalogVersion: data.catalogs.double.version,
    model: m,
    result: { required: 312, selected: 315 },
  };
}

test("最低10 mmはナット全厚へのかかり。10 mmナットを重ねて加算しない", () => {
  for (const [type, effective, selected] of [
    ["single", "131", 150],
    ["double", "181", 210],
  ]) {
    const r = run(model(type, effective));
    assert.equal(r.required, selected);
    assert.equal(r.selected, selected);
    assert.equal(r.projection.right, 10);
    assert.equal(r.engagement.right, 10);
    assert.equal(r.protrusion.right, 0);
    assert.equal(r.geometry.boltEnd - r.geometry.rightWasherFace, 10);
    assert.equal(r.geometry.rightOuter - r.geometry.boltEnd, 0);
    if (type === "double") {
      assert.equal(r.engagement.left, 10);
      assert.equal(r.geometry.leftWasherFace - r.geometry.boltStart, 10);
      assert.equal(r.geometry.boltStart - r.geometry.leftOuter, 0);
    }
    assert.equal(
      r.breakdown.reduce((n, row) => n + row.value, 0),
      r.required,
    );
    assert.ok(!r.breakdown.some((row) => row.label.includes("ナット")));
  }
});

test("座金から2.9〜20.1 mmの境界を、かかり・飛び出し・不足で区別", () => {
  for (const n of [29, 30, 99, 100, 101, 199, 200, 201]) {
    const m = model("single", String((1410 - n) / 10));
    m.candidate = "150";
    const r = run(m);
    assert.equal(r.projection.right, n / 10);
    assert.equal(r.engagement.right, Math.min(100, n) / 10);
    assert.equal(r.protrusion.right, Math.max(0, n - 100) / 10);
    assert.equal(r.status, n < 100 ? "short" : n > 200 ? "over" : "fit");
    assert.equal(calc.requiresOutputConfirmation(r), n < 100);
    assert.equal(
      r.warnings.some((w) => w.includes("ナットからの飛び出しが10 mmを超え")),
      n > 200,
    );
  }
});

test("最低かかり9.9 mmは拒否、10 mmから受け付ける", () => {
  const m = model();
  m.rightProjection = "9.9";
  assert.equal(calc.calculate(m, data).ok, false);
  m.rightProjection = "10";
  assert.equal(run(m).required, 157);
  m.rightProjection = "20";
  assert.equal(run(m).required, 167);
});

test("旧形式4の指定値を引き継いで再計算し、旧結果・原文は書き換えない", () => {
  for (const candidate of ["auto", "315"]) {
    const doc = legacyDocument(candidate);
    const original = JSON.stringify(doc);
    const m = calc.importDocument(doc, data);
    assert.equal(JSON.stringify(doc), original);
    assert.equal(m.specVersion, data.specVersion);
    assert.equal(m.leftProjection, "10");
    assert.equal(m.rightProjection, "10");
    assert.ok(!("leftTightening" in m));
    const r = run(m);
    assert.equal(r.required, 306);
    assert.equal(r.selected, 315);
    assert.equal(r.projection.left, 14.5);
    const exported = calc.exportDocument(m, data);
    assert.equal(exported.version, 6);
    assert.equal(exported.result.required, 306);
    assert.deepEqual(calc.importDocument(exported, data), m);
  }
});

test("旧形式4の途中入力を補完せず、版不一致や欠けた入力は拒否", () => {
  const draft = legacyDocument();
  draft.state = "draft";
  draft.model.rightTightening = "";
  const m = calc.importDocument(draft, data);
  assert.equal(m.rightProjection, "");
  assert.equal(calc.calculate(m, data).ok, false);
  for (const edit of [
    (doc) => {
      doc.version = 5;
    },
    (doc) => {
      doc.model.specVersion = data.specVersion;
    },
    (doc) => {
      delete doc.model.rightTightening;
    },
  ]) {
    const doc = legacyDocument();
    edit(doc);
    assert.throws(() => calc.importDocument(doc, data));
  }
});

test("全カタログ長・既知座金の組合せで、0.1 mmと左右配分と図の長さが一致", () => {
  for (const type of ["single", "double"])
    for (const length of data.catalogs[type].lengths)
      for (const part of data.parts.filter((p) => p.axial)) {
        const m = model(type);
        for (const side of ["left", "right"])
          m.washers[side] = {
            partId: part.id,
            axial: part.axial,
            outer: part.outer,
          };
        const ends =
          2 * Math.round(Number(part.axial) * 10) +
          (type === "single" ? 100 : 200);
        m.effective = String((length * 10 - ends) / 10);
        const r = run(m);
        assert.equal(r.required, length);
        assert.equal(r.selected, length);
        assert.equal(r.engagement.right, 10);
        assert.equal(r.protrusion.right, 0);
        assert.ok(
          Math.abs(r.geometry.boltEnd - r.geometry.boltStart - length) < 1e-9,
        );
        assert.equal(
          Math.round(r.coreLength * 10) + (type === "single" ? 100 : 200),
          length * 10,
        );
      }
});

test("自動候補はナット全厚10 mmを確保し、条件内の候補があれば必ず飛び出し10 mm以内", () => {
  for (const type of ["single", "double"])
    for (let ticks = 1; ticks <= 6000; ticks++) {
      const m = model(type, String(ticks / 10));
      const r = run(m);
      const count = type === "single" ? 1 : 2;
      const requiredTicks = ticks + 90 + count * 100;
      const valid = data.catalogs[type].lengths.filter(
        (n) => n * 10 >= requiredTicks && n * 10 <= ticks + 90 + count * 200,
      );
      if (r.selected == null) {
        assert.equal(valid.length, 0);
        continue;
      }
      assert.equal(r.engagement.right, 10);
      assert.ok(r.projection.right >= 10);
      if (type === "double") assert.equal(r.engagement.left, 10);
      if (valid.length) {
        assert.equal(r.selected, valid[0]);
        assert.equal(r.status, "fit");
        assert.ok(r.protrusion.left <= 10 && r.protrusion.right <= 10);
      } else {
        assert.equal(r.status, "over");
        assert.ok(
          r.warnings.some((w) =>
            w.includes("条件内のカタログ候補がありません"),
          ),
        );
        assert.equal(calc.requiresOutputConfirmation(r), false);
      }
      assert.equal(r.effective, ticks / 10);
    }
});

test("形式5の最低値だけ移行し、空欄・手動長・木部・原文を保護。新形式6も往復", () => {
  for (const values of [
    ["3", "9.9"],
    ["15", "10"],
    ["", "bad"],
    ["0", "2.9"],
  ]) {
    const m = model("double", "277");
    Object.assign(m, {
      specVersion: "2026-10-15-nut-engagement",
      leftProjection: values[0],
      rightProjection: values[1],
      candidate: "300",
    });
    const doc = {
      format: "bolt-effective-length",
      version: 5,
      specVersion: m.specVersion,
      state: "draft",
      catalogVersion: data.catalogs.double.version,
      model: m,
      result: { selected: 999 },
    };
    const raw = JSON.stringify(doc);
    const next = calc.importDocument(doc, data);
    assert.equal(JSON.stringify(doc), raw);
    assert.equal(next.candidate, "300");
    assert.equal(next.effective, "277");
    for (const [side, value] of [
      ["left", values[0]],
      ["right", values[1]],
    ])
      assert.equal(
        next[side + "Projection"],
        value === "3" || value === "9.9" ? "10" : value,
      );
    const exported = calc.exportDocument(next, data, true);
    assert.equal(exported.version, 6);
    assert.deepEqual(calc.importDocument(exported, data), next);
  }
});
