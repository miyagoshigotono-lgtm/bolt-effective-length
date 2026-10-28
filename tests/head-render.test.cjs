const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");
const { JSDOM } = require("jsdom");
const calc = require("../js/calculator.js");
const drawing = require("../js/drawing.js");
const data = require("../data/defaults.json");
const out = path.join(__dirname, "head-output");

test("片引きは頭と軸を一つの輪郭で描き、頭の座面と左座金が接する", async () => {
  await fs.mkdir(out, { recursive: true });
  for (const direction of ["horizontal", "vertical"])
    for (const mode of ["joint", "direct"])
      for (const leftSeat of ["recess", "box"])
        for (const rightSeat of ["box", "recess"]) {
          const m = calc.createModel(data);
          Object.assign(m, {
            boltType: "single",
            direction,
            mode,
            leftSeat,
            rightSeat,
            leftBoxPosition: "70",
          });
          const r = calc.calculate(m, data);
          assert.equal(r.ok, true);
          assert.equal(r.nuts, 1);
          assert.equal(r.geometry.boltEnd - r.geometry.boltStart, r.selected);
          assert.ok(!r.breakdown.some((row) => row.label === "左のナット"));
          for (const [kind, options] of [
            ["screen", { compact: true, interactive: true }],
            ["export", {}],
            ["print", { compact: true, print: true }],
          ]) {
            const svg = drawing.render(r, data, options);
            const dom = new JSDOM(svg, { contentType: "image/svg+xml" });
            const doc = dom.window.document;
            const head = doc.querySelector('[data-integrated-head="true"]');
            assert.ok(head);
            assert.equal(
              doc.querySelectorAll('[data-integrated-head="true"]').length,
              1,
            );
            assert.equal(
              head.getAttribute("data-head-dimensions"),
              "unconfirmed",
            );
            assert.equal(head.querySelectorAll('[data-row="head"]').length, 1);
            const outline = head
              .querySelector('[data-row="head"]')
              .getAttribute("d");
            assert.equal((outline.match(/\bM\b/g) || []).length, 1);
            assert.ok(outline.endsWith("Z"));
            assert.equal(
              doc.querySelectorAll('rect[data-row="bolt"]').length,
              0,
            );
            assert.equal(
              doc.querySelectorAll('[data-row="nut-left"]').length,
              0,
            );
            assert.equal(
              doc.querySelectorAll('[data-row="nut-right"]').length,
              1,
            );
            assert.equal(
              Number(head.getAttribute("data-head-seat-x")),
              Number(
                doc.querySelector('[data-row="washer-left"]').getAttribute("x"),
              ),
            );
            assert.ok(svg.includes("ナット一体の頭"));
            dom.window.close();
            if (
              mode === "joint" &&
              leftSeat === "recess" &&
              rightSeat === "box"
            ) {
              const file = `${direction}-${kind}`;
              await fs.writeFile(path.join(out, file + ".svg"), svg);
              await sharp(Buffer.from(svg))
                .png()
                .toFile(path.join(out, file + ".png"));
              if (direction === "horizontal" && kind === "screen") {
                const seatX = Number(head.getAttribute("data-head-seat-x"));
                const detail = svg
                  .replace(
                    /viewBox="[^"]+"/,
                    `viewBox="${seatX - 45} 210 125 80"`,
                  )
                  .replace(
                    '<rect width="100%" height="100%" fill="white"/>',
                    `<rect x="${seatX - 45}" y="210" width="125" height="80" fill="white"/>`,
                  );
                await sharp(Buffer.from(detail))
                  .resize({ width: 625 })
                  .png()
                  .toFile(path.join(out, "head-detail.png"));
              }
            }
          }
        }
});

test("両引きは左右2個のナットのまま、未計算の修正図には一体頭を表示しない", () => {
  const m = calc.createModel(data);
  m.boltType = "double";
  const r = calc.calculate(m, data);
  assert.equal(r.required, 306);
  assert.equal(r.selected, 315);
  for (const options of [
    {},
    { compact: true, interactive: true },
    { compact: true, print: true },
  ]) {
    const svg = drawing.render(r, data, options);
    const dom = new JSDOM(svg, { contentType: "image/svg+xml" });
    assert.equal(
      dom.window.document.querySelectorAll("[data-integrated-head]").length,
      0,
    );
    assert.equal(
      dom.window.document.querySelectorAll('[data-row^="nut-"]').length,
      2,
    );
    dom.window.close();
  }
  m.boltType = "single";
  const single = calc.calculate(m, data);
  assert.equal(single.effective, 277);
  assert.equal(single.required, 296);
  assert.equal(single.selected, 300);
  assert.equal(single.geometry.boltStart, 23.5);
  assert.ok(
    !drawing
      .render(single, data, { compact: true, interactive: true, preview: true })
      .includes("data-integrated-head"),
  );
});
