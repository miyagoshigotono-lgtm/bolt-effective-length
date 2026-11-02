(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KerabaGitHub = factory();
})(typeof self === 'object' ? self : globalThis, function () {
  'use strict';
  const REPOSITORY = 'miyagoshigotono-lgtm/keraba-project-data';
  const BASE = 'https://api.github.com/repos/' + REPOSITORY;
  const MAX_BYTES = 1024 * 1024;
  let requestNumber = 0;

  function projectPath(name) {
    if (typeof name !== 'string' || !name.trim() || name.length > 120 ||
        /[<>:"/\\|?*\u0000-\u001f\u007f]/.test(name) || /[. ]$/.test(name) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
      throw new Error('保存名を入力してください。記号 \\ / : * ? " < > | は使えません。');
    }
    return 'projects/' + name + '.json';
  }

  function safePath(path) {
    if (typeof path !== 'string' || !/^projects\/[^/\\]+\.json$/i.test(path) ||
        /[\u0000-\u001f\u007f]/.test(path)) throw new Error('保存先が正しくありません。');
    return path.split('/').map(encodeURIComponent).join('/');
  }

  function createStore({ fetcher = (...args) => fetch(...args), timeout = 20000 } = {}) {
    let token = '';
    async function request(route, { method = 'GET', body, missing = false } = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
        if (token) headers.Authorization = 'Bearer ' + token;
        if (body) headers['Content-Type'] = 'application/json';
        // 公開APIの中継キャッシュに古いmainの内容が残るため、読込ごとにURLも更新する。
        const freshRoute = method === 'GET' ? route + (route.includes('?') ? '&' : '?') +
          '_=' + Date.now() + '-' + (++requestNumber) : route;
        const response = await fetcher(BASE + freshRoute, {
          method, headers, credentials: 'omit', cache: 'no-store', redirect: 'error',
          signal: controller.signal, ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (missing && response.status === 404) return null;
        if (!response.ok) {
          const messages = {
            401: 'GitHubの接続が切れています。「GitHub接続」から接続し直してください。',
            403: 'GitHubの権限または利用回数を確認してください。保存には保存先の Contents: Read and write が必要です。',
            404: '保存データが見つかりません。削除されたか、保存先への権限がありません。',
            409: '別のPCで更新されています。クラウドから開き直すか、別の保存名にしてください。',
            422: '同じ保存名のデータが更新された可能性があります。開き直すか、別の保存名にしてください。',
            429: 'GitHubへのアクセスが集中しています。少し待ってからやり直してください。',
          };
          throw new Error(messages[response.status] || 'GitHubとの通信に失敗しました。入力は残っています。');
        }
        return await response.json();
      } catch (error) {
        // 通信ライブラリの例外に認証情報や送信内容を混ぜて表示しない。
        if (error instanceof TypeError || error.name === 'AbortError') {
          throw new Error(method === 'PUT'
            ? '保存完了を確認できませんでした。「開く」でクラウドの内容を確認してください。入力は残っています。'
            : 'クラウドに接続できません。ネットワークを確認してください。入力は変更していません。');
        }
        throw error;
      } finally { clearTimeout(timer); }
    }

    async function read(path, missing = false) {
      const file = await request('/contents/' + safePath(path) + '?ref=main', { missing });
      if (!file) return null;
      if (file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string' ||
          file.size > MAX_BYTES || file.content.length > MAX_BYTES * 1.4 || !file.sha) {
        throw new Error('この保存データは読み取れません。1 MB以内のケラバデータを選んでください。');
      }
      let text;
      try {
        const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, '')), char => char.charCodeAt(0));
        if (bytes.length > MAX_BYTES) throw new Error();
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch { throw new Error('保存データの文字を読み取れません。入力は変更していません。'); }
      return { path, sha: file.sha, text };
    }

    return {
      setToken(value) {
        if (typeof value !== 'string' || /\s/.test(value)) throw new Error('接続キーを確認してください。');
        token = value;
      },
      hasToken: () => Boolean(token),
      async connect(value) {
        this.setToken(value);
        try { await request(''); } catch (error) { token = ''; throw error; }
      },
      async list() {
        const result = await request('/git/trees/main?recursive=1');
        if (!Array.isArray(result.tree) || result.truncated) throw new Error('保存一覧をすべて取得できませんでした。GitHubの保存先を確認してください。');
        return result.tree.filter(file => file.type === 'blob' && file.mode !== '120000' &&
          /^projects\/[^/\\]+\.json$/i.test(file.path)).map(file => ({
          path: file.path, sha: file.sha, name: file.path.slice(9, -5),
        })).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      },
      read,
      async save(path, text, sha) {
        if (!token) throw new Error('「GitHub接続」から接続してから保存してください。');
        const bytes = new TextEncoder().encode(text);
        if (bytes.length > MAX_BYTES) throw new Error('保存データは1 MB以内にしてください。');
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        // 開いた時点のSHAで更新し、他のPCの変更を勝手に上書きしない。
        const result = await request('/contents/' + safePath(path), {
          method: 'PUT', body: { message: 'Save Keraba project', content: btoa(binary), branch: 'main', ...(sha ? { sha } : {}) },
        });
        if (!result.content?.sha) throw new Error('保存完了を確認できませんでした。「開く」でクラウドの内容を確認してください。');
        return { path, sha: result.content.sha };
      },
    };
  }
  return { REPOSITORY, projectPath, createStore };
});
