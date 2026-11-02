(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KerabaCloud = factory();
})(typeof self === 'object' ? self : globalThis, function () {
  'use strict';
  const ENDPOINT = 'https://keraba-cloud-storage.workspace-010102.chatgpt.site/api/projects';
  const OWNER_KEY = 'keraba.cloud-owner.v1';
  const MAX_BYTES = 1024 * 1024;
  function projectPath(name) {
    if (typeof name !== 'string' || !name.trim() || name.length > 120 ||
        /[<>:"/\\|?*\u0000-\u001f\u007f]/.test(name) || /[. ]$/.test(name) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
      throw new Error('保存名を入力してください。記号 \\ / : * ? " < > | は使えません。');
    }
    return name;
  }
  function createStore({ fetcher = (...args) => fetch(...args), storage,
    random = bytes => crypto.getRandomValues(bytes), timeout = 20000 } = {}) {
    let owner = '';
    function getOwner() {
      if (owner) return owner;
      let saved = '';
      try {
        if (storage === undefined) storage = globalThis.localStorage;
        saved = storage?.getItem(OWNER_KEY) || '';
      } catch { /* 記憶できない場合は、保存操作で理由を知らせる。 */ }
      if (/^[a-f0-9]{64}$/.test(saved)) { owner = saved; return owner; }
      const generated = [...random(new Uint8Array(32))].map(value => value.toString(16).padStart(2, '0')).join('');
      try {
        storage.setItem(OWNER_KEY, generated);
        if (storage.getItem(OWNER_KEY) !== generated) throw new Error();
      } catch { throw new Error('このブラウザに保存先を記憶できません。ブラウザの保存設定を確認してください。入力は残っています。'); }
      owner = generated;
      return owner;
    }
    async function request(body, missing = false) {
      const identity = getOwner();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetcher(ENDPOINT, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Keraba-Owner': identity },
          body: JSON.stringify(body), cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal,
        });
        if (missing && response.status === 404) return null;
        if (!response.ok) {
          if (response.status === 409) {
            const error=new Error('別の画面で更新されているか、同じ保存名があります。開き直すか、別の名前で保存してください。');
            error.status=409;
            const detail=await response.json().catch(()=>null);
            if(/^[1-9]\d*$/.test(detail?.existingRevision || '') && Number.isSafeInteger(Number(detail.existingRevision))) error.existingSha=detail.existingRevision;
            throw error;
          }
          if (response.status === 413) throw new Error('保存データは1 MB以内にしてください。');
          throw new Error('クラウドとの通信に失敗しました。入力は残っています。少し待ってからやり直してください。');
        }
        return await response.json();
      } catch (error) {
        if (error instanceof TypeError || error.name === 'AbortError') throw new Error(body.action === 'save'
          ? '保存完了を確認できませんでした。「開く」で確認してください。入力は残っています。'
          : 'クラウドに接続できません。ネットワークを確認してください。入力は変更していません。');
        throw error;
      } finally { clearTimeout(timer); }
    }
    return {
      async list() {
        const result = await request({ action: 'list' });
        if (!Array.isArray(result.items)) throw new Error('保存一覧を読み取れませんでした。');
        return result.items;
      },
      async read(name, missing = false) { projectPath(name); return request({ action: 'load', name }, missing); },
      async save(name, text, sha) {
        projectPath(name);
        if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('保存データは1 MB以内にしてください。');
        const result = await request({ action: 'save', name, document: JSON.parse(text), revision: sha ? Number(sha) : null });
        if (!result?.sha || result.path !== name) throw new Error('保存完了を確認できませんでした。「開く」で確認してください。');
        return result;
      },
    };
  }
  return { ENDPOINT, OWNER_KEY, projectPath, createStore };
});
