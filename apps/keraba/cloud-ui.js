(function () {
  'use strict';
  const store = KerabaCloud.createStore();
  let busy = false, listed = [], overwrite = null;
  const cleanInputs = projectCleanInputs;
  const clean = () => JSON.stringify(readForm());
  for (const mode of ['normal','tile']) {
    try { cleanInputs[mode] = localStorage.getItem('keraba.cloud-clean.' + mode + '.v1'); } catch { /* 保存不可では未保存として確認する。 */ }
  }
  function markClean(mode, snapshot) {
    cleanInputs[mode] = snapshot;
    try { localStorage.setItem('keraba.cloud-clean.' + mode + '.v1', snapshot); } catch { /* 画面を閉じるまでは比較できる。 */ }
  }
  window.markProjectClean = () => markClean(activeMode, clean());
  const controls = ['btnSaveProject', 'btnOpenProject', 'btnReset', 'btnUndoOpen',
    'projectSaveSubmit', 'projectSaveCancel', 'projectSaveName', 'cloudRefresh', 'cloudImportLegacy',
    'cloudOpenClose'];

  function setBusy(value) {
    busy = value;
    for (const id of controls) $(id).disabled = value;
    for (const button of $('cloudProjectList').querySelectorAll('button')) button.disabled = value;
    for (const id of ['projectSaveDialog', 'cloudOpenDialog']) $(id).setAttribute('aria-busy', String(value));
  }
  try { sessionStorage.removeItem('keraba.github-session.v1'); } catch { /* 旧接続キーを残さない。 */ }

  function inputSignature() {
    const doc = createProjectDocument();
    return JSON.stringify({ roofMode: doc.roofMode, inputs: doc.inputs });
  }

  function openSave() {
    if (busy) return;
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
    try { path = KerabaCloud.projectPath(name); }
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
      markClean(mode, JSON.stringify(doc.inputs));
      $('projectSaveDialog').close();
      const changed = inputSignature() !== JSON.stringify({ roofMode: doc.roofMode, inputs: doc.inputs });
      showFileStatus(name + ' を保存しました。' + (changed ? '保存中に変更した入力は、もう一度保存してください。' : ''));
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
    $('cloudOpenStatus').textContent = '保存一覧を読み込んでいます…';
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
      markClean(activeMode, clean());
      $('cloudOpenDialog').close();
      showFileStatus(item.name + ' を開きました。');
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

  function resetInputs() {
    // リセットは表示中の入力だけを戻し、保存済みのクラウドデータには触れない。
    try { localStorage.removeItem(STORAGE_KEYS[activeMode]); } catch { /* 入力欄のリセットは続ける。 */ }
    $('ackWarning').checked = false;
    projectCloudRecords[activeMode] = null;
    projectSaveNames[activeMode] = '';
    fileImportBackup = null;
    $('btnUndoOpen').hidden = true;
    writeForm(loadSavedForm(activeMode));
    refresh();
    markClean(activeMode, clean());
    showFileStatus('入力をリセットしました。保存済みデータは残っています。');
  }
  $('btnReset').onclick = () => {
    if (busy) return;
    const dirty = cleanInputs[activeMode] === null || clean() !== cleanInputs[activeMode];
    if (dirty) $('projectResetDialog').showModal();
    else resetInputs();
  };
  $('projectResetCancel').onclick = () => $('projectResetDialog').close();
  $('projectResetConfirm').onclick = () => {
    $('projectResetDialog').close();
    resetInputs();
  };
  for (const id of ['projectSaveDialog', 'cloudOpenDialog']) {
    $(id).addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  }
})();
