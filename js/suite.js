(function () {
  "use strict";
  const tabs = Array.from(document.querySelectorAll('[role="tab"][data-app]'));
  const ids = tabs.map((tab) => tab.dataset.app);
  const storageKey = "wood-calculators.active.v1";
  function storedApp() {
    try { return localStorage.getItem(storageKey); } catch { return null; }
  }
  function activate(id, writeHash = false) {
    if (!ids.includes(id)) return;
    for (const tab of tabs) {
      const selected = tab.dataset.app === id;
      const panel = document.getElementById(tab.getAttribute("aria-controls"));
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panel.setAttribute("aria-hidden", String(!selected));
      panel.toggleAttribute("inert", !selected);
      const frame = panel.querySelector("iframe");
      // 一度開いた画面は読み直さず、途中の入力・図の位置・取り消し履歴を保つ。
      if (selected && !frame.hasAttribute("src")) frame.src = frame.dataset.src;
      if (selected) document.title = tab.textContent + " | 計算ツール";
    }
    try { localStorage.setItem(storageKey, id); } catch { /* 保存できなくても切替は続ける。 */ }
    if (writeHash && location.hash !== "#" + id) location.hash = id;
  }
  for (const tab of tabs) {
    tab.addEventListener("click", () => activate(tab.dataset.app, true));
    tab.addEventListener("keydown", (event) => {
      const index = tabs.indexOf(tab);
      const next = {
        ArrowRight: (index + 1) % tabs.length,
        ArrowLeft: (index + tabs.length - 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1,
      }[event.key];
      if (next == null) return;
      event.preventDefault();
      activate(tabs[next].dataset.app, true);
      tabs[next].focus();
    });
  }
  window.addEventListener("hashchange", () => activate(location.hash.slice(1)));
  const requested = location.hash.slice(1);
  const initial = ids.includes(requested) ? requested : ids.includes(storedApp()) ? storedApp() : "keraba";
  activate(initial);
  // 旧ボルト画面への寸法・結果リンクも、同じ画面内へ引き継ぐ。
  if (["result-section", "dimension-details"].includes(requested)) {
    document.querySelector("#panel-bolt iframe").src = "bolt.html?v=20261030-1#" + requested;
    activate("bolt");
  }
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
  }
})();
