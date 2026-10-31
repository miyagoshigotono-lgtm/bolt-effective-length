const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

function keraba(t, { blocked = false } = {}) {
  const errors = [];
  const console = new VirtualConsole();
  console.on("jsdomError", (error) => errors.push(error.message));
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, "../apps/keraba/index.html"), "utf8"), {
    url: "https://example.test/tools/apps/keraba/",
    runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: console,
    beforeParse(w) {
      w.localStorage.setItem("bolt-proof", "keep");
      w.localStorage.setItem("kebiki-line.input.v1", "keep");
      if (blocked) Object.defineProperty(w, "localStorage", { get() { throw new Error("保存不可"); } });
    },
  });
  t.after(() => { assert.deepEqual(errors, []); dom.window.close(); });
  const w = dom.window, get = (id) => w.document.getElementById(id);
  return {
    w, get,
    doc: () => JSON.parse(w.eval("JSON.stringify(createProjectDocument())")),
    open(doc) { w.openProjectText(JSON.stringify(doc), "検証用.json"); },
    svg: () => [get("sheet").innerHTML, get("sheetOrd").innerHTML],
    change(id, value) {
      const el = get(id);
      if (el.type === "checkbox") el.checked = value; else el.value = value;
      el.dispatchEvent(new w.Event("input", { bubbles: true }));
    },
  };
}

test("通常・瓦を別PCへJSONで移し、入力と図・発注書の数値をそのまま復元する", (t) => {
  for (const mode of ["normal", "tile"]) {
    const source = keraba(t);
    if (mode === "tile") source.get("tabTile").click();
    source.change("name", "保存検証");
    source.change("pitch", "3.5");
    source.change("hTaruki", "75");
    source.change(mode === "tile" ? "tileHanaShimoHeight" : "normalHafuHeight", "182.5");
    source.change("dOverS", false);
    const doc = source.doc(), svg = source.svg();
    assert.equal(doc.roofMode, mode);
    assert.equal(doc.format, "keraba-project");
    assert.equal(doc.version, 1);
    assert.ok(!Object.hasOwn(doc, "result"));
    const target = keraba(t);
    target.get("ackWarning").checked = true;
    target.open(doc);
    assert.deepEqual(target.doc().inputs, doc.inputs);
    assert.deepEqual(target.svg(), svg);
    assert.equal(target.get(mode === "tile" ? "tabTile" : "tabNormal").getAttribute("aria-selected"), "true");
    assert.equal(target.get("ackWarning").checked, false);
    assert.equal(target.w.localStorage.getItem("bolt-proof"), "keep");
    assert.equal(target.w.localStorage.getItem("kebiki-line.input.v1"), "keep");
    assert.ok(!target.svg().join("").match(/NaN|Infinity/));
  }
});

test("途中入力の空欄と小数を勝手に埋めず、読み込み前の両モードへ戻せる", (t) => {
  const source = keraba(t);
  source.change("pitch", "");
  source.change("notchRef", "23.25");
  const doc = source.doc();
  assert.equal(doc.inputs.pitch, null);
  const target = keraba(t);
  target.change("pitch", "2.5");
  const originalNormal = target.doc().inputs;
  target.get("tabTile").click();
  target.change("pitch", "6.5");
  const originalTile = target.doc().inputs;
  target.open(doc);
  assert.equal(target.get("pitch").value, "");
  assert.equal(target.get("notchRef").value, "23.25");
  target.get("tabTile").click();
  assert.deepEqual(target.doc().inputs, originalTile);
  target.get("btnUndoOpen").click();
  assert.deepEqual(target.doc().inputs, originalTile);
  target.get("tabNormal").click();
  assert.deepEqual(target.doc().inputs, originalNormal);
  assert.equal(target.get("btnUndoOpen").hidden, true);
});

test("不正JSON・別アプリ・未知の形式・欠損・選択できない値は入力を変えず拒否する", (t) => {
  const a = keraba(t), doc = a.doc(), before = a.svg();
  const variants = [
    "{broken", "null", "[]",
    JSON.stringify({ ...doc, format: "bolt" }),
    JSON.stringify({ ...doc, version: 2 }),
    JSON.stringify({ ...doc, roofMode: "unknown" }),
    JSON.stringify({ ...doc, inputs: { ...doc.inputs, extra: 5 } }),
    JSON.stringify({ ...doc, inputs: { ...doc.inputs, pitch: "3" } }),
    JSON.stringify({ ...doc, inputs: { ...doc.inputs, fixHafu: "false" } }),
    JSON.stringify({ ...doc, inputs: { ...doc.inputs, hafu: "unknown" } }),
    JSON.stringify({ ...doc, inputs: { ...doc.inputs, total: 555 } }),
    JSON.stringify({ ...doc, inputs: { ...doc.inputs, name: "a\nb" } }),
    JSON.stringify({ ...doc, inputs: { ...doc.inputs, pitch: 1e100 } }),
    JSON.stringify(doc).replace('"pitch":1', '"pitch":1e400'),
    " ".repeat(1024 * 1024 + 1),
  ];
  const missing = structuredClone(doc);
  delete missing.inputs.pitch;
  variants.push(JSON.stringify(missing));
  const unsafe = JSON.stringify(doc).replace('"inputs":{', '"inputs":{"__proto__":{},');
  variants.push(unsafe);
  for (const text of variants) {
    assert.throws(() => a.w.openProjectText(text, "不正.json"));
    assert.deepEqual(a.doc().inputs, doc.inputs);
    assert.deepEqual(a.svg(), before);
    assert.equal(a.get("btnUndoOpen").hidden, true);
  }
  a.w.openProjectText("\uFEFF" + JSON.stringify(doc), "BOM.json");
  assert.deepEqual(a.doc().inputs, doc.inputs);
});

