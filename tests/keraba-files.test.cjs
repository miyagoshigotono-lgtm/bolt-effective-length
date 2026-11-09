const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

function cloud() {
  const files = new Map(), calls = [];
  let revision = 0;
  const key = (name, owner = 'a'.repeat(64)) => owner + ':' + name;
  const put = (name, doc, owner) => {
    const file = { sha: String(++revision), text: JSON.stringify(doc) };
    files.set(key(name, owner), file);
    return file;
  };
  return { files, calls, put, file: (name, owner) => files.get(key(name, owner)), async fetcher(url, options) {
    calls.push({ url, options });
    const body = JSON.parse(options.body), owner = options.headers['X-Keraba-Owner'];
    const path = key(body.name, owner), previous = files.get(path);
    if (body.action === 'list') return Response.json({ items: [...files].filter(([path]) => path.startsWith(owner + ':')).map(([path, file]) => ({ path: path.slice(65), name: path.slice(65), sha: file.sha })) });
    if (body.action === 'save') {
      if ((previous ? Number(previous.sha) : null) !== body.revision) return Response.json(
        body.revision===null && previous ? {existingRevision:previous.sha} : {}, {status:409});
      const file = { sha: String(++revision), text: JSON.stringify(body.document) };
      files.set(path, file);
      return Response.json({ path: body.name, sha: file.sha });
    }
    if (!previous) return new Response('', { status: 404 });
    return Response.json({ path: body.name, sha: previous.sha, text: previous.text });
  } };
}

async function settled(a) {
  for (let i = 0; i < 100; i++) {
    await new Promise(resolve => setImmediate(resolve));
    if (![...a.w.document.querySelectorAll('dialog')].some(el => el.getAttribute('aria-busy') === 'true')) return;
  }
  throw new Error('通信待ちが終わりません');
}
async function submit(a, id) {
  a.get(id).dispatchEvent(new a.w.Event('submit', { bubbles: true, cancelable: true }));
  await settled(a);
}
async function openCloud(a, name) {
  a.get('btnOpenProject').click();
  await settled(a);
  [...a.get('cloudProjectList').children].find(el => el.textContent === name).click();
  await settled(a);
}

function keraba(t, { blocked = false, fetcher, owner = 'a'.repeat(64), hash = '', saved = {} } = {}) {
  const errors = [];
  const console = new VirtualConsole();
  console.on("jsdomError", (error) => errors.push(error.message));
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, "../apps/keraba/index.html"), "utf8"), {
    url: "https://example.test/tools/apps/keraba/" + hash,
    runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: console,
    beforeParse(w) {
      w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
      if (fetcher) w.fetch = fetcher;
      if (owner) w.localStorage.setItem("keraba.cloud-owner.v1", owner);
      for(const [mode,inputs] of Object.entries(saved)) w.localStorage.setItem('keraba_last_'+mode+'_v1',JSON.stringify(inputs));
      w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open",""); };
      w.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
      w.localStorage.setItem("bolt-proof", "keep");
      w.localStorage.setItem("kebiki-line.input.v1", "keep");
      if (blocked) Object.defineProperty(w, "localStorage", { get() { throw new Error("保存不可"); } });
    },
  });
  for (const file of ["cloud-store.js", "cloud-ui.js"]) dom.window.eval(fs.readFileSync(path.join(__dirname, "../apps/keraba/", file), "utf8"));
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

