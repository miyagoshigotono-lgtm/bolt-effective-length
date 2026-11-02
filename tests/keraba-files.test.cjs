const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

function github() {
  const files = new Map(), calls = [];
  let revision = 0;
  const put = (name, doc) => {
    const file = { sha: 'sha-' + (++revision), text: JSON.stringify(doc) };
    files.set('projects/' + name + '.json', file);
    return file;
  };
  return { files, calls, put, async fetcher(url, options) {
    calls.push({ url, options });
    const route = decodeURIComponent(new URL(url).pathname);
    if (route.endsWith('/git/trees/main')) return Response.json({ truncated: false,
      tree: [...files].map(([path, file]) => ({ path, sha: file.sha, type: 'blob', mode: '100644' })) });
    if (!route.includes('/contents/')) return Response.json({ full_name: 'miyagoshigotono-lgtm/keraba-project-data' });
    const path = route.split('/contents/')[1], previous = files.get(path);
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body);
      if ((previous?.sha || undefined) !== body.sha) return new Response('', { status: 409 });
      const file = { sha: 'sha-' + (++revision), text: Buffer.from(body.content, 'base64').toString('utf8') };
      files.set(path, file);
      return Response.json({ content: { sha: file.sha } });
    }
    if (!previous) return new Response('', { status: 404 });
    return Response.json({ type: 'file', encoding: 'base64', sha: previous.sha,
      size: Buffer.byteLength(previous.text), content: Buffer.from(previous.text).toString('base64') });
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

function keraba(t, { blocked = false, fetcher, sessionToken } = {}) {
  const errors = [];
  const console = new VirtualConsole();
  console.on("jsdomError", (error) => errors.push(error.message));
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, "../apps/keraba/index.html"), "utf8"), {
    url: "https://example.test/tools/apps/keraba/",
    runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: console,
    beforeParse(w) {
      w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
      if (fetcher) w.fetch = fetcher;
      if (sessionToken) w.sessionStorage.setItem("keraba.github-session.v1", sessionToken);
      w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open",""); };
      w.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
      w.localStorage.setItem("bolt-proof", "keep");
      w.localStorage.setItem("kebiki-line.input.v1", "keep");
      if (blocked) Object.defineProperty(w, "localStorage", { get() { throw new Error("保存不可"); } });
    },
  });
  for (const file of ["github-store.js", "cloud-ui.js"]) dom.window.eval(fs.readFileSync(path.join(__dirname, "../apps/keraba/", file), "utf8"));
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

test('通常・瓦をGitHubへ保存し、別PCが未接続のまま入力・図・発注書を復元する', async t => {
  const remote = github();
  for (const mode of ['normal', 'tile']) {
    const a = keraba(t, { fetcher: remote.fetcher, sessionToken: 'test-key' });
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
    assert.match(a.get('fileStatus').textContent, /GitHubに保存/);
    const b = keraba(t, { fetcher: remote.fetcher });
    await openCloud(b, '共有検証_' + mode);
    assert.deepEqual(b.doc().inputs, doc.inputs);
    assert.deepEqual(b.svg(), svg);
    assert.equal(b.get('btnGitHubConnect').textContent, 'GitHub接続');
    assert.match(b.get('fileStatus').textContent, /GitHubから開き/);
    assert.equal(b.w.localStorage.getItem('bolt-proof'), 'keep');
    assert.equal(b.w.localStorage.getItem('kebiki-line.input.v1'), 'keep');
  }
  const writes = remote.calls.filter(call => call.options.method === 'PUT');
  assert.equal(writes.length, 2);
  for (const call of writes) {
    assert.ok(!call.options.body.includes('test-key'));
    assert.equal(JSON.parse(call.options.body).message, 'Save Keraba project');
  }
});

test('保存名確認・禁止名・キャンセルを維持し、ファイルをダウンロードしない', async t => {
  const remote = github(), a = keraba(t, { fetcher: remote.fetcher, sessionToken: 'test-key' });
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
  assert.ok(remote.files.has('projects/確認した名前.json'));
  assert.deepEqual(a.doc().inputs, before);
  a.get('btnSaveProject').click();
  assert.equal(a.get('projectSaveName').value, '確認した名前');
});

test('初回接続の後で保存名確認を開き、キーはタブ内だけに保持し、解除できる', async t => {
  const remote = github(), a = keraba(t, { fetcher: remote.fetcher });
  a.get('btnSaveProject').click();
  assert.equal(a.get('cloudConnectDialog').open, true);
  assert.equal(a.get('projectSaveDialog').open, false);
  a.get('cloudToken').value = 'test-key';
  await submit(a, 'cloudConnectForm');
  assert.equal(a.get('projectSaveDialog').open, true);
  assert.equal(a.get('cloudToken').value, '');
  assert.equal(a.w.sessionStorage.getItem('keraba.github-session.v1'), 'test-key');
  assert.ok(!Object.values(a.w.localStorage).join('').includes('test-key'));
  assert.ok(!JSON.stringify(a.doc()).includes('test-key'));
  a.get('projectSaveCancel').click();
  a.get('btnGitHubConnect').click();
  a.get('cloudDisconnect').click();
  assert.equal(a.w.sessionStorage.getItem('keraba.github-session.v1'), null);
  assert.equal(a.get('btnGitHubConnect').textContent, 'GitHub接続');
});

