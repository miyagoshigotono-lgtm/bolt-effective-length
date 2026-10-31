(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WOOD_CALCULATOR_ASSETS = factory();
})(typeof self === "object" ? self : globalThis, function () {
  "use strict";
  // 配信とオフライン保存で、同じ公開対象だけを使う。
  return [
    "index.html", "suite.css", "js/suite.js", "js/site-assets.js",
    "manifest.webmanifest", "sw.js", "assets/calculator.svg", "assets/icon-192.png", "assets/icon-512.png", "assets/icon-512-maskable.png",
    "bolt.html", "styles.css", "js/defaults.js", "js/calculator.js", "js/drawing.js", "js/app.js",
    "data/defaults.json", "vendor/lucide.min.js", "vendor/lucide-LICENSE.txt",
    "通常の有効長初期値.pdf", "サンプル.pdf", "有効長を見るための座金やナットなど.pdf",
    "サンプル２.png", "ダウンロード.png", "CAD画面の断面図.png", "仕様.md",
    "apps/keraba/index.html", "apps/keraba/icon-192.png", "apps/kebiki/index.html",
  ];
});
