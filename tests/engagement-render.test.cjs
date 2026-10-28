const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");
const { JSDOM } = require("jsdom");
const calc = require("../js/calculator.js");
const drawing = require("../js/drawing.js");
const data = require("../data/defaults.json");
const out = path.join(__dirname, "engagement-output");
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 0.03, `${actual} != ${expected}`);

test("10 mmかかり・ナット全厚を満たす先端を横縦・画面SVG・印刷・書出しで描く", async () => {
  await fs.mkdir(out, { recursive: true });
  for (const type of ["single", "double"])
    for (const direction of ["horizontal", "vertical"])
      for (const [kind, options] of [
        ["screen", { compact: true, interactive: true }],
        ["export", {}],
        ["print", { compact: true, print: true }],
      ]) {
        const m = Object.assign(calc.createModel(data), {
          boltType: type,
          mode: "direct",
          direction,
          effective: type === "single" ? "131" : "181",
        });
        const r = calc.calculate(m, data);
        assert.equal(r.ok, true);
        const svg = drawing.render(r, data, options);
        const dom = new JSDOM(svg, { contentType: "image/svg+xml" });
        try {
          const doc = dom.window.document;
          const attr = (selector, key) =>
            Number(doc.querySelector(selector).getAttribute(key));
          const scale = attr('[data-row="washer-right"]', "width") / 4.5;
          const nutStart = attr('[data-row="nut-right"]', "x");
          close(attr('[data-row="nut-right"]', "width"), 10 * scale);
          close(attr('[data-row="bore-right"]', "width"), 10 * scale);
          let tip;
          if (type === "single") {
            const outline = doc
              .querySelector('[data-row="head"]')
              .getAttribute("d");
            const points = [...outline.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)];
            tip = Math.max(...points.map((point) => Number(point[1])));
          } else {
            const start = attr('rect[data-row="bolt"]', "x");
            tip = start + attr('rect[data-row="bolt"]', "width");
            const leftStart = attr('[data-row="nut-left"]', "x");
            close(start - leftStart, 0);
            close(leftStart + 10 * scale - start, 10 * scale);
          }
          close(tip - nutStart, 10 * scale);
          close(nutStart + 10 * scale - tip, 0);
          const text = doc.documentElement.textContent.replace(/\s+/g, "");
          assert.ok(text.includes("かかり量10"));
          assert.ok(text.includes("ナット外0"));
          assert.equal(svg.includes("data-edit="), kind === "screen");
          const file = `${type}-${direction}-${kind}`;
          await fs.writeFile(path.join(out, file + ".svg"), svg);
          await sharp(Buffer.from(svg))
            .png()
            .toFile(path.join(out, file + ".png"));
          if (direction === "horizontal" && kind === "screen") {
            // 先端とナット穴の関係を目視確認できる拡大画像も残す。
            const detail = svg
              .replace(
                /viewBox="[^"]+"/,
                `viewBox="${nutStart - 20} 220 65 60"`,
              )
              .replace(
                '<rect width="100%" height="100%" fill="white"/>',
                `<rect x="${nutStart - 20}" y="220" width="65" height="60" fill="white"/>`,
              );
            await sharp(Buffer.from(detail))
              .resize({ width: 650 })
              .png()
              .toFile(path.join(out, `${type}-nut-detail.png`));
          }
        } finally {
          dom.window.close();
        }
      }
});

test("図のかかり量はナット内とナット外の合計。10+3.5を13.5と表示", async () => {
  for (const direction of ["horizontal", "vertical"])
    for (const [kind, options] of [
      ["screen", { compact: true, interactive: true }],
      ["export", {}],
      ["print", { compact: true, print: true }],
    ]) {
      const m = Object.assign(calc.createModel(data), {
        boltType: "double",
        mode: "direct",
        effective: "264",
        direction,
      });
      const r = calc.calculate(m, data);
      assert.equal(r.ok, true);
      assert.equal(r.projection.left, 13.5);
      assert.equal(r.engagement.left, 10);
      assert.equal(r.protrusion.left, 3.5);
      const svg = drawing.render(r, data, options);
      const dom = new JSDOM(svg, { contentType: "image/svg+xml" });
      try {
        const text = [...dom.window.document.querySelectorAll("text")]
          .map((el) => el.textContent.replace(/\s+/g, ""))
          .join(" ");
        assert.equal((text.match(/かかり量13\.5/g) || []).length, 2);
        assert.ok(text.includes("ナット外3.5"));
        assert.ok(!text.includes("かかり量10"));
        await fs.mkdir(out, { recursive: true });
        const file = `projection-13.5-${direction}-${kind}`;
        await fs.writeFile(path.join(out, file + ".svg"), svg);
        await sharp(Buffer.from(svg))
          .png()
          .toFile(path.join(out, file + ".png"));
      } finally {
        dom.window.close();
      }
    }
});
