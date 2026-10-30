const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM, VirtualConsole } = require("jsdom");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function suite(t, { hash = "", stored = null, blocked = false } = {}) {
  const dom = new JSDOM(read("index.html"), {
    url: "https://example.test/tools/" + hash,
    runScripts: "outside-only",
  });
  t.after(() => dom.window.close());
  if (stored) dom.window.localStorage.setItem("wood-calculators.active.v1", stored);
  if (blocked) Object.defineProperty(dom.window, "localStorage", { get() { throw new Error("保存不可"); } });
  dom.window.eval(read("js/suite.js"));
  const tab = (id) => dom.window.document.getElementById("tab-" + id);
  const panel = (id) => dom.window.document.getElementById("panel-" + id);
  return { w: dom.window, tab, panel, frame: (id) => panel(id).querySelector("iframe") };
}

test("統合画面は選択した計算だけを開き、切替では画面や入力を読み直さない", (t) => {
  const a = suite(t);
  const keraba = a.frame("keraba");
  const src = keraba.src;
  assert.ok(src.includes("apps/keraba/index.html"));
  assert.equal(a.frame("bolt").hasAttribute("src"), false);
  a.tab("bolt").click();
  assert.equal(a.panel("keraba").hasAttribute("inert"), true);
  assert.equal(a.tab("bolt").getAttribute("aria-selected"), "true");
  assert.equal(a.panel("bolt").getAttribute("aria-hidden"), "false");
  const bolt = a.frame("bolt");
  a.tab("kebiki").click();
  assert.ok(a.frame("kebiki").src.includes("apps/kebiki/index.html"));
  a.tab("bolt").click();
  a.tab("keraba").click();
  assert.equal(a.frame("bolt"), bolt);
  assert.equal(a.frame("keraba"), keraba);
  assert.equal(keraba.src, src);
  assert.equal(a.w.location.hash, "#keraba");
  assert.equal(a.w.localStorage.getItem("wood-calculators.active.v1"), "keraba");
});

