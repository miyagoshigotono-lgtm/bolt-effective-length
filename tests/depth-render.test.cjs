const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");
const calc = require("../js/calculator.js");
const drawing = require("../js/drawing.js");
const data = require("../data/defaults.json");
const out = path.join(__dirname, "depth-output");

function attribute(svg, name) {
  const match = svg.match(new RegExp(`${name}="([^"]+)"`));
  assert.ok(match, name);
  return Number(match[1]);
}

test("ボルト深さの位置・寸法・保存条件は横縦の画面図と出力図で一致", async () => {
  await fs.mkdir(out, { recursive: true });
  const results = [];
  for (const direction of ["horizontal", "vertical"])
    for (const boltType of ["single", "double"])
      for (const boltDepth of ["52", "60"]) {
        const m = calc.createModel(data);
        Object.assign(m, { direction, boltType, boltDepth });
        const r = calc.calculate(m, data);
        assert.equal(r.ok, true);
        assert.equal(r.effective, 277);
        assert.equal(r.required, boltType === "single" ? 296 : 306);
        assert.equal(r.selected, boltType === "single" ? 300 : 315);
        for (const [mode, options] of [
          ["screen", { compact: true }],
          ["export", {}],
          ["print", { compact: true, print: true }],
        ]) {
          const svg = drawing.render(r, data, options);
          assert.equal(attribute(svg, "data-bolt-depth"), Number(boltDepth));
          assert.ok(svg.includes("ボルト深さ"));
          assert.ok(!/穴の深さ|ボルト中心.*未確認|NaN|Infinity/.test(svg));
          if (mode !== "print") {
            const s = attribute(svg, "data-depth-scale");
            const face = attribute(svg, "data-depth-face-y");
            const axis = attribute(svg, "data-bolt-axis-y");
            assert.ok(Math.abs((axis - face) / s - Number(boltDepth)) < 1e-9);
          }
          const base = `${direction}-${boltType}-${boltDepth}-${mode}`;
          await fs.writeFile(path.join(out, `${base}.svg`), svg);
          const file = path.join(out, `${base}.png`);
          await sharp(Buffer.from(svg)).png().toFile(file);
          const metadata = await sharp(file).metadata();
          const stats = await sharp(file).stats();
          assert.equal(metadata.width, direction === "horizontal" ? 1000 : 750);
          assert.ok(metadata.height > 500);
          assert.ok(
            stats.channels.slice(0, 3).some((channel) => channel.stdev > 10),
          );
          results.push({
            file: `${base}.png`,
            effective: r.effective,
            required: r.required,
            selected: r.selected,
            boltDepth: r.geometry.boltDepth,
          });
        }
      }
  await fs.writeFile(
    path.join(out, "results.json"),
    JSON.stringify(results, null, 2),
  );
  assert.equal(results.length, 24);
});