test("保存は表示中の入力をUTF-8のJSONにし、小数とファイル名を維持する", async (t) => {
  let blob, name;
  const a = keraba(t);
  a.w.URL.createObjectURL = (value) => { blob = value; return "blob:test"; };
  a.w.URL.revokeObjectURL = () => {};
  a.w.HTMLAnchorElement.prototype.click = function () { name = this.download; };
  a.change("name", '保存/検証:*?');
  a.change("pitch", "4.25");
  await a.w.saveProjectFile();
  const reader = new a.w.FileReader();
  const written = await new Promise((resolve) => { reader.onload = () => resolve(reader.result); reader.readAsText(blob); });
  const doc = JSON.parse(written);
  assert.equal(doc.inputs.pitch, 4.25);
  assert.equal(doc.inputs.name, '保存/検証:*?');
  assert.equal(name, "ケラバ_保存_検証____通常.json");
  assert.match(a.get("fileStatus").textContent, /書き出しました/);
});

test("書き出し失敗でも入力を残し、ブラウザ内保存が使えなくてもJSONを保存する", async (t) => {
  let blob;
  const a = keraba(t, { blocked: true });
  a.w.URL.createObjectURL = (value) => { blob = value; return "blob:test"; };
  a.w.URL.revokeObjectURL = () => {};
  a.w.HTMLAnchorElement.prototype.click = () => {};
  a.change("pitch", "5.5");
  await a.w.saveProjectFile();
  assert.ok(blob.size > 0);
  a.w.URL.createObjectURL = () => { throw new Error("書き出し失敗"); };
  await a.w.saveProjectFile();
  assert.equal(a.get("pitch").value, "5.5");
  assert.equal(a.get("fileStatus").classList.contains("is-error"), true);
});

test("ファイル選択から読み込め、同じファイルの再選択と壊れたJSONのエラー表示も使える", async (t) => {
  const a = keraba(t), doc = a.doc();
  doc.inputs.pitch = 8.5;
  const input = a.get("projectFile"), original = a.w.FileReader.prototype.readAsText;
  const choose = async (text) => {
    let done;
    const loaded = new Promise((resolve) => { done = resolve; });
    a.w.FileReader.prototype.readAsText = function (...args) {
      this.addEventListener("loadend", done);
      return original.apply(this, args);
    };
    Object.defineProperty(input, "files", { configurable: true, value: [new a.w.File([text], "検証用.json")] });
    input.dispatchEvent(new a.w.Event("change", { bubbles: true }));
    await loaded;
  };
  await choose(JSON.stringify(doc));
  assert.equal(a.get("pitch").value, "8.5");
  assert.equal(input.value, "");
  await choose("{broken");
  assert.equal(a.get("pitch").value, "8.5");
  assert.equal(a.get("fileStatus").classList.contains("is-error"), true);
});

test("通常のダウンロード保存と共有先リンクは入力を外部へ送信しない", async (t) => {
  const a = keraba(t);
  let blob, clicked;
  a.w.URL.createObjectURL = (value) => { blob = value; return "blob:test"; };
  a.w.URL.revokeObjectURL = () => {};
  a.w.HTMLAnchorElement.prototype.click = function () { clicked = { href: this.href, name: this.download }; };
  await a.w.saveProjectFile();
  assert.equal(blob.type, "application/json;charset=utf-8");
  assert.equal(clicked.href, "blob:test");
  assert.match(clicked.name, /^ケラバ_未命名_通常\.json$/);
  const reader = new a.w.FileReader();
  const text = await new Promise((resolve) => { reader.onload = () => resolve(reader.result); reader.readAsText(blob); });
  assert.deepEqual(JSON.parse(text).inputs, a.doc().inputs);
  assert.equal(a.w.document.querySelector(".file-buttons a").href, "https://github.com/miyagoshigotono-lgtm/keraba-project-data");
});