test('同じ名前の未読データは確認なしで置き換えず、確認後も古いSHAで競合を検知する', async t => {
  const remote = github(), a = keraba(t, { fetcher: remote.fetcher, sessionToken: 'test-key' });
  const doc = a.doc();
  doc.inputs.pitch = 8.5;
  remote.put('既存データ', doc);
  a.get('btnSaveProject').click();
  a.get('projectSaveName').value = '既存データ';
  await submit(a, 'projectSaveForm');
  assert.equal(a.get('projectSaveOverwrite').hidden, false);
  assert.equal(remote.calls.filter(call => call.options.method === 'PUT').length, 0);
  const newer = { ...doc, inputs: { ...doc.inputs, pitch: 6.5 } };
  remote.put('既存データ', newer);
  a.get('projectSaveOverwriteCheck').checked = true;
  await submit(a, 'projectSaveForm');
  assert.match(a.get('projectSaveError').textContent, /別のPC/);
  assert.equal(JSON.parse(remote.files.get('projects/既存データ.json').text).inputs.pitch, 6.5);
  assert.equal(a.get('projectSaveDialog').open, true);
});

test('開いた物件の更新と別PCの競合を区別し、取り込み取消しで元の保存先も戻す', async t => {
  const remote = github(), a = keraba(t, { fetcher: remote.fetcher, sessionToken: 'test-key' });
  remote.put('元のデータ', a.doc());
  remote.put('別のデータ', a.doc());
  await openCloud(a, '元のデータ');
  a.change('pitch', '3.5');
  a.get('btnSaveProject').click();
  await submit(a, 'projectSaveForm');
  assert.equal(JSON.parse(remote.files.get('projects/元のデータ.json').text).inputs.pitch, 3.5);
  await openCloud(a, '別のデータ');
  a.get('btnUndoOpen').click();
  assert.equal(a.get('pitch').value, '3.5');
  a.get('btnSaveProject').click();
  assert.equal(a.get('projectSaveName').value, '元のデータ');
  remote.put('元のデータ', a.doc());
  await submit(a, 'projectSaveForm');
  assert.match(a.get('projectSaveError').textContent, /別のPC/);
});

test('不正なクラウドデータは入力・図・元の保存先を変えず拒否し、保存名はHTMLとして描かない', async t => {
  const remote = github(), a = keraba(t, { fetcher: remote.fetcher });
  remote.put('<b>不正データ</b>', { format: 'other' });
  // スラッシュを含まない名前でHTML挿入への耐性を確認する。
  remote.files.set('projects/<img onerror=bad>.json', { sha: 'bad', text: '{broken' });
  const before = a.doc().inputs, svg = a.svg();
  a.get('btnOpenProject').click(); await settled(a);
  assert.equal(a.get('cloudProjectList').querySelector('img'), null);
  a.get('cloudSearch').value = 'img';
  a.get('cloudSearch').dispatchEvent(new a.w.Event('input'));
  assert.equal(a.get('cloudProjectList').children.length, 1);
  a.get('cloudProjectList').firstChild.click(); await settled(a);
  assert.match(a.get('cloudOpenStatus').textContent, /JSONを読み取れません/);
  assert.deepEqual(a.doc().inputs, before);
  assert.deepEqual(a.svg(), svg);
});

test('ブラウザ保存不可でもGitHubへ保存でき、権限不足でも入力と保存名を失わない', async t => {
  const remote = github();
  let denied = true;
  const a = keraba(t, { blocked: true, sessionToken: 'test-key', fetcher: (url, options) =>
    denied && options.method === 'PUT' ? Promise.resolve(new Response('', { status: 403 })) : remote.fetcher(url, options) });
  a.change('pitch', '5.5');
  a.get('btnSaveProject').click();
  a.get('projectSaveName').value = '再試行検証';
  await submit(a, 'projectSaveForm');
  assert.equal(a.get('projectSaveDialog').open, true);
  assert.equal(a.get('pitch').value, '5.5');
  assert.equal(a.get('projectSaveName').value, '再試行検証');
  assert.match(a.get('projectSaveError').textContent, /権限/);
  denied = false;
  await submit(a, 'projectSaveForm');
  assert.equal(a.get('projectSaveDialog').open, false);
  assert.equal(JSON.parse(remote.files.get('projects/再試行検証.json').text).inputs.pitch, 5.5);
});

test('起動と通常の入力では外部送信せず、保存操作のときだけ通信する', t => {
  const remote = github(), a = keraba(t, { fetcher: remote.fetcher });
  a.change('pitch', '3.5');
  a.get('tabTile').click();
  a.change('pitch', '7.5');
  assert.equal(remote.calls.length, 0);
});

test('取得待ちの入力変更を読み出しで上書きせず、再選択で読み込める', async t => {
  const remote = github();
  let release, pause = true;
  const a = keraba(t, { fetcher: async (url, options) => {
    if (url.includes('/contents/') && pause) await new Promise(resolve => { release = resolve; });
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
  const remote = github();
  let release;
  const a = keraba(t, { sessionToken: 'test-key', fetcher: async (url, options) => {
    if (options.method === 'PUT') await new Promise(resolve => { release = resolve; });
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
  assert.equal(JSON.parse(remote.files.get('projects/上書き検証.json').text).inputs.pitch, 4.25);
  assert.equal(a.get('pitch').value, '5.5');
  assert.match(a.get('fileStatus').textContent, /もう一度保存/);
});
