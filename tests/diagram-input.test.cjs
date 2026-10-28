const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");
const root = path.resolve(__dirname, "..");
const workspaceKey = "bolt-effective-length.workspace.v1";

function setup(t, workspace = null, width = 1280) {
  const errors = [],
    virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error.message));
  // 実ブラウザへの接続は行わず、DOM上でアプリのイベントと保存処理を検証する。
  const dom = new JSDOM(
    fs.readFileSync(path.join(root, "index.html"), "utf8"),
    {
      url: "https://isolated-dom.test/",
      runScripts: "outside-only",
      virtualConsole,
    },
  );
  const w = dom.window,
    doc = w.document;
  w.innerWidth = width;
  w.innerHeight = 850;
  Object.defineProperty(w.SVGElement.prototype, "viewBox", {
    get() {
      const parts = (this.getAttribute("viewBox") || "0 0 1000 650")
        .split(/\s+/)
        .map(Number);
      return { baseVal: { width: parts[2], height: parts[3] } };
    },
  });
  Object.defineProperty(doc.getElementById("drawing-viewport"), "clientWidth", {
    get: () => width - 40,
  });
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  w.Element.prototype.scrollIntoView = function () {};
  w.scrollTo = (x, y) => {
    w.scrollX = x;
    w.scrollY = y;
  };
  let printed = 0;
  w.print = () => {
    printed++;
    w.dispatchEvent(new w.Event("beforeprint"));
    w.dispatchEvent(new w.Event("afterprint"));
  };
  const downloads = [];
  w.Blob = Blob;
  w.URL.createObjectURL = (blob) => {
    downloads.push(blob);
    return "blob:isolated";
  };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () {};
  if (workspace)
    w.localStorage.setItem(workspaceKey, JSON.stringify(workspace));
  for (const file of [
    "js/defaults.js",
    "js/calculator.js",
    "js/drawing.js",
    "js/app.js",
  ])
    w.eval(fs.readFileSync(path.join(root, file), "utf8"));
  t.after(() => {
    assert.deepEqual(errors, []);
    w.close();
  });
  const get = (selector) => {
    const el = doc.querySelector(selector);
    assert.ok(el, selector);
    return el;
  };
  const click = (selector) =>
    get(selector).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const input = (selector, value) => {
    const el = get(selector);
    el.value = value;
    el.dispatchEvent(new w.Event("input", { bubbles: true }));
  };
  const change = (selector, value) => {
    const el = get(selector);
    el.value = value;
    el.dispatchEvent(new w.Event("change", { bubbles: true }));
  };
  const type = (value = "double") => {
    const el = get(`[name=boltType][value=${value}]`);
    el.checked = true;
    el.dispatchEvent(new w.Event("change", { bubbles: true }));
  };
  const mode = (value) => {
    const el = get(`[name=mode][value=${value}]`);
    el.checked = true;
    el.dispatchEvent(new w.Event("change", { bubbles: true }));
  };
  return {
    w,
    doc,
    get,
    click,
    input,
    change,
    type,
    mode,
    downloads,
    printed: () => printed,
    result: () => w.BoltApp.getResult(),
    model: () => w.BoltApp.getModel(),
    open: (key) => click(`#drawing [data-edit="${key}"]`),
  };
}

test("最初から入力図を表示し、普段の入力はボルトと方式だけ、詳細・保存名は閉じる", (t) => {
  const a = setup(t);
  assert.equal(
    a.doc.querySelectorAll("#input-pane input[type=text], #input-pane select")
      .length,
    0,
  );
  assert.equal(a.get("#dimension-details").open, false);
  assert.equal(a.get("#file-details").open, false);
  assert.equal(a.get("#drawing svg").dataset.preview, "true");
  assert.equal(a.get("#drawing svg").dataset.selected, "");
  assert.equal(a.get("#download-svg").disabled, true);
  a.open("column");
  assert.equal(a.get("#diagram-value").value, "105");
  a.input("#diagram-value", "120");
  a.click("#close-diagram");
  a.mode("direct");
  assert.equal(a.model().effective, "292");
  a.type();
  assert.equal(a.result().effective, 292);
});

