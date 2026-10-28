const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("アプリのスクリプト・画像・添付資料はすべて同梱されている", () => {
  const root = path.resolve(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((value) => !/^(?:#|[a-z][a-z\d+.-]*:)/i.test(value));
  assert.ok(assets.length > 0);
  for (const asset of new Set(assets)) {
    const file = path.resolve(root, decodeURIComponent(asset.split(/[?#]/)[0]));
    const relative = path.relative(root, file);
    assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative), asset);
    assert.ok(fs.statSync(file).isFile(), asset);
  }
});
