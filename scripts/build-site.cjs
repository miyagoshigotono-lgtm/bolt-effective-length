const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist");
const assets = [
  "index.html",
  "styles.css",
  "js/defaults.js",
  "js/calculator.js",
  "js/drawing.js",
  "js/app.js",
  "data/defaults.json",
  "vendor/lucide.min.js",
  "vendor/lucide-LICENSE.txt",
  "通常の有効長初期値.pdf",
  "サンプル.pdf",
  "有効長を見るための座金やナットなど.pdf",
  "サンプル２.png",
  "ダウンロード.png",
  "CAD画面の断面図.png",
  "仕様.md",
];

function buildSite() {
  // 出力先を作業フォルダ直下に固定し、リンク先や原本を削除しない。
  if (
    path.dirname(output) !== root ||
    (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink())
  )
    throw new Error("公開用フォルダの場所を確認してください。");
  for (const asset of assets)
    if (!fs.statSync(path.join(root, asset)).isFile())
      throw new Error(`公開用ファイルがありません: ${asset}`);

  fs.rmSync(output, { recursive: true, force: true });
  for (const asset of assets) {
    const target = path.join(output, asset);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, asset), target);
  }
  fs.writeFileSync(path.join(output, ".nojekyll"), "");
  return output;
}

if (require.main === module) {
  buildSite();
  console.log(`アプリに必要な${assets.length}ファイルを公開用に用意しました。`);
}

module.exports = { assets, output, buildSite };