test("図の柱と穴位置を直接変更すると計算・保存・寸法の詳細が一致", (t) => {
  const a = setup(t);
  a.type();
  a.open("column");
  a.input("#diagram-value", "120");
  a.click("#close-diagram");
  assert.equal(a.result().effective, 292);
  assert.equal(a.get("#column").value, "120");
  a.open("clearance");
  a.input("#diagram-value", "250");
  a.click("#close-diagram");
  assert.equal(a.result().effective, 342);
  assert.equal(a.get("#drawing svg").dataset.effective, "342");
  assert.equal(
    JSON.parse(a.w.localStorage.getItem(workspaceKey)).current.model.clearance,
    "250",
  );
  assert.ok(a.get("#dimension-summary").textContent.includes("ボルト深さ 52"));
});

test("左右の穴を図から選び、左箱穴の未入力は勝手に補完せず入力欄へ進む", (t) => {
  const a = setup(t);
  a.type();
  a.open("leftSeat");
  a.change("#diagram-option", "box");
  assert.ok(a.get("#diagram-title").textContent.includes("左端"));
  assert.equal(a.get("#diagram-value").value, "");
  assert.equal(a.result().ok, false);
  assert.equal(a.get("#drawing svg").dataset.preview, "true");
  a.input("#diagram-value", "70");
  a.click("#close-diagram");
  assert.equal(a.result().effective, 235);
  a.open("rightSeat");
  a.change("#diagram-option", "recess");
  a.click("#close-diagram");
  assert.equal(a.result().effective, 207);
  a.open("leftSeat");
  a.change("#diagram-option", "recess");
  a.click("#close-diagram");
  assert.equal(a.result().effective, 249);
});

test("座金を図から選択し厚さを自動設定、その他の座金だけ実寸入力", (t) => {
  const a = setup(t);
  a.type();
  a.open("washer-right");
  a.change("#diagram-option", "spring");
  assert.equal(a.model().washers.right.axial, "10.5");
  assert.equal(a.get("#diagram-custom-fields").hidden, true);
  assert.equal(a.result().required, 312);
  a.change("#diagram-option", "custom");
  assert.equal(a.result().ok, false);
  assert.equal(a.get("#diagram-custom-fields").hidden, false);
  a.input("#diagram-axial", "5.1");
  a.input("#diagram-outer", "39");
  assert.equal(a.result().required, 306.6);
  assert.equal(a.get("#washer-right-axial").value, "5.1");
  a.click("#close-diagram");
});

test("有効長を図から調整し警告を消せる、警告があっても印刷できる", (t) => {
  const a = setup(t);
  a.type("single");
  a.mode("direct");
  a.open("effective");
  a.input("#diagram-value", "451");
  a.click("#close-diagram");
  assert.equal(a.result().protrusion.right, 10);
  assert.equal(a.get("#print").disabled, false);
  assert.equal(a.get("#output-confirmation").hidden, true);
  a.click("#print");
  assert.equal(a.printed(), 1);
  a.open("effective");
  a.input("#diagram-value", "453");
  a.click("#close-diagram");
  assert.equal(a.result().protrusion.right, 8);
  assert.equal(a.get("#warnings").textContent, "");
});

test("途中の空欄や小数第2位では結果を消し、入力図から修正・再開できる", (t) => {
  const a = setup(t);
  a.type();
  a.open("column");
  a.input("#diagram-value", "");
  assert.equal(a.result().ok, false);
  assert.equal(a.get("#result-selected").textContent, "--");
  assert.equal(a.get("#drawing svg").dataset.selected, "");
  assert.equal(a.get("#download-svg").disabled, true);
  assert.ok(a.get("#diagram-error").textContent);
  a.click("#close-diagram");
  a.open("column");
  assert.equal(a.get("#diagram-value").value, "");
  a.input("#diagram-value", "105.01");
  assert.equal(a.result().ok, false);
  a.input("#diagram-value", "105");
  assert.equal(a.result().selected, 315);
});

test("図の数値変更と穴選択を元に戻す・やり直す、再読み込みの入力も維持", (t) => {
  const a = setup(t);
  a.type();
  a.open("clearance");
  a.input("#diagram-value", "210");
  a.click("#close-diagram");
  assert.equal(a.result().effective, 287);
  a.click("#undo");
  assert.equal(a.result().effective, 277);
  a.click("#redo");
  assert.equal(a.result().effective, 287);
  const b = setup(t, JSON.parse(a.w.localStorage.getItem(workspaceKey)));
  assert.equal(b.model().clearance, "210");
  assert.equal(b.get("#dimension-details").open, false);
  b.open("clearance");
  assert.equal(b.get("#diagram-value").value, "210");
});

