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
