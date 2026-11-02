(function () {
  'use strict';
  const store = KerabaGitHub.createStore();
  const sessionKey = 'keraba.github-session.v1';
  let busy = false, pendingAction = null, listed = [], overwrite = null;
  const controls = ['btnSaveProject', 'btnOpenProject', 'btnGitHubConnect', 'btnUndoOpen',
    'projectSaveSubmit', 'projectSaveCancel', 'projectSaveName', 'cloudRefresh', 'cloudImportLegacy',
    'cloudOpenClose', 'cloudConnectSubmit', 'cloudConnectCancel', 'cloudDisconnect', 'cloudToken'];

  function setBusy(value) {
    busy = value;
    for (const id of controls) $(id).disabled = value;
    for (const button of $('cloudProjectList').querySelectorAll('button')) button.disabled = value;
    for (const id of ['projectSaveDialog', 'cloudOpenDialog', 'cloudConnectDialog']) $(id).setAttribute('aria-busy', String(value));
  }
  function updateConnection() {
    $('btnGitHubConnect').textContent = store.hasToken() ? 'GitHub接続済み' : 'GitHub接続';
    $('cloudDisconnect').hidden = !store.hasToken();
  }
  function forgetConnection() {
    store.setToken('');
    try { sessionStorage.removeItem(sessionKey); } catch { /* 端末保存が禁止でも画面内の接続は解除する。 */ }
    updateConnection();
  }
  try { store.setToken(sessionStorage.getItem(sessionKey) || ''); } catch { /* タブ内の接続だけでも利用できる。 */ }
  updateConnection();

  function inputSignature() {
    const doc = createProjectDocument();
    return JSON.stringify({ roofMode: doc.roofMode, inputs: doc.inputs });
  }

  function openConnect(action = null) {
    if (busy) return;
    pendingAction = action;
    $('cloudToken').value = '';
    $('cloudConnectError').textContent = '';
    updateConnection();
    $('cloudConnectDialog').showModal();
    $('cloudToken').focus();
  }

  function openSave() {
    if (busy) return;
    if (!store.hasToken()) { openConnect('save'); return; }
    overwrite = null;
    $('projectSaveOverwrite').hidden = true;
    $('projectSaveOverwriteCheck').checked = false;
    $('projectSaveName').value = projectSaveNames[activeMode] || projectFileName().replace(/\.json$/i, '');
    $('projectSaveError').textContent = '';
    $('projectSaveDialog').showModal();
    $('projectSaveName').focus();
    $('projectSaveName').select();
  }
  $('btnSaveProject').onclick = openSave;
  $('projectSaveCancel').onclick = () => $('projectSaveDialog').close();
  $('projectSaveName').oninput = () => {
    overwrite = null;
    $('projectSaveOverwrite').hidden = true;
    $('projectSaveOverwriteCheck').checked = false;
    $('projectSaveError').textContent = '';
  };
  $('projectSaveForm').onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    const name = $('projectSaveName').value.trim().replace(/\.json$/i, '');
    let path;
    try { path = KerabaGitHub.projectPath(name); }
    catch (error) { $('projectSaveError').textContent = error.message; $('projectSaveName').focus(); return; }
    const doc = createProjectDocument(), mode = doc.roofMode;
    const record = projectCloudRecords[mode];
    setBusy(true);
    $('projectSaveError').textContent = 'クラウドへ保存しています…';
    try {
      let sha;
      if (record?.path === path) sha = record.sha;
      else {
        if (overwrite?.path !== path) {
          const existing = await store.read(path, true);
          overwrite = existing ? { path, sha: existing.sha } : null;
        }
        if (overwrite && !$('projectSaveOverwriteCheck').checked) {
          $('projectSaveOverwrite').hidden = false;
          $('projectSaveError').textContent = '同じ名前のデータがあります。上書きするか、保存名を変えてください。';
          return;
        }
        sha = overwrite?.sha;
      }
      const saved = await store.save(path, JSON.stringify(doc, null, 2) + '\n', sha);
      projectCloudRecords[mode] = saved;
      projectSaveNames[mode] = name;
      $('projectSaveDialog').close();
      const changed = inputSignature() !== JSON.stringify({ roofMode: doc.roofMode, inputs: doc.inputs });
      showFileStatus(name + ' をGitHubに保存しました。' + (changed ? '保存中に変更した入力は、もう一度保存してください。' : ''));
    } catch (error) {
      $('projectSaveError').textContent = error.message;
      showFileStatus(error.message, true);
    } finally { setBusy(false); }
  };

  function showList() {
    const query = $('cloudSearch').value.trim().toLocaleLowerCase('ja');
    const items = listed.filter(item => item.name.toLocaleLowerCase('ja').includes(query));
    $('cloudProjectList').replaceChildren();
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.name;
      button.disabled = busy;
      button.onclick = () => loadProject(item);
      $('cloudProjectList').appendChild(button);
    }
    $('cloudOpenStatus').classList.remove('cloud-error');
    $('cloudOpenStatus').textContent = !listed.length ? '保存データはまだありません。' :
      items.length ? items.length + '件の保存データ' : 'その保存名は見つかりません。';
  }
  async function refreshList() {
    if (busy) return;
    setBusy(true);
    listed = [];
    $('cloudProjectList').replaceChildren();
    $('cloudOpenStatus').classList.remove('cloud-error');
    $('cloudOpenStatus').textContent = 'GitHubから保存一覧を読み込んでいます…';
    try { listed = await store.list(); showList(); }
    catch (error) { $('cloudOpenStatus').textContent = error.message; $('cloudOpenStatus').classList.add('cloud-error'); }
    finally { setBusy(false); }
  }
  async function loadProject(item) {
    if (busy) return;
    const before = inputSignature();
    setBusy(true);
    $('cloudOpenStatus').textContent = '保存データを読み込んでいます…';
    try {
      const file = await store.read(item.path);
      // 取得待ちの間に利用者が変えた入力は置き換えない。
      if (before !== inputSignature()) throw new Error('読み込み中に入力が変わりました。開くデータをもう一度選んでください。');
      openProjectText(file.text, item.name + '.json');
      projectCloudRecords[activeMode] = { path: file.path, sha: file.sha };
      projectSaveNames[activeMode] = item.name;
      $('cloudOpenDialog').close();
      showFileStatus(item.name + ' をGitHubから開きました。');
    } catch (error) { $('cloudOpenStatus').textContent = error.message; $('cloudOpenStatus').classList.add('cloud-error'); }
    finally { setBusy(false); }
  }
  $('btnOpenProject').onclick = () => {
    if (busy) return;
    $('cloudSearch').value = '';
    $('cloudOpenDialog').showModal();
    refreshList();
  };
  $('cloudSearch').oninput = () => { if (!busy) showList(); };
  $('cloudRefresh').onclick = refreshList;
  $('cloudOpenClose').onclick = () => $('cloudOpenDialog').close();
  $('cloudImportLegacy').onclick = () => {
    $('cloudOpenDialog').close();
    $('projectFile').value = '';
    $('projectFile').click();
  };

  $('btnGitHubConnect').onclick = () => openConnect();
  $('cloudConnectCancel').onclick = () => { pendingAction = null; $('cloudConnectDialog').close(); };
  $('cloudDisconnect').onclick = () => {
    forgetConnection();
    pendingAction = null;
    $('cloudConnectDialog').close();
    showFileStatus('GitHubの接続を解除しました。保存データはクラウドに残っています。');
  };
  $('cloudConnectForm').onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    const token = $('cloudToken').value.trim();
    if (!token) { $('cloudConnectError').textContent = '接続キーを入力してください。'; return; }
    setBusy(true);
    $('cloudConnectError').textContent = '接続を確認しています…';
    let connected = false;
    try {
      await store.connect(token);
      try { sessionStorage.setItem(sessionKey, token); } catch { /* タブ内のメモリで接続を維持する。 */ }
      connected = true;
      $('cloudConnectDialog').close();
      showFileStatus('GitHubに接続しました。');
    } catch (error) { forgetConnection(); $('cloudConnectError').textContent = error.message; }
    finally { $('cloudToken').value = ''; setBusy(false); updateConnection(); }
    if (connected && pendingAction === 'save') openSave();
    pendingAction = null;
  };
  for (const id of ['projectSaveDialog', 'cloudOpenDialog', 'cloudConnectDialog']) {
    $(id).addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  }
  $('cloudConnectDialog').addEventListener('close', () => { $('cloudToken').value = ''; });
})();
