const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, projectPath, REPOSITORY } = require('../apps/keraba/github-store.js');

test('保存先を専用リポジトリ内に固定し、日本語・小数をUTF-8で往復する', async () => {
  const calls = [];
  const text = JSON.stringify({ name: '保存検証', pitch: 4.25, blank: null });
  const store = createStore({ fetcher: async (url, options) => {
    calls.push({ url, options });
    return Response.json(options.method === 'PUT' ? { content: { sha: 'new-sha' } } :
      { type: 'file', size: Buffer.byteLength(text), encoding: 'base64', sha: 'old-sha', content: Buffer.from(text).toString('base64') });
  } });
  store.setToken('test-key');
  const path = projectPath('保存検証_通常');
  assert.deepEqual(await store.read(path), { path, sha: 'old-sha', text });
  assert.deepEqual(await store.save(path, text, 'old-sha'), { path, sha: 'new-sha' });
  const body = JSON.parse(calls[1].options.body);
  assert.equal(Buffer.from(body.content, 'base64').toString('utf8'), text);
  assert.equal(body.sha, 'old-sha');
  assert.equal(body.branch, 'main');
  assert.equal(body.message, 'Save Keraba project');
  for (const { url, options } of calls) {
    assert.ok(url.startsWith('https://api.github.com/repos/' + REPOSITORY + '/contents/projects/'));
    assert.ok(!url.includes('test-key'));
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    assert.ok(!String(options.body).includes('test-key'));
  }
});

test('未接続でも一覧・読込ができ、千件を超える一覧と検索用の保存名を維持する', async () => {
  const tree = Array.from({ length: 1005 }, (_, i) => ({ path: `projects/検証${i}.json`, type: 'blob', mode: '100644', sha: String(i) }));
  tree.push({ path: 'projects/link.json', type: 'blob', mode: '120000' }, { path: 'other.json', type: 'blob' }, { path: 'projects/sub/a.json', type: 'blob' });
  const store = createStore({ fetcher: async (url, options) => {
    assert.ok(url.includes('/git/trees/main?recursive=1&_='));
    assert.equal(options.headers.Authorization, undefined);
    return Response.json({ tree, truncated: false });
  } });
  assert.equal((await store.list()).length, 1005);
  await assert.rejects(store.save('projects/a.json', '{}'), /GitHub接続/);
});

test('一覧の欠落・過大ファイル・不正UTF-8・保存先外のパスを拒否する', async () => {
  for (const response of [{ truncated: true, tree: [] }, { wrong: [] }]) {
    const store = createStore({ fetcher: async () => Response.json(response) });
    await assert.rejects(store.list(), /すべて取得/);
  }
  for (const file of [
    { type: 'file', encoding: 'base64', sha: 'a', size: 1024 * 1024 + 1, content: '' },
    { type: 'symlink', encoding: 'base64', sha: 'a', size: 2, content: 'e30=' },
    { type: 'file', encoding: 'base64', sha: 'a', size: 2, content: '/w==' },
  ]) {
    const store = createStore({ fetcher: async () => Response.json(file) });
    await assert.rejects(store.read('projects/a.json'), /読み取れません/);
  }
  const store = createStore({ fetcher: async () => { throw new Error('呼んではいけない'); } });
  for (const path of ['../a.json', 'projects/../a.json', 'projects/a.txt', 'https://example.test/a.json']) {
    await assert.rejects(store.read(path), /保存先/);
  }
  for (const name of ['', 'a/b', 'a\\b', 'CON', 'name.', 'a'.repeat(121)]) assert.throws(() => projectPath(name));
});

test('競合・権限切れ・回数制限を区別し、GitHubの応答本文を画面へ漏らさない', async () => {
  for (const [status, message] of [[401, /接続が切れ/], [403, /権限または利用回数/], [404, /見つかりません/],
    [409, /別のPC/], [422, /更新された可能性/], [429, /集中/], [500, /通信に失敗/]]) {
    const store = createStore({ fetcher: async () => new Response('secret-response', { status }) });
    store.setToken('test-key');
    await assert.rejects(store.read('projects/a.json'), error => message.test(error.message) && !error.message.includes('secret-response'));
  }
});

test('未登録の確認だけ404を許し、認証失敗で接続キーを破棄する', async () => {
  const store = createStore({ fetcher: async () => new Response('', { status: 404 }) });
  assert.equal(await store.read('projects/new.json', true), null);
  await assert.rejects(store.read('projects/new.json'), /見つかりません/);
  await assert.rejects(store.connect('test-key'));
  assert.equal(store.hasToken(), false);
});

test('同じ保存先の連続読み出しもURLを更新し、更新前の公開APIキャッシュを再利用しない', async () => {
  const urls = [];
  const store = createStore({ fetcher: async url => {
    urls.push(url);
    return Response.json({ type: 'file', size: 2, encoding: 'base64', sha: 'a', content: 'e30=' });
  } });
  await store.read('projects/a.json');
  await store.read('projects/a.json');
  assert.notEqual(urls[0], urls[1]);
  for (const url of urls) {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('ref'), 'main');
    assert.ok(parsed.searchParams.has('_'));
  }
});

test('通信切断・タイムアウトでは保存を自動再試行せず完了未確認と表示する', async () => {
  let calls = 0;
  const store = createStore({ timeout: 1, fetcher: async (url, { signal }) => {
    calls++;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('', 'AbortError'))));
  } });
  store.setToken('test-key');
  await assert.rejects(store.save('projects/a.json', '{}'), /保存完了を確認できません/);
  assert.equal(calls, 1);
  const offline = createStore({ fetcher: async () => { throw new TypeError('network'); } });
  await assert.rejects(offline.list(), /ネットワーク/);
});

test('保存上限1 MBは文字数ではなくUTF-8のバイト数で判定する', async () => {
  let calls = 0;
  const store = createStore({ fetcher: async () => { calls++; return Response.json({ content: { sha: 'saved' } }); } });
  store.setToken('test-key');
  const boundary = 'あ'.repeat(349525) + 'a';
  assert.equal(Buffer.byteLength(boundary), 1024 * 1024);
  await store.save('projects/a.json', boundary);
  await assert.rejects(store.save('projects/a.json', boundary + 'a'), /1 MB/);
  assert.equal(calls, 1);
});