test('上部・下部・上下カットの形と寸法線は実際の辺に一致する', t => {
  const a=keraba(t), near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
  for(const roofMode of ['normal','tile']) for(const mode of ['cut1','cutBottom','cut2']){
    const p=Object.assign(a.w.eval('getParams()'),{roofMode,pitch:4,tHana:30,hanaShimo:mode,hanaKami:mode,
      fixHanaShimo:true,fixHanaKami:true,hHanaShimoOrder:175,hHanaKamiOrder:175});
    const g=a.w.geometry(p);
    for(const b of [g.bS,g.bK]){
      const [tl,tr,br,bl]=b.poly;
      near(tr[1]-tl[1],mode==='cutBottom'?0:-12);
      near(br[1]-bl[1],mode==='cut1'?0:-12);
      near(bl[1]-tl[1],mode==='cutBottom'?175:163);
      near(br[1]-tr[1],mode==='cut1'?175:163);
      near(b.full[1][1]-b.full[0][1],175);
      near(b.short[1][1]-b.short[0][1],163);
      near(b.gap[1][1]-b.gap[0][1],12);
      assert.ok([[tl,bl],[tr,br]].some(pair=>JSON.stringify(pair)===JSON.stringify(b.short)));
      if(mode!=='cut2')assert.ok([[tl,bl],[tr,br]].some(pair=>JSON.stringify(pair)===JSON.stringify(b.full)));
      const cutYs=(mode==='cutBottom'?[bl,br]:[tl,tr]).map(pt=>pt[1]);
      near(b.gap[0][1],Math.min(...cutYs));near(b.gap[1][1],Math.max(...cutYs));
    }
    const svg=JSDOM.fragment(a.w.renderSVG(p));
    for(const side of ['水下','水上']){
      const labels=[...svg.querySelector(`g[aria-label="${side}鼻隠し寸法"]`).querySelectorAll('text')];
      assert.deepEqual(labels.map(el=>el.textContent),['163','175','12']);
      const xs=labels.slice(0,2).map(el=>Number(el.getAttribute('transform').match(/translate\(([-\d.]+)/)[1]));
      assert.ok(Math.abs(xs[0]-xs[1])>10,'長辺・短辺の寸法値の間隔を確保する');
    }
    const rows=a.w.orderRows(p,g);
    const cuts=mode==='cut2'?rows.p1:rows.p2;
    assert.equal(cuts.length,2);
    for(const row of cuts){assert.equal(row.B,175);assert.equal(row.C,12);assert.equal(row.D,163);assert.equal(row.B,row.C+row.D);}
  }
});

test('下部のみの自動成と逆算は上下カットの勾配落ちを加えず、瓦の内外寸も実際の天端に合う', t => {
  const a=keraba(t), near=(x,y)=>assert.ok(Math.abs(x-y)<1e-8,`${x} != ${y}`);
  for(const roofMode of ['normal','tile']) for(const pitch of [1.33,4,12]) for(const side of ['inner','outer']) for(const dir of ['vertical','perpendicular']){
    const p=Object.assign(a.w.eval('getParams()'),{roofMode,pitch,hanaShimo:'cutBottom',hanaKami:'cutBottom',fixHafu:true,
      fixHanaShimo:false,fixHanaKami:false,tileHanaSSide:side,tileHanaKSide:side,tileHanaSDir:dir,tileHanaKDir:dir});
    const g=a.w.geometry(p);
    for(const [b,offset]of [[g.bS,g.offsets.shimo],[g.bK,g.offsets.kami]]){
      for(const pt of [b.poly[2],b.poly[3]])near(pt[1],g.lnA(pt[0]));
      const x=side==='inner'?b.innerX:b.outerX;
      if(roofMode==='tile')near(b.poly[0][1],offset.guideLine(x));
    }
  }
  const p=Object.assign(a.w.eval('getParams()'),{hanaShimo:'cutBottom',hanaKami:'none',pitch:4,fixHafu:false,
    fixHanaShimo:true,hHanaShimoOrder:175});
  const g=a.w.geometry(p);
  near(g.wHafu,175/Math.sqrt(1+0.4**2));near(g.faceAutoS,175);
});

test('下部のみを通常・瓦で保存復元でき、発注書も一方加工の図と寸法になる', async t => {
  const remote=cloud();
  for(const mode of ['normal','tile']){
    const a=keraba(t,{fetcher:remote.fetcher});
    if(mode==='tile')a.get('tabTile').click();
    for(const key of ['hanaShimo','hanaKami'])a.change(key,'cutBottom');
    assert.match(a.get('sheetOrd').textContent,/②　下部のみ勾配加工/);
    const doc=a.doc(),svg=a.svg();
    const restored=keraba(t,{saved:{[mode]:doc.inputs}});
    if(mode==='tile')restored.get('tabTile').click();
    assert.deepEqual(restored.svg(),svg);
    const imported=keraba(t);imported.open(doc);assert.deepEqual(imported.svg(),svg);
    a.get('btnSaveProject').click();a.get('projectSaveName').value='下部加工確認_'+mode;await submit(a,'projectSaveForm');
    const loaded=keraba(t,{fetcher:remote.fetcher});await openCloud(loaded,'下部加工確認_'+mode);
    assert.deepEqual(loaded.svg(),svg);
    a.change('hanaKami','cut1');
    const order=a.get('sheetOrd').textContent;
    assert.match(order,/上部のみ/);assert.match(order,/下部のみ/);
  }
});

test('合板の出は鼻隠しの天端位置によらず垂木先端から測り、0なら先端で止まる',t=>{
  const a=keraba(t),near=(x,y)=>assert.ok(Math.abs(x-y)<1e-8,`${x} != ${y}`);
  for(const roofMode of ['normal','tile']) for(const mode of ['kane','tatsu','cut1','cutBottom','cut2','none'])
  for(const pitch of [1.33,4]) for(const dir of ['vertical','perpendicular']) for(const out of [-25,0,67]){
    const p=Object.assign(a.w.eval('getParams()'),{roofMode,pitch,hanaShimo:mode,hanaKami:mode,
      tileHanaSRef:'noji',tileHanaKRef:'taruki',tileHanaSDir:dir,tileHanaKDir:dir,
      tileHanaSOffset:40,tileHanaKOffset:24,ovShimo:out,ovKami:out});
    const g=a.w.geometry(p);
    for(const [b,end]of [[g.bS,g.rafterS],[g.bK,g.rafterK]]){
      near(end.top[1],g.lnD(end.top[0]));near(end.bottom[1],g.lnB(end.bottom[0]));
      if(b.poly){
        const [top,bottom]=b.mode!=='kane' && b.innerX===b.poly[0][0]
          ? [b.poly[0],b.poly[3]] : [b.poly[1],b.poly[2]];
        const [x,y]=top, [xb,yb]=bottom;
        for(const pt of [end.top,end.bottom])near((pt[0]-x)*(yb-y)-(pt[1]-y)*(xb-x),0);
      }else near(end.top[0],b.outerX);
    }
    near((g.rafterS.top[0]-g.endLD[0])/g.cos,out);
    near((g.endRD[0]-g.rafterK.top[0])/g.cos,out);
    near(Math.hypot(g.endLC[0]-g.endLD[0],g.endLC[1]-g.endLD[1]),g.tNoji);
    near(Math.hypot(g.endRC[0]-g.endRD[0],g.endRC[1]-g.endRD[1]),g.tNoji);
    if(roofMode==='tile' && mode==='kane')assert.ok(g.rafterS.top[0]>g.bS.innerX+1);
  }
  const p=Object.assign(a.w.eval('getParams()'),{roofMode:'tile',hanaShimo:'kane',ovShimo:67});
  assert.ok(!/NaN|Infinity/.test(a.w.renderSVG(p)));
});

test('水下カネと水上下部カットは同じ勾配直角オフセットで天端の勾配線へ揃う',t=>{
  const a=keraba(t),near=(x,y)=>assert.ok(Math.abs(x-y)<1e-8,`${x} != ${y}`);
  a.get('tabTile').click();
  for(const [key,value]of Object.entries({pitch:'1.5',tNoji:'9',hTaruki:'45',hanaShimo:'kane',hanaKami:'cutBottom',
    tileHafuOffset:'18',tileHanaShimoWidth:'27',
    tileHanaSRef:'noji',tileHanaSDir:'perpendicular',tileHanaSOffset:'35',
    tileHanaKRef:'noji',tileHanaKDir:'perpendicular',tileHanaKSide:'inner',tileHanaKOffset:'35',
    tileHanaShimoHeight:'175'}))a.change(key,value);
  const p=a.w.eval('getParams()'),g=a.w.geometry(p);
  near(g.bS.face,175);
  near((g.lnC(0)-g.offsets.shimo.guideLine(0))*g.cos,35);
  near(g.bK.poly[0][1],g.offsets.shimo.guideLine(g.bK.innerX));
  near(g.bK.poly[0][1],g.bK.poly[1][1]);
  near(g.bK.face,175*Math.sqrt(1+0.15**2));
  near(g.bK.faceShort,g.bK.face-4.05);
  near(g.bK.gap[1][1]-g.bK.gap[0][1],4.05);
  near(g.wHafu,158);
  assert.equal(a.get('drawingRequiredHint').hidden,true);
});

test('通常・瓦の勾配を丸めず表題へ表示し、勾配マークは横10に対する入力値を示す', t => {
  for (const mode of ['normal', 'tile']) {
    const a = keraba(t);
    if (mode === 'tile') a.get('tabTile').click();
    for (const pitch of ['0.1', '0.15', '1', '1.01', '1.3', '1.33', '1.333', '4.25', '11.99', '12']) {
      a.change('pitch', pitch);
      const value = Number(pitch), label = Number.isInteger(value) ? value.toFixed(1) : pitch;
      assert.equal(a.get('pitch').validity.stepMismatch, false);
      assert.equal(a.doc().inputs.pitch, value);
      const texts = [...a.get('sheet').querySelectorAll('text')].map(el => el.textContent);
      assert.ok(texts.some(text => text.endsWith(`屋根勾配：${label}寸`)), `${mode}: ${pitch}`);
      const mark = a.get('sheet').querySelector('g[aria-label^="屋根勾配 "]');
      assert.deepEqual([...mark.querySelectorAll('text')].map(el => el.textContent), ['10', label]);
      // 三角形の傾きと表示する寸勾配の比率が一致することも確認する。
      const [base, rise] = mark.querySelectorAll('line');
      const run = Number(base.getAttribute('x2')) - Number(base.getAttribute('x1'));
      const height = Number(rise.getAttribute('y2')) - Number(rise.getAttribute('y1'));
      assert.ok(Math.abs(height / run - value / 10) < 0.0002);
      assert.equal(a.w.eval('geometry(getParams()).tan'), value / 10);
    }
    a.change('pitch', '1.33');
    a.change('dSlope', false);
    assert.equal(a.get('sheet').querySelector('g[aria-label^="屋根勾配 "]'), null);
    assert.ok(a.get('sheet').textContent.includes('屋根勾配：1.33寸'));
  }
});

test('1.33寸は再起動とJSON読み込み後も入力・表題・勾配マークに同じ精度を保つ', t => {
  for (const mode of ['normal', 'tile']) {
    const a = keraba(t);
    if (mode === 'tile') a.get('tabTile').click();
    a.change('pitch', '1.33');
    const doc = a.doc(), svg = a.svg();
    const restored = keraba(t, {saved: {[mode]: doc.inputs}});
    if (mode === 'tile') restored.get('tabTile').click();
    assert.equal(restored.get('pitch').value, '1.33');
    assert.deepEqual(restored.svg(), svg);
    const imported = keraba(t);
    imported.open(doc);
    assert.equal(imported.get('pitch').value, '1.33');
    assert.deepEqual(imported.svg(), svg);
  }
});

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

test('通常・瓦をクラウドへ保存し、別PCが未接続のまま入力・図・発注書を復元する', async t => {
  const remote = cloud();
  for (const mode of ['normal', 'tile']) {
    const a = keraba(t, { fetcher: remote.fetcher });
    if (mode === 'tile') a.get('tabTile').click();
    a.change('pitch', '4.25');
    a.change('name', '保存検証');
    a.change('notchRef', '');
    const doc = a.doc(), svg = a.svg();
    a.get('btnSaveProject').click();
    assert.equal(a.get('projectSaveDialog').open, true);
    a.get('projectSaveName').value = '共有検証_' + mode;
    await submit(a, 'projectSaveForm');
    assert.equal(a.get('projectSaveDialog').open, false);
    assert.match(a.get('fileStatus').textContent, /保存しました/);
    const b = keraba(t, { fetcher: remote.fetcher });
    await openCloud(b, '共有検証_' + mode);
    assert.deepEqual(b.doc().inputs, doc.inputs);
    assert.deepEqual(b.svg(), svg);
    assert.equal(b.get('btnGitHubConnect'), null);
    assert.match(b.get('fileStatus').textContent, /開き/);
    assert.equal(b.w.localStorage.getItem('bolt-proof'), 'keep');
    assert.equal(b.w.localStorage.getItem('kebiki-line.input.v1'), 'keep');
  }
  const writes = remote.calls.filter(call => JSON.parse(call.options.body).action === 'save');
  assert.equal(writes.length, 2);
  for (const call of writes) {
    assert.ok(!call.options.body.includes('test-key'));
    assert.equal(call.options.headers.Authorization, undefined);
  }
});

test('保存名確認・禁止名・キャンセルを維持し、ファイルをダウンロードしない', async t => {
  const remote = cloud(), a = keraba(t, { fetcher: remote.fetcher });
  a.w.URL.createObjectURL = () => { throw new Error('ローカル保存は禁止'); };
  a.change('name', '保存検証');
  const before = a.doc().inputs;
  a.get('btnSaveProject').click();
  assert.equal(a.get('projectSaveName').value, 'ケラバ_保存検証_通常');
  for (const invalid of [' ', 'a/b', 'CON', 'name.']) {
    a.get('projectSaveName').value = invalid;
    await submit(a, 'projectSaveForm');
    assert.equal(remote.calls.length, 0);
  }
  a.get('projectSaveCancel').click();
  assert.deepEqual(a.doc().inputs, before);
  a.get('btnSaveProject').click();
  a.get('projectSaveName').value = '  確認した名前.json  ';
  await submit(a, 'projectSaveForm');
  assert.ok(Boolean(remote.file('確認した名前')));
  assert.deepEqual(a.doc().inputs, before);
  a.get('btnSaveProject').click();
  assert.equal(a.get('projectSaveName').value, '確認した名前');
});

test('接続画面なしで保存でき、開く一覧は自分が保存したデータだけになる', async t => {
  const remote = cloud(), a = keraba(t, { fetcher: remote.fetcher });
  assert.equal(a.get('cloudConnectDialog'), null);
  assert.equal(a.get('cloudToken'), null);
  a.get('btnSaveProject').click();
  assert.equal(a.get('projectSaveDialog').open, true);
  a.get('projectSaveName').value = '本人のデータ';
  await submit(a, 'projectSaveForm');
  const other = keraba(t, { fetcher: remote.fetcher, owner: 'b'.repeat(64) });
  other.get('btnOpenProject').click(); await settled(other);
  assert.equal(other.get('cloudProjectList').children.length, 0);
  a.get('btnOpenProject').click(); await settled(a);
  assert.equal(a.get('cloudProjectList').firstChild.textContent, '本人のデータ');
});

test('同じ名前の未読データは確認なしで置き換えず、確認後も古いSHAで競合を検知する', async t => {
  const remote = cloud(), a = keraba(t, { fetcher: remote.fetcher });
  const doc = a.doc();
  doc.inputs.pitch = 8.5;
  remote.put('既存データ', doc);
  a.get('btnSaveProject').click();
  a.get('projectSaveName').value = '既存データ';
  await submit(a, 'projectSaveForm');
  assert.equal(a.get('projectSaveOverwrite').hidden, false);
  assert.equal(remote.calls.filter(call => JSON.parse(call.options.body).action === 'save').length, 1);
  assert.equal(JSON.parse(remote.file('既存データ').text).inputs.pitch,8.5);
  const newer = { ...doc, inputs: { ...doc.inputs, pitch: 6.5 } };
  remote.put('既存データ', newer);
  a.get('projectSaveOverwriteCheck').checked = true;
  await submit(a, 'projectSaveForm');
  assert.match(a.get('projectSaveError').textContent, /別の画面/);
  assert.equal(JSON.parse(remote.file('既存データ').text).inputs.pitch, 6.5);
  assert.equal(a.get('projectSaveDialog').open, true);
});

test('開いた物件の更新と別PCの競合を区別し、取り込み取消しで元の保存先も戻す', async t => {
  const remote = cloud(), a = keraba(t, { fetcher: remote.fetcher });
  remote.put('元のデータ', a.doc());
  remote.put('別のデータ', a.doc());
  await openCloud(a, '元のデータ');
  a.change('pitch', '3.5');
  a.get('btnSaveProject').click();
  await submit(a, 'projectSaveForm');
  assert.equal(JSON.parse(remote.file('元のデータ').text).inputs.pitch, 3.5);
  await openCloud(a, '別のデータ');
  a.get('btnUndoOpen').click();
  assert.equal(a.get('pitch').value, '3.5');
  a.get('btnSaveProject').click();
  assert.equal(a.get('projectSaveName').value, '元のデータ');
  remote.put('元のデータ', a.doc());
  await submit(a, 'projectSaveForm');
  assert.match(a.get('projectSaveError').textContent, /別の画面/);
});

test('不正なクラウドデータは入力・図・元の保存先を変えず拒否し、保存名はHTMLとして描かない', async t => {
  const remote = cloud(), a = keraba(t, { fetcher: remote.fetcher });
  remote.put('<b>不正データ</b>', { format: 'other' });
  // スラッシュを含まない名前でHTML挿入への耐性を確認する。
  remote.files.set('a'.repeat(64) + ':<img onerror=bad>', { sha: 'bad', text: '{broken' });
  const before = a.doc().inputs, svg = a.svg();
  a.get('btnOpenProject').click(); await settled(a);
  assert.equal(a.get('cloudProjectList').querySelector('img'), null);
  a.get('cloudSearch').value = 'img';
  a.get('cloudSearch').dispatchEvent(new a.w.Event('input'));
  assert.equal(a.get('cloudProjectList').children.length, 1);
  a.get('cloudProjectList').firstChild.click(); await settled(a);
  assert.match(a.get('cloudOpenStatus').textContent, /保存名を入力/);
  assert.deepEqual(a.doc().inputs, before);
  assert.deepEqual(a.svg(), svg);
  remote.files.set('a'.repeat(64) + ':壊れた保存', { sha: '3', text: '{broken' });
  a.get('cloudSearch').value = '';
  a.get('cloudRefresh').click(); await settled(a);
  [...a.get('cloudProjectList').children].find(el => el.textContent === '壊れた保存').click(); await settled(a);
  assert.match(a.get('cloudOpenStatus').textContent, /JSONを読み取れません/);
  assert.deepEqual(a.doc().inputs, before);
});

test('ブラウザに保存先を記憶できない場合は送信せず、入力と保存名を残す',async t=>{
  const remote=cloud(),a=keraba(t,{fetcher:remote.fetcher,blocked:true});
  a.change('pitch','5.5');a.get('btnSaveProject').click();a.get('projectSaveName').value='保存検証';
  await submit(a,'projectSaveForm');
  assert.equal(remote.calls.length,0);assert.equal(a.get('pitch').value,'5.5');
  assert.equal(a.get('projectSaveName').value,'保存検証');assert.match(a.get('projectSaveError').textContent,/保存先を記憶できません/);
});

test('起動と通常の入力では外部送信せず、保存操作のときだけ通信する', t => {
  const remote = cloud(), a = keraba(t, { fetcher: remote.fetcher });
  a.change('pitch', '3.5');
  a.get('tabTile').click();
  a.change('pitch', '7.5');
  assert.equal(remote.calls.length, 0);
});

test('取得待ちの入力変更を読み出しで上書きせず、再選択で読み込める', async t => {
  const remote = cloud();
  let release, pause = true;
  const a = keraba(t, { fetcher: async (url, options) => {
    if (JSON.parse(options.body).action === 'load' && pause) await new Promise(resolve => { release = resolve; });
    return remote.fetcher(url, options);
  } });
  const doc = a.doc(); doc.inputs.pitch = 7.5;
  remote.put('待機中の検証', doc);
  a.get('btnOpenProject').click(); await settled(a);
  a.get('cloudProjectList').firstChild.click();
  a.change('pitch', '3.5');
  release(); await settled(a);
  assert.equal(a.get('pitch').value, '3.5');
  assert.match(a.get('cloudOpenStatus').textContent, /入力が変わりました/);
  pause = false;
  a.get('cloudProjectList').firstChild.click(); await settled(a);
  assert.equal(a.get('pitch').value, '7.5');
});

test('同名への明示的な上書き確認で更新し、保存通信中の追加入力は保存済みと扱わない', async t => {
  const remote = cloud();
  let release;
  const a = keraba(t, { fetcher: async (url, options) => {
    if (JSON.parse(options.body).action === 'save' && JSON.parse(options.body).revision!==null) await new Promise(resolve => { release = resolve; });
    return remote.fetcher(url, options);
  } });
  remote.put('上書き検証', a.doc());
  a.change('pitch', '4.25');
  a.get('btnSaveProject').click(); a.get('projectSaveName').value = '上書き検証';
  await submit(a, 'projectSaveForm');
  a.get('projectSaveOverwriteCheck').checked = true;
  a.get('projectSaveForm').dispatchEvent(new a.w.Event('submit', { bubbles: true, cancelable: true }));
  a.change('pitch', '5.5');
  release(); await settled(a);
  assert.equal(JSON.parse(remote.file('上書き検証').text).inputs.pitch, 4.25);
  assert.equal(a.get('pitch').value, '5.5');
  assert.match(a.get('fileStatus').textContent, /もう一度保存/);
});

test('保存・開く・リセットを並べ、未保存のリセットは確認し、キャンセルで入力と図を維持する', t => {
  const a=keraba(t);
  assert.deepEqual([...a.w.document.querySelectorAll('.file-buttons button')].map(el=>el.textContent),['保存','開く','リセット']);
  assert.equal(a.w.document.querySelectorAll('#btnReset').length,1);
  a.change('pitch','5.5'); const before=a.doc().inputs, svg=a.svg();
  a.get('btnReset').click(); assert.equal(a.get('projectResetDialog').open,true);
  a.get('projectResetCancel').click();
  assert.deepEqual(a.doc().inputs,before);assert.deepEqual(a.svg(),svg);
  a.get('btnReset').click();a.get('projectResetConfirm').click();
  assert.equal(a.get('pitch').value,''); assert.match(a.get('fileStatus').textContent,/保存済みデータは残って/);
  a.get('btnReset').click();assert.equal(a.get('projectResetDialog').open,false);
});

test('保存済みのリセットは再確認せず、通常・瓦とクラウドの保存内容を削除しない',async t=>{
  const remote=cloud(),a=keraba(t,{fetcher:remote.fetcher});
  a.change('pitch','3.5');a.get('btnSaveProject').click();a.get('projectSaveName').value='リセット検証';
  await submit(a,'projectSaveForm');const cloudText=remote.file('リセット検証').text;
  const writes=remote.calls.length;
  a.get('btnReset').click();assert.equal(a.get('projectResetDialog').open,false);assert.equal(a.get('pitch').value,'');
  assert.equal(remote.file('リセット検証').text,cloudText);assert.equal(remote.calls.length,writes);
  a.get('tabTile').click();a.change('pitch','7.5');a.get('btnReset').click();
  assert.equal(a.get('projectResetDialog').open,true);assert.equal(a.get('pitch').value,'7.5');a.get('projectResetCancel').click();
  a.get('tabNormal').click();assert.equal(a.get('pitch').value,'');
});

test('再起動後も未保存変更を判別し、読み込み取消しでは元の確認状態へ戻す',async t=>{
  const remote=cloud(),a=keraba(t,{fetcher:remote.fetcher});
  a.change('pitch','3.5');a.get('btnSaveProject').click();a.get('projectSaveName').value='保存済み';await submit(a,'projectSaveForm');
  a.change('pitch','4.5');
  const b=keraba(t,{fetcher:remote.fetcher});
  for(const key of Object.keys(a.w.localStorage))b.w.localStorage.setItem(key,a.w.localStorage.getItem(key));
  b.w.eval(fs.readFileSync(path.join(__dirname,'../apps/keraba/cloud-ui.js'),'utf8'));
  b.change('pitch','4.5');b.get('btnReset').click();assert.equal(b.get('projectResetDialog').open,true);b.get('projectResetCancel').click();
  remote.put('読み込むデータ',a.doc());await openCloud(b,'読み込むデータ');b.get('btnUndoOpen').click();b.get('btnReset').click();assert.equal(b.get('projectResetDialog').open,true);
});

test('通常・瓦のリセットで寸法・物件情報・条件を空欄にし、図を計算済みとして表示しない',t=>{
  for(const mode of ['normal','tile']){
    const a=keraba(t);
    if(mode==='tile')a.get('tabTile').click();
    a.change('name','入力確認');a.get('btnReset').click();a.get('projectResetConfirm').click();
    for(const el of a.get('form').querySelectorAll('input[type="number"],input[type="text"],select')) assert.equal(el.value,'',el.id);
    for(const key of ['fixHafu','fixHanaShimo','fixHanaKami'])assert.equal(a.get(key).checked,false);
    assert.equal(a.get('total').value,'500');assert.equal(a.get('dHana').checked,true);
    assert.match(a.get('sheet').textContent,/必要な寸法を入力/);assert.match(a.get('sheetOrd').textContent,/必要な寸法を入力/);
    assert.equal(a.get('btnPrintDwg').disabled,true);assert.equal(a.get('btnPrintOrd').disabled,true);
    assert.ok(!a.svg().join('').match(/NaN|Infinity/));
    a.change('pitch','4.25');assert.equal(a.get('moyaSize').value,'');assert.equal(a.get('normalHafuHeight').value,'');
    assert.match(a.get('sheet').textContent,/必要な寸法を入力/);
  }
});

test('空欄のまま再起動・クラウド保存・読み出しができ、以前の初期値を補完しない',async t=>{
  const remote=cloud(),a=keraba(t,{fetcher:remote.fetcher});
  a.get('btnReset').click();a.get('projectResetConfirm').click();
  const empty=a.doc().inputs;
  const restarted=keraba(t,{saved:{normal:empty}});
  assert.deepEqual(restarted.doc().inputs,empty);assert.match(restarted.get('sheet').textContent,/必要な寸法を入力/);
  a.get('btnSaveProject').click();a.get('projectSaveName').value='未入力の保存';await submit(a,'projectSaveForm');
  const b=keraba(t,{fetcher:remote.fetcher});await openCloud(b,'未入力の保存');
  assert.deepEqual(b.doc().inputs,empty);assert.match(b.get('sheet').textContent,/必要な寸法を入力/);
});

test('空欄から必要な寸法を入力すると図を再開し、入力値を既定寸法で置き換えない',t=>{
  const a=keraba(t);a.get('btnReset').click();a.get('projectResetConfirm').click();
  const values={pitch:'3.5',tNoji:'12',hTaruki:'75',moyaSize:'120',notchRef:'25',ovShimo:'80',ovKami:'60',
    normalHafuWidth:'35',normalHafuHeight:'180',clearance:'0',hafu:'on',hanaShimo:'none',hanaKami:'none'};
  for(const [key,value]of Object.entries(values))a.change(key,value);
  assert.ok(!a.get('sheet').textContent.includes('必要な寸法を入力'));
  assert.equal(a.get('moyaSize').value,'120');assert.equal(a.get('normalHafuHeight').value,'180');
  assert.equal(a.get('btnPrintDwg').disabled,false);
});

test('リセット後は作図に足りない必須欄だけを示し、0の入力でも条件がそろえば色と案内を消す',t=>{
  for(const mode of ['normal','tile']){
    const a=keraba(t), missing=id=>a.get(id).classList.contains('required-missing');
    if(mode==='tile')a.get('tabTile').click();
    a.get('btnReset').click();a.get('projectResetConfirm').click();
    for(const id of ['pitch','tNoji','hTaruki','moyaSize','notchRef','ovShimo','ovKami','hafu','hanaShimo','hanaKami'])assert.equal(missing(id),true,id);
    for(const id of ['name','material','client','total','zoom'])assert.equal(missing(id),false,id);
    assert.equal(a.get('drawingRequiredHint').hidden,false);
    assert.match(a.get('drawingRequiredHint').textContent,/どれか1つ/);
    for(const id of ['hafu','hanaShimo','hanaKami'])a.change(id,'none');
    for(const id of ['clearance','normalHafuWidth','normalHafuHeight','tileHanaSOffset','tileHanaKOffset','tileHafuOffset'])assert.equal(missing(id),false,id);
    for(const [id,value]of Object.entries({pitch:'1.33',tNoji:'12',hTaruki:'60',moyaSize:'105',notchRef:'0',ovShimo:'0',ovKami:'0'}))a.change(id,value);
    assert.equal(a.get('form').querySelectorAll('.required-missing,.required-reference').length,0);
    assert.equal(a.get('drawingRequiredHint').hidden,true);
    assert.ok(!a.get('sheet').textContent.includes('必要な寸法を入力'));
  }
});

test('不足する共通板厚と固定成は見える入力欄を色付けし、使わない部材は対象から外す',t=>{
  const a=keraba(t), missing=id=>a.get(id).classList.contains('required-missing');
  a.change('hafu','none');a.change('hanaShimo','none');a.change('hanaKami','cutBottom');
  a.change('normalHanaKamiWidth','');
  assert.equal(missing('normalHanaKamiWidth'),true);
  assert.equal(missing('normalHanaShimoWidth'),false);
  assert.equal(missing('tileHanaKamiWidth'),false);
  assert.equal(missing('tHana'),false);
  assert.equal(a.get('normalHanaKamiWidth').getAttribute('aria-describedby'),'drawingRequiredHint');
  a.change('normalHanaKamiWidth','30');a.change('normalHanaKamiHeight','175');
  assert.equal(a.get('drawingRequiredHint').hidden,true);
  assert.ok(!a.get('sheet').textContent.includes('必要な寸法を入力'));
  a.change('normalHanaKamiHeight','');
  assert.equal(missing('normalHanaKamiHeight'),true);
  assert.match(a.get('sheet').textContent,/必要な寸法を入力/);
  a.change('normalHanaKamiHeight','175');assert.equal(missing('normalHanaKamiHeight'),false);
});

test('成の基準が未固定なら固定チェックを案内し、1つ固定すると候補の色をすべて消す',t=>{
  const a=keraba(t);
  const fixed=a.get('form').querySelector('[data-fixed-for="fixHafu"]');
  fixed.checked=false;fixed.dispatchEvent(new a.w.Event('input',{bubbles:true}));
  assert.equal(fixed.closest('.fixcheck').classList.contains('required-reference'),true);
  assert.equal(a.get('normalHafuHeight').classList.contains('required-missing'),false);
  assert.match(a.get('drawingRequiredHint').textContent,/固定/);
  assert.match(a.get('sheet').textContent,/必要な寸法を入力/);
  fixed.checked=true;fixed.dispatchEvent(new a.w.Event('input',{bubbles:true}));
  assert.equal(a.get('form').querySelectorAll('.required-missing,.required-reference').length,0);
  assert.equal(a.get('drawingRequiredHint').hidden,true);
  assert.equal(a.get('btnPrintDwg').disabled,false);
});

test('瓦の不足する基準・オフセットを案内し、通常への切替と保存復元でも色付けを更新する',t=>{
  const a=keraba(t);a.get('tabTile').click();
  a.change('tileHanaSOffset','');
  assert.equal(a.get('tileHanaSOffset').classList.contains('required-missing'),true);
  const saved=a.doc();
  const restored=keraba(t);restored.open(saved);
  assert.equal(restored.get('tileHanaSOffset').classList.contains('required-missing'),true);
  restored.change('tileHanaSOffset','0');assert.equal(restored.get('drawingRequiredHint').hidden,true);
  a.change('tileHanaKRef','');assert.equal(a.get('tileHanaKRef').classList.contains('required-missing'),true);
  a.change('hanaKami','none');assert.equal(a.get('tileHanaKRef').classList.contains('required-missing'),false);
  a.get('tabNormal').click();assert.equal(a.get('form').querySelectorAll('.required-missing').length,0);
  a.get('tabTile').click();assert.equal(a.get('tileHanaSOffset').classList.contains('required-missing'),true);
  a.change('tileHanaSOffset','0');assert.equal(a.get('drawingRequiredHint').hidden,true);
});

test('新しい名前への保存は事前読込をせず1回の通信で完了し、同名の確認も追加読込をしない',async t=>{
  const remote=cloud(),a=keraba(t,{fetcher:remote.fetcher});
  a.get('btnSaveProject').click();a.get('projectSaveName').value='通信回数確認';await submit(a,'projectSaveForm');
  assert.deepEqual(remote.calls.map(call=>JSON.parse(call.options.body).action),['save']);
  const b=keraba(t,{fetcher:remote.fetcher});b.get('btnSaveProject').click();b.get('projectSaveName').value='通信回数確認';
  await submit(b,'projectSaveForm');assert.equal(b.get('projectSaveOverwrite').hidden,false);
  assert.deepEqual(remote.calls.map(call=>JSON.parse(call.options.body).action),['save','save']);
  b.get('projectSaveOverwriteCheck').checked=true;await submit(b,'projectSaveForm');
  assert.deepEqual(remote.calls.map(call=>JSON.parse(call.options.body).action),['save','save','save']);
  assert.equal(b.get('projectSaveDialog').open,false);
});