test("画面指定・前回の画面・キーボード・戻る操作が同じ選択を示す", (t) => {
  const a = suite(t, { hash: "#kebiki", stored: "keraba" });
  assert.equal(a.tab("kebiki").getAttribute("aria-selected"), "true");
  a.tab("kebiki").dispatchEvent(new a.w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(a.w.document.activeElement, a.tab("keraba"));
  assert.equal(a.tab("keraba").tabIndex, 0);
  assert.equal(a.tab("kebiki").tabIndex, -1);
  a.w.location.hash = "bolt";
  a.w.dispatchEvent(new a.w.HashChangeEvent("hashchange"));
  assert.equal(a.tab("bolt").getAttribute("aria-selected"), "true");
  const b = suite(t, { stored: "kebiki" });
  assert.equal(b.tab("kebiki").getAttribute("aria-selected"), "true");
});

test("不正な画面指定・保存不能でも外部URLを開かず、旧寸法リンクも使える", (t) => {
  const a = suite(t, { hash: "#https://unknown.test/", stored: "bad", blocked: true });
  assert.equal(a.tab("keraba").getAttribute("aria-selected"), "true");
  a.tab("kebiki").click();
  assert.equal(a.tab("kebiki").getAttribute("aria-selected"), "true");
  const b = suite(t, { hash: "#dimension-details", stored: "keraba" });
  assert.equal(b.tab("bolt").getAttribute("aria-selected"), "true");
  assert.ok(b.frame("bolt").src.endsWith("#dimension-details"));
});

function kebiki(t, saved = null) {
  const dom = new JSDOM(read("apps/kebiki/index.html"), {
    url: "https://example.test/tools/apps/kebiki/", runScripts: "dangerously",
    beforeParse(w) {
      w.localStorage.setItem("bolt-proof", "keep");
      w.localStorage.setItem("keraba-proof", "keep");
      if (saved != null) w.localStorage.setItem("kebiki-line.input.v1", saved);
    },
  });
  t.after(() => dom.window.close());
  const get = (id) => dom.window.document.getElementById(id);
  return { w: dom.window, get, change(id, value) { get(id).value = value; get(id).dispatchEvent(new dom.window.Event("input", { bubbles: true })); } };
}

test("垂木けびき線の原版と同じタツ・カネを表示し、保存復元しても数値が一致する", (t) => {
  const a = kebiki(t);
  for (const [keta, kobai, noki, taruki, tatsu, kane] of [
    ["105", "1", "455", "60", "404.5", "398.5"],
    ["90", "4", "600", "90", "597.8", "561.8"],
    ["105", "9", "1000", "100", "1274.7", "1184.7"],
  ]) {
    for (const [id, value] of Object.entries({ keta, kobai, noki, taruki })) a.change(id, value);
    assert.equal(a.get("kane").parentElement.querySelector(".title").textContent, "タツ");
    assert.equal(a.get("kane").textContent, tatsu);
    assert.equal(a.get("tatsu").textContent, kane);
  }
  const b = kebiki(t, a.w.localStorage.getItem("kebiki-line.input.v1"));
  assert.equal(b.get("noki").value, "1000");
  assert.equal(b.get("kane").textContent, "1274.7");
  assert.equal(b.w.localStorage.getItem("bolt-proof"), "keep");
  assert.equal(b.w.localStorage.getItem("keraba-proof"), "keep");
});

test("垂木の途中入力は補完せず復元し、壊れた保存でも原版の初期値から使える", (t) => {
  const a = kebiki(t);
  a.change("taruki", "");
  assert.equal(a.get("kane").textContent, "—");
  const b = kebiki(t, a.w.localStorage.getItem("kebiki-line.input.v1"));
  assert.equal(b.get("taruki").value, "");
  assert.equal(b.get("tatsu").textContent, "—");
  const c = kebiki(t, "{broken");
  assert.equal(c.get("kane").textContent, "404.5");
});

test("ケラバの通常・瓦の図と保存を引き継ぎ、子画面は更新処理を重複させない", (t) => {
  let requests = 0;
  const errors = [];
  const console = new VirtualConsole();
  console.on("jsdomError", (error) => errors.push(error.message));
  const dom = new JSDOM(read("apps/keraba/index.html"), {
    url: "https://example.test/tools/apps/keraba/", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: console,
    beforeParse(w) {
      w.fetch = () => { requests++; return Promise.reject(new Error("外部要求")); };
      Object.defineProperty(w.navigator, "serviceWorker", { value: { register() { requests++; }, addEventListener() {} } });
    },
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  assert.equal(w.document.querySelectorAll("svg").length, 2);
  assert.ok(!w.document.querySelector("svg").outerHTML.includes("NaN"));
  w.document.getElementById("tabTile").click();
  assert.equal(w.document.getElementById("tabTile").getAttribute("aria-selected"), "true");
  assert.equal(w.eval("geometry(getParams()).isTile"), true);
  w.document.getElementById("tabNormal").click();
  assert.equal(w.eval("geometry(getParams()).isTile"), false);
  assert.equal(requests, 0);
  assert.deepEqual(errors, []);
});

test("全アプリをオフライン保存し、統合版の更新で別アプリのキャッシュを消さない", async () => {
  const listeners = new Map();
  const scope = "https://example.test/tools/";
  const prefix = "wood-calculators:/tools/:";
  const stores = new Map([["keraba-v-existing", new Map()], [prefix + "old", new Map()]]);
  const key = (value) => typeof value === "string" ? value : value.url;
  let online = true;
  const cacheApi = {
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async addAll(requests) { for (const req of requests) store.set(req.url, new Response(req.url)); },
        async put(req, response) { store.set(key(req), response); },
        async match(req, options = {}) {
          const strip = (value) => options.ignoreSearch ? value.split("?")[0] : value;
          const found = [...store].find(([url]) => strip(url) === strip(key(req)));
          return found && found[1].clone();
        },
      };
    },
  };
  const context = vm.createContext({
    URL, Request, Response, caches: cacheApi,
    fetch: async () => { if (!online) throw new Error("オフライン"); return new Response("最新"); },
    self: { registration: { scope }, addEventListener: (name, listener) => listeners.set(name, listener), skipWaiting: async () => {}, clients: { claim: async () => {} } },
    importScripts(file) { vm.runInContext(read(file), context); },
  });
  vm.runInContext(read("sw.js"), context);
  for (const name of ["install", "activate"]) {
    let done;
    listeners.get(name)({ waitUntil(promise) { done = promise; } });
    await done;
  }
  assert.equal(stores.has("keraba-v-existing"), true);
  assert.equal(stores.has(prefix + "old"), false);
  const request = async (url, mode) => {
    let response;
    const waits = [];
    const req = mode ? { url, method: "GET", mode } : new Request(url);
    listeners.get("fetch")({ request: req, waitUntil(p) { waits.push(p); }, respondWith(p) { response = p; } });
    if (!response) return null;
    const result = await response;
    await Promise.all(waits);
    return result;
  };
  assert.equal(await (await request(scope + "bolt.html")).text(), "最新");
  online = false;
  for (const file of ["index.html", "bolt.html", "apps/keraba/index.html", "apps/kebiki/index.html", "js/app.js"]) {
    const response = await request(scope + file + "?v=test");
    assert.equal(response.status, 200, file);
  }
  assert.equal((await request(scope, "navigate")).status, 200);
  assert.equal((await request(scope + "missing.html")).status, 503);
  assert.equal(await request("https://example.test/kerabaCut/index.html"), null);
});
