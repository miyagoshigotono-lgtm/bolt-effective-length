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
  assert.ok(b.frame("bolt").src.endsWith("#drawing"));
});

function kebiki(t, saved = null, blocked = false) {
  const errors=[];
  const console=new VirtualConsole();
  console.on('jsdomError',error=>errors.push(error.message));
  const dom = new JSDOM(read("apps/kebiki/index.html"), {
    url: "https://example.test/tools/apps/kebiki/", runScripts: "dangerously", virtualConsole:console,
    beforeParse(w) {
      w.localStorage.setItem("bolt-proof", "keep");
      w.localStorage.setItem("keraba-proof", "keep");
      if (saved != null) w.localStorage.setItem("kebiki-line.input.v1", saved);
      w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
      w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
      if(blocked)Object.defineProperty(w,'localStorage',{get(){throw new Error('保存不可');}});
    },
  });
  t.after(() => {assert.deepEqual(errors,[]);dom.window.close();});
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

test("垂木の途中入力は補完せず復元し、壊れた保存は空欄から使える", (t) => {
  const a = kebiki(t);
  a.change("taruki", "");
  assert.equal(a.get("kane").textContent, "—");
  const b = kebiki(t, a.w.localStorage.getItem("kebiki-line.input.v1"));
  assert.equal(b.get("taruki").value, "");
  assert.equal(b.get("tatsu").textContent, "—");
  const c = kebiki(t, "{broken");
  assert.equal(c.get("kane").textContent, "—");
  for(const id of ['keta','kobai','noki','taruki'])assert.equal(c.get(id).value,'');
});

test('けびき線の欠き種類は通常を既定とし、古い途中入力と通常の計算を維持する',t=>{
  const values={keta:'90',kobai:'4',noki:'600',taruki:'90'};
  const a=kebiki(t,JSON.stringify(values));
  assert.equal(a.get('notchType').value,'center');assert.equal(a.get('techno-hint').hidden,true);
  assert.equal(a.get('notchType').getAttribute('aria-describedby'),'notchType-error');
  assert.equal(a.get('kane').textContent,'597.8');assert.equal(a.get('tatsu').textContent,'561.8');
  a.change('notchType','techno');
  assert.equal(a.get('kane').textContent,'601.5');assert.equal(a.get('tatsu').textContent,'565.5');
  assert.equal(a.get('techno-hint').hidden,false);assert.match(a.get('techno-hint').textContent,/鉛直に10 mm/);
  assert.match(a.get('notchType').getAttribute('aria-describedby'),/techno-hint/);
  for(const [id,value]of Object.entries(values))assert.equal(a.get(id).value,value);
  const saved=a.w.localStorage.getItem('kebiki-line.input.v1');
  assert.equal(JSON.parse(saved).notchType,'techno');
  const b=kebiki(t,saved);assert.equal(b.get('notchType').value,'techno');
  assert.equal(b.get('techno-hint').hidden,false);
  assert.equal(b.get('kane').textContent,'601.5');assert.equal(b.get('tatsu').textContent,'565.5');
  b.change('notchType','center');assert.equal(b.get('kane').textContent,'597.8');assert.equal(b.get('tatsu').textContent,'561.8');
});

test('テクノのけびき距離はケラバの桁上角から垂木先端までの投影と一致する',t=>{
  const a=kebiki(t),keraba=new JSDOM(read('apps/keraba/index.html'),{
    url:'https://example.test/keraba/',runScripts:'dangerously',pretendToBeVisual:true,
  });
  t.after(()=>keraba.window.close());
  const examples=[[105,4,600,60],[90,1.33,450,90],[110.5,3.75,600.5,75.5],[120,0,600,75],
    [105,5,0,60],[105,9,2000,100],[300,0.5,0,300],
    [105,4,52.4999,60],[105,4,52.5,60],[105,4,52.5001,60]];
  for(const [keta,kobai,noki,taruki]of examples){
    for(const [id,value]of Object.entries({keta,kobai,noki,taruki}))a.change(id,String(value));
    a.change('notchType','techno');
    const g=keraba.window.geometry(Object.assign(keraba.window.eval('getParams()'),{
      moyaSize:keta,pitch:kobai,hTaruki:taruki,notchType:'techno',
    }));
    // ケラバは水平屋根でも最小勾配を使うため、0寸だけは水平な幾何を直接確認する。
    let distance;
    if(kobai===0)distance=Math.abs(noki-keta/2);
    else{
      const xEnd=g.moya.xc-noki, yEnd=g.lnB(xEnd);
      distance=Math.abs((g.moya.xL-xEnd)*g.cos-(g.moya.yT-yEnd)*g.sin);
      assert.ok(Math.abs(g.lnB(g.moya.xL)-g.moya.yT-10)<1e-8);
    }
    assert.equal(a.get('kane').textContent,distance.toFixed(1));
    assert.equal(a.get('tatsu').textContent,(distance-taruki*kobai/10).toFixed(1));
    assert.match(a.get('result-condition').textContent,/テクノ.*桁角/);
  }
});

test('テクノも4項目がそろうまで結果を出さず、範囲外・大きすぎる値を補正しない',t=>{
  const a=kebiki(t,null,true);a.change('notchType','techno');
  for(const [id,value]of Object.entries({keta:'105',kobai:'4',noki:'600'}))a.change(id,value);
  assert.equal(a.get('kane').textContent,'—');a.change('taruki','60');
  assert.equal(a.get('kane').textContent,'593.4');assert.equal(a.get('tatsu').textContent,'569.4');
  a.change('noki','2000.1');assert.equal(a.get('kane').textContent,'—');assert.equal(a.get('noki-error').hidden,false);
  a.change('noki','600');a.change('kobai','1e308');
  assert.equal(a.get('kane').textContent,'—');assert.equal(a.get('tatsu').textContent,'—');
  assert.equal(a.get('kobai-error').hidden,false);assert.ok(!a.w.document.body.textContent.includes('Infinity'));
  for(const [id,value]of Object.entries({keta:'1',taruki:'1',kobai:'0',noki:'0'}))a.change(id,value);
  assert.equal(a.get('kane').textContent,'0.5');assert.equal(a.get('tatsu').textContent,'0.5');
  for(const [id,value]of Object.entries({keta:'300',taruki:'300',noki:'2000'}))a.change(id,value);
  assert.equal(a.get('kane').textContent,'1850.0');assert.equal(a.get('tatsu').textContent,'1850.0');
  a.get('btnReset').click();a.get('resetConfirm').click();
  assert.equal(a.get('notchType').value,'center');assert.equal(a.get('noki').value,'');
});

test('不正な欠き種類を保存から読んだ場合は数値を残して種類の選択を求める',t=>{
  for(const notchType of ['unknown',null,3]){
    const a=kebiki(t,JSON.stringify({keta:'105',kobai:'4',noki:'600',taruki:'60',notchType}));
    assert.equal(a.get('notchType').value,'');assert.equal(a.get('notchType-error').hidden,false);
    assert.equal(a.get('kane').textContent,'—');assert.equal(a.get('tatsu').textContent,'—');
    assert.equal(a.get('noki').value,'600');
    a.change('notchType','center');assert.notEqual(a.get('kane').textContent,'—');
    assert.equal(a.get('notchType-error').hidden,true);
  }
});

test('テクノの選択をリセットすると確認後に通常と空欄へ戻し、他画面の保存を維持する',t=>{
  const a=kebiki(t);a.change('notchType','techno');
  a.get('btnReset').click();assert.equal(a.get('resetDialog').open,true);a.get('resetCancel').click();
  assert.equal(a.get('notchType').value,'techno');
  a.get('btnReset').click();a.get('resetConfirm').click();
  assert.equal(a.get('notchType').value,'center');assert.equal(a.get('techno-hint').hidden,true);
  for(const id of ['keta','kobai','noki','taruki'])assert.equal(a.get(id).value,'');
  assert.equal(a.get('kane').textContent,'—');assert.equal(a.get('tatsu').textContent,'—');
  assert.equal(a.w.localStorage.getItem('bolt-proof'),'keep');assert.equal(a.w.localStorage.getItem('keraba-proof'),'keep');
  const b=kebiki(t,a.w.localStorage.getItem('kebiki-line.input.v1'));assert.equal(b.get('notchType').value,'center');
  a.get('btnReset').click();assert.equal(a.get('resetDialog').open,false);
});

test('けびき線は屋根寸法を上に置き、初回は4項目とも空欄で計算しない',t=>{
  const a=kebiki(t);
  assert.deepEqual([...a.w.document.querySelectorAll('legend')].map(el=>el.textContent),['屋根の寸法','部材寸法']);
  assert.deepEqual([...a.w.document.querySelectorAll('input[type="number"]')].map(el=>el.id),['kobai','noki','keta','taruki']);
  for(const id of ['keta','kobai','noki','taruki'])assert.equal(a.get(id).value,'');
  assert.equal(a.get('kane').textContent,'—');assert.equal(a.get('tatsu').textContent,'—');
});

test('桁90・105・120、垂木60・90、勾配1〜5の候補を選んでも自由入力へ続けて変更できる',t=>{
  const a=kebiki(t);
  const expected={keta:['90','105','120'],taruki:['60','90'],kobai:['1','1.5','2','2.5','3','3.5','4','4.5','5']};
  for(const [id,values]of Object.entries(expected)){
    const select=a.get(id+'-choice');
    assert.deepEqual([...select.options].filter(option=>option.value).map(option=>option.value),values);
    for(const value of values){
      select.value=value;select.dispatchEvent(new a.w.Event('change',{bubbles:true}));
      assert.equal(a.get(id).value,value);assert.equal(select.value,'');assert.equal(a.w.document.activeElement,a.get(id));
    }
  }
  for(const [id,value]of Object.entries({keta:'110.5',taruki:'75.5',kobai:'3.75',noki:'600.5'}))a.change(id,value);
  assert.notEqual(a.get('kane').textContent,'—');assert.equal(a.get('kobai').value,'3.75');
  a.get('kobai-choice').value='4';a.get('kobai-choice').dispatchEvent(new a.w.Event('change'));
  assert.equal(a.get('kobai').value,'4');
});

test('桁・垂木1〜300、軒0〜2000の境界を検証し、範囲外は補正せず計算結果を消す',t=>{
  const a=kebiki(t);
  const valid={keta:'105',taruki:'60',kobai:'3.5',noki:'455'};
  for(const [id,value]of Object.entries(valid))a.change(id,value);
  for(const [id,values]of Object.entries({keta:['1','300'],taruki:['1','300'],noki:['0','2000'],kobai:['0','0.5','9']})){
    for(const value of values){a.change(id,value);assert.notEqual(a.get('kane').textContent,'—');assert.equal(a.get(id).getAttribute('aria-invalid'),'false');}
    a.change(id,valid[id]);
  }
  for(const [id,values]of Object.entries({keta:['0','0.9','300.1'],taruki:['0','0.9','300.1'],noki:['-0.1','2000.1'],kobai:['-0.1']})){
    for(const value of values){
      a.change(id,value);assert.equal(a.get(id).value,value);assert.equal(a.get('kane').textContent,'—');assert.equal(a.get('tatsu').textContent,'—');
      assert.equal(a.get(id).getAttribute('aria-invalid'),'true');assert.equal(a.get(id+'-error').hidden,false);
    }
    a.change(id,valid[id]);assert.notEqual(a.get('kane').textContent,'—');
  }
  a.change('kobai','1e308');assert.equal(a.get('kane').textContent,'—');assert.ok(!a.w.document.body.textContent.includes('Infinity'));
});

test('リセットをキャンセルすれば入力を維持し、確定後は再読込しても空欄になる',t=>{
  const a=kebiki(t);for(const [id,value]of Object.entries({keta:'120',taruki:'90',kobai:'4.5',noki:'650'}))a.change(id,value);
  const before=a.w.localStorage.getItem('kebiki-line.input.v1'),result=a.get('kane').textContent;
  a.get('btnReset').click();assert.equal(a.get('resetDialog').open,true);a.get('resetCancel').click();
  assert.equal(a.w.localStorage.getItem('kebiki-line.input.v1'),before);assert.equal(a.get('kane').textContent,result);
  a.get('btnReset').click();a.get('resetConfirm').click();
  for(const id of ['keta','kobai','noki','taruki'])assert.equal(a.get(id).value,'');
  assert.equal(a.get('kane').textContent,'—');assert.equal(a.get('tatsu').textContent,'—');
  const b=kebiki(t,a.w.localStorage.getItem('kebiki-line.input.v1'));for(const id of ['keta','kobai','noki','taruki'])assert.equal(b.get(id).value,'');
  assert.equal(a.w.localStorage.getItem('bolt-proof'),'keep');assert.equal(a.w.localStorage.getItem('keraba-proof'),'keep');
  a.get('btnReset').click();assert.equal(a.get('resetDialog').open,false);
});

test('全項目がそろうまで結果を表示せず、保存領域が使えなくても計算とリセットは動く',t=>{
  const a=kebiki(t,null,true);
  for(const [id,value]of Object.entries({keta:'105',taruki:'60',kobai:'1'}))a.change(id,value);
  assert.equal(a.get('kane').textContent,'—');a.change('noki','455');assert.equal(a.get('kane').textContent,'404.5');
  a.get('btnReset').click();a.get('resetConfirm').click();assert.equal(a.get('keta').value,'');assert.equal(a.get('kane').textContent,'—');
});

test('指定範囲の端でカネが負になる場合も、元の計算式と小数1桁の表示を維持する',t=>{
  const a=kebiki(t);
  for(const [id,value]of Object.entries({keta:'1',taruki:'300',kobai:'5',noki:'0'}))a.change(id,value);
  assert.equal(a.get('kane').textContent,'0.6');assert.equal(a.get('tatsu').textContent,'-149.4');
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
