const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");
const { JSDOM } = require("jsdom");
const calc = require("../js/calculator.js");
const drawing = require("../js/drawing.js");
const data = require("../data/defaults.json");
const out = path.join(__dirname, "diagram-output");

test("32通りの入力図で編集対象と寸法が一致し、数値のタップ領域が図外へ出ない", async () => {
  await fs.mkdir(out, { recursive: true });
  for (const direction of ["horizontal", "vertical"])
    for (const boltType of ["single", "double"])
      for (const mode of ["joint", "direct"])
        for (const leftSeat of ["box", "recess"])
          for (const rightSeat of ["box", "recess"]) {
            const m = calc.createModel(data);
            Object.assign(m, {
              direction,
              boltType,
              mode,
              leftSeat,
              rightSeat,
              leftBoxPosition: "70",
            });
            const r = calc.calculate(m, data);
            assert.equal(r.ok, true);
            const svg = drawing.render(r, data, {
              compact: true,
              interactive: true,
              sourceModel: m,
            });
            const dom = new JSDOM(svg, { contentType: "image/svg+xml" });
            const doc = dom.window.document;
            const root = doc.documentElement;
            const [, , width, height] = root
              .getAttribute("viewBox")
              .split(" ")
              .map(Number);
            assert.equal(
              Number(root.getAttribute("data-effective")),
              r.effective,
            );
            for (const key of [
              "leftSeat",
              "rightSeat",
              "washer-left",
              "washer-right",
              "boltDepth",
            ])
              assert.ok(doc.querySelector(`[data-edit="${key}"]`), key);
            assert.ok(
              doc.querySelector(
                `[data-edit="${mode === "joint" ? "column" : "effective"}"]`,
              ),
            );
            for (const rect of doc.querySelectorAll(".edit-hit")) {
              const x = Number(rect.getAttribute("x")),
                y = Number(rect.getAttribute("y")),
                rw = Number(rect.getAttribute("width")),
                rh = Number(rect.getAttribute("height"));
              const corners = [
                [x, y],
                [x + rw, y + rh],
              ];
              for (let [px, py] of corners) {
                if (rect.closest("[transform]")) [px, py] = [600 - py, 10 + px];
                assert.ok(
                  px >= -0.1 &&
                    px <= width + 0.1 &&
                    py >= -0.1 &&
                    py <= height + 0.1,
                  `${direction}/${mode}/${px},${py}`,
                );
              }
            }
            dom.window.close();
            if (
              mode === "joint" &&
              leftSeat === "recess" &&
              rightSeat === "box"
            ) {
              const base = `${direction}-${boltType}`;
              const styled = svg.replace(
                "</defs>",
                "</defs><style>.edit-hit{stroke:#8bbeb8;stroke-dasharray:3 3;stroke-width:0.8}.diagram-target text{text-decoration:underline}</style>",
              );
              await fs.writeFile(path.join(out, base + ".svg"), styled);
              await sharp(Buffer.from(styled))
                .png()
                .toFile(path.join(out, base + ".png"));
              const stats = await sharp(path.join(out, base + ".png")).stats();
              assert.ok(stats.channels[0].stdev > 10);
            }
          }
});
