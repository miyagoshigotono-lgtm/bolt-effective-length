const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { JSDOM } = require("jsdom");
const { assets, output, buildSite } = require("../scripts/build-site.cjs");

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(relative) : [relative];
  });
}

test("公開用ファイルは原本と一致し、参照切れや保存データの混入がない", () => {
  buildSite();
  const root = path.resolve(__dirname, "..");
  const expected = [...assets, ".nojekyll"].sort();
  const actual = filesIn(output)
    .map((file) => path.relative(output, file).split(path.sep).join("/"))
    .sort();
  assert.deepEqual(actual, expected);
  for (const asset of assets) {
    const hash = (file) =>
      createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    assert.equal(hash(path.join(output, asset)), hash(path.join(root, asset)));
  }

  const dom = new JSDOM(fs.readFileSync(path.join(output, "index.html"), "utf8"));
  try {
    for (const element of dom.window.document.querySelectorAll("[src], [href]")) {
      const url = element.getAttribute("src") || element.getAttribute("href");
      if (!url || /^(?:#|[a-z][a-z\d+.-]*:)/i.test(url)) continue;
      assert.ok(
        fs.statSync(path.join(output, decodeURIComponent(url))).isFile(),
        url,
      );
    }
  } finally {
    dom.window.close();
  }

  // 前回の出力に残った対象外ファイルを、再生成時に持ち越さない。
  const stale = path.join(output, "private-draft.json");
  fs.writeFileSync(stale, "{}");
  buildSite();
  assert.equal(fs.existsSync(stale), false);
});