test("キーボードで図を開き、Escで閉じる。縦図も同じ入力先につながる", (t) => {
  const a = setup(t);
  a.type();
  a.get('#drawing [data-edit="column"]').dispatchEvent(
    new a.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  assert.equal(a.get("#diagram-editor").hidden, false);
  a.get("#diagram-editor").dispatchEvent(
    new a.w.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(a.get("#diagram-editor").hidden, true);
  a.change("#direction", "vertical");
  a.open("column");
  a.input("#diagram-value", "120");
  assert.equal(a.result().effective, 292);
  assert.ok(
    a.get("#drawing svg").getAttribute("viewBox").startsWith("0 0 750"),
  );
});

test("保存名・メモの移動後も保存とJSON・SVG書出しは同じ計算結果", async (t) => {
  const a = setup(t);
  a.type();
  a.input("#name", "入力図テスト");
  a.input("#note", "確認用");
  a.click("#save");
  const saved = JSON.parse(
    a.w.localStorage.getItem("bolt-effective-length.saved.v1"),
  );
  assert.equal(saved.items[0].document.model.name, "入力図テスト");
  a.click("#export");
  const doc = JSON.parse(await a.downloads.at(-1).text());
  assert.equal(doc.result.effective, 277);
  a.click("#download-svg");
  const svg = await a.downloads.at(-1).text();
  assert.ok(!svg.includes("data-edit="));
  assert.ok(svg.includes('data-selected="315"'));
  assert.ok(!a.get("#print-drawing").innerHTML.includes("data-edit="));
  assert.ok(
    !a.w.BoltDrawing.render(a.result(), a.w.BOLT_DEFAULTS, {
      print: true,
      interactive: true,
    }).includes("data-edit="),
  );
});

test("320・700・1440の幅でも編集先・入力・数値は一致し、図の最小幅を確保", (t) => {
  for (const width of [320, 700, 1440]) {
    const a = setup(t, null, width);
    a.type();
    a.open("clearance");
    a.input("#diagram-value", "210");
    assert.equal(a.result().effective, 287);
    assert.ok(parseFloat(a.get("#drawing").style.width) >= 619.9);
    assert.equal(
      a.get("#diagram-editor").parentElement.id,
      "diagram-workbench",
    );
  }
});

test("図入力後の構成を保存一覧から開け、JSONの読込と不正JSON拒否も維持", async (t) => {
  const a = setup(t);
  a.type();
  a.open("clearance");
  a.input("#diagram-value", "210");
  a.click("#close-diagram");
  a.click("#save");
  a.click("#reset");
  a.click("#open-saved");
  a.click('#saved-list button[title="開く"]');
  assert.equal(a.result().effective, 287);
  const doc = a.w.BoltCalc.exportDocument(a.model(), a.w.BOLT_DEFAULTS);
  doc.model.clearance = "220";
  const file = a.get("#import-file");
  Object.defineProperty(file, "files", {
    configurable: true,
    value: [
      { name: "input.json", size: 300, text: async () => JSON.stringify(doc) },
    ],
  });
  file.dispatchEvent(new a.w.Event("change", { bubbles: true }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(a.result().effective, 297);
  a.open("clearance");
  assert.equal(a.get("#diagram-value").value, "220");
  a.click("#close-diagram");
  Object.defineProperty(file, "files", {
    configurable: true,
    value: [{ name: "bad.json", size: 4, text: async () => "bad" }],
  });
  file.dispatchEvent(new a.w.Event("change", { bubbles: true }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(a.result().effective, 297);
});

test("旧自動保存は原文を退避し、かかり量の訂正を通知して候補を再計算", (t) => {
  const calc = require("../js/calculator.js"),
    data = require("../data/defaults.json");
  const legacy = calc.createModel(data);
  Object.assign(legacy, {
    specVersion: "2026-10-09-bolt-depth",
    boltType: "double",
    leftTightening: "3",
    rightTightening: "3",
  });
  delete legacy.leftProjection;
  delete legacy.rightProjection;
  const workspace = {
    version: 1,
    current: { model: legacy, savedId: null },
    history: [{ model: legacy, savedId: null }],
    catalogVersions: { double: data.catalogs.double.version },
  };
  const raw = JSON.stringify(workspace);
  const a = setup(t, workspace);
  const recovery = Object.keys(a.w.localStorage).filter((key) =>
    key.startsWith(workspaceKey + ".recovery."),
  );
  assert.equal(recovery.length, 1);
  assert.equal(a.w.localStorage.getItem(recovery[0]), raw);
  assert.equal(a.model().specVersion, data.specVersion);
  assert.equal(a.model().rightProjection, "10");
  assert.equal(a.result().required, 306);
  assert.equal(a.result().selected, 315);
  assert.equal(a.get("#result-available").textContent, "左 14.5\n右 14.5");
  assert.equal(a.get("#result-engaged").textContent, "左 10 mm / 右 10 mm");
  assert.equal(
    a.get("#result-protruding").textContent,
    "左 4.5 mm / 右 4.5 mm",
  );
  assert.ok(a.doc.body.textContent.includes("必要長と候補を確認してください"));
});

test("上段のかかり量は座金から先端まで。ナット内10と外3.5なら左右13.5", async (t) => {
  const a = setup(t);
  a.type();
  a.mode("direct");
  a.input("#effective", "264");
  assert.equal(a.result().selected, 300);
  assert.equal(a.get("#result-available").textContent, "左 13.5\n右 13.5");
  assert.equal(a.get("#result-engaged").textContent, "左 10 mm / 右 10 mm");
  assert.equal(
    a.get("#result-protruding").textContent,
    "左 3.5 mm / 右 3.5 mm",
  );
  assert.equal(a.doc.querySelector("#result-end"), null);
  const metric = a.get("#result-available").closest(".metric");
  assert.ok(metric.classList.contains("projection-metric"));
  assert.ok(metric.textContent.includes("かかり量 (mm)"));
  assert.ok(
    !a.get("#result-section").textContent.includes("座金・最低かかり量"),
  );
  assert.ok(
    a
      .get("#print-conditions")
      .textContent.includes("かかり量：左 13.5 mm / 右 13.5 mm"),
  );
  for (const id of ["drawing", "print-drawing"])
    assert.ok(
      a.get(`#${id}`).textContent.replace(/\s+/g, "").includes("かかり量13.5"),
    );
  a.click("#export");
  const doc = JSON.parse(await a.downloads.at(-1).text());
  assert.equal(doc.version, 6);
  assert.equal(doc.result.endLength, 29);
  assert.equal(doc.result.projection.left, 13.5);
  assert.equal(doc.result.projection.right, 13.5);
  a.click("#download-svg");
  const svg = await a.downloads.at(-1).text();
  assert.ok(svg.includes("かかり量 13.5"));
});

test("かかり量は左右別々。片引きは右のみ、最低値やナット厚に置き換えない", (t) => {
  const a = setup(t);
  a.type();
  a.mode("direct");
  a.input("#effective", "276.9");
  assert.equal(a.get("#result-available").textContent, "左 14.5\n右 14.6");
  a.input("#effective", "276");
  a.input("#rightProjection", "20");
  assert.equal(a.get("#result-available").textContent, "左 10\n右 20");
  a.input("#rightProjection", "10");
  a.type("single");
  a.input("#effective", "277");
  assert.equal(a.get("#result-available").textContent, "右 14");
  a.input("#effective", "131");
  assert.equal(a.get("#result-available").textContent, "右 10");
  assert.ok(
    a
      .get("#rightProjection")
      .closest(".field")
      .textContent.includes("右の最低かかり量"),
  );
});

test("かかり量は未到達・候補なし・途中入力を数値に見せず、保存からの復帰も一致", (t) => {
  const a = setup(t);
  a.type();
  a.mode("direct");
  a.input("#effective", "264");
  const b = setup(t, JSON.parse(a.w.localStorage.getItem(workspaceKey)));
  assert.equal(b.get("#result-available").textContent, "左 13.5\n右 13.5");
  a.change("#candidate", "210");
  assert.equal(a.get("#result-available").textContent, "左 10\n右 未到達");
  a.change("#candidate", "auto");
  a.input("#effective", "601");
  assert.equal(a.get("#result-available").textContent, "--");
  a.input("#effective", "");
  assert.equal(a.get("#result-available").textContent, "--");
  assert.equal(a.get("#result-engaged").textContent, "--");
  assert.equal(a.get("#result-protruding").textContent, "--");
});

function step(a, id, direction) {
  a.click(`[data-input="${id}"][data-step="${direction}"]`);
}

test("数値欄の右側に上下ボタン、ラベル関連付け・アイコン・固定寸法の保護を維持", (t) => {
  const a = setup(t);
  a.w.eval(fs.readFileSync(path.join(root, "vendor/lucide.min.js"), "utf8"));
  a.w.lucide.createIcons();
  for (const input of a.doc.querySelectorAll('input[inputmode="decimal"]')) {
    const box = input.closest(".number-input");
    assert.ok(box, input.id);
    assert.equal(box.querySelectorAll("[data-step]").length, 2);
    assert.ok(input.labels.length > 0, input.id);
    for (const button of box.querySelectorAll("[data-step]")) {
      assert.equal(button.type, "button");
      assert.equal(button.getAttribute("aria-controls"), input.id);
      assert.ok(button.title.includes("1 mm"));
      assert.equal(button.closest("label"), null);
      assert.ok(button.querySelector("svg"));
      if (input.readOnly) assert.equal(button.disabled, true);
    }
  }
  assert.equal(a.get("#name").closest(".number-input"), null);
  assert.equal(a.get("#note").closest(".number-input"), null);
});

test("図の有効長を上下1 mmずつ変更し、小数部分・手入力・フォーカスを維持", (t) => {
  const a = setup(t);
  a.type();
  a.mode("direct");
  a.open("effective");
  step(a, "diagram-value", 1);
  assert.equal(a.get("#diagram-value").value, "278");
  assert.equal(a.get("#effective").value, "278");
  assert.equal(a.result().effective, 278);
  assert.equal(a.get("#diagram-editor").hidden, false);
  step(a, "diagram-value", -1);
  assert.equal(a.result().effective, 277);
  a.input("#diagram-value", "277.5");
  step(a, "diagram-value", 1);
  assert.equal(a.model().effective, "278.5");
  assert.equal(a.get("#drawing svg").dataset.effective, "278.5");
  step(a, "diagram-value", -1);
  assert.equal(a.model().effective, "277.5");
  a.get("#diagram-value").dispatchEvent(
    new a.w.KeyboardEvent("keydown", {
      key: "ArrowUp",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(a.result().effective, 278.5);
  assert.equal(a.doc.activeElement.id, "diagram-value");
  a.get("#diagram-value").dispatchEvent(
    new a.w.KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(a.result().effective, 277.5);
  a.input("#diagram-value", "280.2");
  assert.equal(a.result().effective, 280.2);
});

test("柱・穴位置・詳細の値を上下ボタンで変更し、左右の穴と縦図も同じ入力へ反映", (t) => {
  const a = setup(t);
  a.type();
  a.open("column");
  step(a, "diagram-value", 1);
  assert.equal(a.model().column, "106");
  assert.equal(a.result().effective, 278);
  a.click("#close-diagram");
  a.open("clearance");
  step(a, "diagram-value", -1);
  assert.equal(a.model().clearance, "199");
  assert.equal(a.result().effective, 277);
  a.click("#close-diagram");
  a.change("#leftSeat", "box");
  a.input("#leftBoxPosition", "70");
  a.change("#direction", "vertical");
  a.open("leftBoxPosition");
  step(a, "diagram-value", 1);
  assert.equal(a.model().leftBoxPosition, "71");
  assert.equal(a.result().effective, 234);
  a.click("#close-diagram");
  step(a, "clearance", 1);
  assert.equal(a.model().clearance, "200");
  assert.equal(a.result().effective, 235);
  a.open("clearance");
  assert.equal(a.get("#diagram-value").value, "200");
});

test("空欄や不正な数値は上下ボタンで補完・丸めせず、手入力の訂正後に再開", (t) => {
  const a = setup(t);
  a.type();
  a.mode("direct");
  a.open("effective");
  for (const value of ["", "277.55", "1e3", "abc", "-1"]) {
    a.input("#diagram-value", value);
    for (const direction of [1, -1]) {
      assert.equal(
        a.get(`[data-input="diagram-value"][data-step="${direction}"]`)
          .disabled,
        true,
      );
      step(a, "diagram-value", direction);
    }
    assert.equal(a.model().effective, value);
    assert.equal(a.get("#result-selected").textContent, "--");
  }
  a.input("#diagram-value", "277.1");
  for (let i = 0; i < 10; i++) step(a, "diagram-value", 1);
  assert.equal(a.model().effective, "287.1");
  for (let i = 0; i < 10; i++) step(a, "diagram-value", -1);
  assert.equal(a.model().effective, "277.1");
});

test("数値の最小・最大境界は1 mm刻みを崩さず、最低かかり10 mmと0 mmの穴位置を維持", (t) => {
  const a = setup(t);
  a.type();
  a.mode("direct");
  a.input("#effective", "0.5");
  assert.equal(
    a.get('[data-input="effective"][data-step="-1"]').disabled,
    true,
  );
  step(a, "effective", -1);
  assert.equal(a.model().effective, "0.5");
  step(a, "effective", 1);
  assert.equal(a.model().effective, "1.5");
  a.input("#effective", "10000");
  assert.equal(a.get('[data-input="effective"][data-step="1"]').disabled, true);
  step(a, "effective", 1);
  assert.equal(a.model().effective, "10000");
  step(a, "effective", -1);
  assert.equal(a.model().effective, "9999");
  assert.equal(
    a.get('[data-input="rightProjection"][data-step="-1"]').disabled,
    true,
  );
  step(a, "rightProjection", 1);
  assert.equal(a.model().rightProjection, "11");
  step(a, "rightProjection", -1);
  assert.equal(a.model().rightProjection, "10");
  a.input("#clearance", "0");
  assert.equal(
    a.get('[data-input="clearance"][data-step="-1"]').disabled,
    true,
  );
  step(a, "clearance", 1);
  assert.equal(a.model().clearance, "1");
  step(a, "clearance", -1);
  assert.equal(a.model().clearance, "0");
});

test("座金の再描画後も上下ボタンは重複せず、固定値と手入力可能な寸法を区別", (t) => {
  const a = setup(t);
  a.type();
  a.open("washer-right");
  a.change("#diagram-option", "flat");
  const fixed = a.get('[data-input="diagram-axial"][data-step="1"]');
  assert.equal(fixed.disabled, true);
  step(a, "diagram-axial", 1);
  assert.equal(a.model().washers.right.axial, "4.5");
  a.input("#diagram-outer", "39");
  step(a, "diagram-outer", 1);
  assert.equal(a.model().washers.right.outer, "40");
  a.change("#diagram-option", "custom");
  a.input("#diagram-axial", "5.1");
  a.input("#diagram-outer", "39");
  step(a, "diagram-axial", 1);
  assert.equal(a.model().washers.right.axial, "6.1");
  assert.equal(a.get("#washer-right-axial").value, "6.1");
  a.click("#close-diagram");
  step(a, "washer-right-axial", -1);
  assert.equal(a.model().washers.right.axial, "5.1");
  assert.equal(
    a.doc.querySelectorAll('[data-input="washer-right-axial"]').length,
    2,
  );
  assert.equal(a.doc.querySelectorAll("label button[data-step]").length, 0);
});

test("上下変更で飛び出し警告を再計算し、印刷・保存・SVG・履歴も同じ数値", async (t) => {
  const a = setup(t);
  a.type("single");
  a.mode("direct");
  a.input("#effective", "450");
  a.open("effective");
  assert.equal(a.result().protrusion.right, 11);
  step(a, "diagram-value", 1);
  assert.equal(a.result().protrusion.right, 10);
  assert.equal(a.get("#warnings").textContent, "");
  assert.equal(a.get("#print").disabled, false);
  a.click("#close-diagram");
  a.click("#undo");
  assert.equal(a.result().effective, 450);
  a.click("#redo");
  assert.equal(a.result().effective, 451);
  const b = setup(t, JSON.parse(a.w.localStorage.getItem(workspaceKey)));
  assert.equal(b.result().effective, 451);
  a.click("#save");
  a.click("#export");
  const doc = JSON.parse(await a.downloads.at(-1).text());
  assert.equal(doc.result.effective, 451);
  a.click("#download-svg");
  assert.ok((await a.downloads.at(-1).text()).includes('data-effective="451"'));
  assert.ok(
    a.get("#print-conditions").textContent.includes("かかり量：右 20 mm"),
  );
});

test("狭い画面設定でも上下ボタンの入力先と1 mm増減は一致し、キーボードでも操作可能", (t) => {
  for (const width of [320, 700, 1440]) {
    const a = setup(t, null, width);
    a.type();
    a.open("clearance");
    const button = a.get('[data-input="diagram-value"][data-step="1"]');
    button.focus();
    button.click();
    assert.equal(a.model().clearance, "201");
    assert.equal(a.doc.activeElement, button);
    step(a, "diagram-value", -1);
    assert.equal(a.model().clearance, "200");
    assert.equal(a.get("#diagram-editor").hidden, false);
  }
});

test("編集欄は図と同じ領域の非モーダル。暗幕や操作制限なしで図の編集先を切り替える", (t) => {
  const a = setup(t);
  let modalCount = 0;
  a.w.HTMLDialogElement.prototype.showModal = () => {
    modalCount++;
  };
  a.type();
  a.open("clearance");
  assert.equal(a.get("#diagram-editor").tagName, "SECTION");
  assert.equal(a.get("#diagram-editor").hidden, false);
  assert.equal(
    a.get("#diagram-editor").closest(".drawing-section"),
    a.get("#drawing-viewport").closest(".drawing-section"),
  );
  assert.equal(a.get("#diagram-workbench").classList.contains("editing"), true);
  assert.equal(a.doc.querySelector('[aria-modal="true"], [inert]'), null);
  a.input("#diagram-value", "220");
  a.open("column");
  assert.equal(a.get("#diagram-title").textContent, "柱の幅");
  assert.equal(a.model().clearance, "220");
  step(a, "diagram-value", 1);
  assert.equal(a.result().effective, 298);
  a.click("#zoom-in");
  assert.equal(a.get("#zoom-label").textContent, "125%");
  assert.equal(a.get("#diagram-editor").hidden, false);
  a.open("washer-left");
  assert.equal(modalCount, 0);
  a.click("#close-diagram");
  assert.equal(
    a.get("#diagram-workbench").classList.contains("editing"),
    false,
  );
});

test("編集欄を開いたまま詳細側を変更しても入力が同期し、方式変更では使えない欄を閉じる", (t) => {
  const a = setup(t);
  a.type();
  a.mode("direct");
  a.open("effective");
  a.input("#effective", "280.5");
  assert.equal(a.get("#diagram-value").value, "280.5");
  step(a, "diagram-value", 1);
  assert.equal(a.get("#effective").value, "281.5");
  a.input("#effective", "");
  assert.equal(a.get("#diagram-value").value, "");
  a.input("#diagram-value", "277");
  assert.equal(a.result().effective, 277);
  a.mode("joint");
  assert.equal(a.get("#diagram-editor").hidden, true);
  a.open("clearance");
  a.get("#diagram-value").dispatchEvent(
    new a.w.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(a.get("#diagram-editor").hidden, true);
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.ok(!css.includes("#diagram-editor::backdrop"));
  assert.ok(css.includes(".diagram-workbench.editing"));
});

test("形式5の自動保存を原文退避し、3 mm指定だけ10 mmへ引き上げて手動候補を保持", (t) => {
  const calc = require("../js/calculator.js"),
    data = require("../data/defaults.json");
  const legacy = Object.assign(calc.createModel(data), {
    specVersion: "2026-10-15-nut-engagement",
    boltType: "double",
    leftProjection: "3",
    rightProjection: "15",
    candidate: "300",
  });
  const workspace = {
    version: 1,
    current: { model: legacy, savedId: null },
    history: [],
  };
  const a = setup(t, workspace);
  assert.equal(a.model().leftProjection, "10");
  assert.equal(a.model().rightProjection, "15");
  assert.equal(a.model().candidate, "300");
  assert.equal(a.model().clearance, "200");
  assert.equal(a.result().status, "short");
  const key = Object.keys(a.w.localStorage).find((key) =>
    key.startsWith(workspaceKey + ".recovery."),
  );
  assert.equal(a.w.localStorage.getItem(key), JSON.stringify(workspace));
  assert.ok(a.get("#notice-message").textContent.includes("10 mm以上"));
});
