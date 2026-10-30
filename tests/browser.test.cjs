const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright");
const calc = require("../js/calculator.js"),
  drawing = require("../js/drawing.js");
const data = require("../data/defaults.json");
const root = path.resolve(__dirname, "..");
const out = path.join(__dirname, "domain-output");
const url = pathToFileURL(path.join(root, "bolt.html")).href;
const savedKey = "bolt-effective-length.saved.v1",
  workspaceKey = "bolt-effective-length.workspace.v1";
function model(type = "double", effective = null) {
  const m = calc.createModel(data);
  m.boltType = type;
  if (effective != null) {
    m.mode = "direct";
    m.effective = String(effective);
  }
  return m;
}
async function importModel(page, m) {
  await page.locator("#import-file").setInputFiles({
    name: "test.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(calc.exportDocument(m, data, true))),
  });
  await page.waitForFunction(
    (m) => JSON.stringify(BoltApp.getModel()) === JSON.stringify(m),
    m,
  );
}
async function bounds(page, selector = "#drawing svg") {
  return page.locator(selector).evaluate((svg) => {
    const v = svg.viewBox.baseVal,
      inv = svg.getScreenCTM().inverse();
    const boxes = [
      ...svg.querySelectorAll(
        "text,rect:not(defs rect),line,path:not(defs path)",
      ),
    ]
      .filter((el) => !el.closest("defs"))
      .map((el) => {
        const b = el.getBBox(),
          matrix = inv.multiply(el.getScreenCTM());
        const points = [
          [b.x, b.y],
          [b.x + b.width, b.y],
          [b.x, b.y + b.height],
          [b.x + b.width, b.y + b.height],
        ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
        const x = Math.min(...points.map((p) => p.x)),
          y = Math.min(...points.map((p) => p.y));
        return {
          tag: el.tagName,
          text: el.textContent.slice(0, 80),
          b: {
            x,
            y,
            width: Math.max(...points.map((p) => p.x)) - x,
            height: Math.max(...points.map((p) => p.y)) - y,
          },
        };
      })
      .filter((el) => el.b.width || el.b.height);
    const outside = boxes.filter(
      ({ b }) =>
        b.x < -1 ||
        b.y < -1 ||
        b.x + b.width > v.width + 1 ||
        b.y + b.height > v.height + 1,
    );
    const texts = boxes.filter((x) => x.tag === "text"),
      overlaps = [];
    for (let i = 0; i < texts.length; i++)
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i].b,
          b = texts[j].b;
        if (
          Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) + 1 &&
          Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y) + 1
        )
          overlaps.push([texts[i].text, texts[j].text]);
      }
    return {
      outside: outside.map((x) => ({ tag: x.tag, text: x.text })),
      overlaps,
    };
  });
}
async function checkBounds(page, label, selector) {
  const r = await bounds(page, selector);
  assert.deepEqual(r, { outside: [], overlaps: [] }, label);
}
async function pdf(page, file, expectedPages = 1) {
  const target = path.join(out, file);
  await page.pdf({
    path: target,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
  });
  const info = spawnSync("pdfinfo", [target], { encoding: "utf8" });
  assert.equal(info.status, 0);
  const pages = Number(info.stdout.match(/Pages:\s+(\d+)/)[1]);
  assert.equal(pages, expectedPages, file);
  return pages;
}
async function run(channel = "chrome", common = false) {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel });
  const context = await browser.newContext({
    offline: true,
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage(),
    errors = [],
    external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) external.push(r.url());
  });
  try {
    await page.goto(url);
    assert.equal(await page.locator("#print").isDisabled(), true);
    assert.equal(await page.locator("#preset").count(), 0);
    await page.locator("[name=boltType][value=double]").check();
    assert.equal(await page.locator("#result-effective").textContent(), "277");
    assert.equal(await page.locator("#result-required").textContent(), "306");
    assert.equal(await page.locator("#result-selected").textContent(), "315");
    assert.equal(await page.locator("#boltDepth").inputValue(), "52");
    await page.locator("#dimension-details > summary").click();
    await page.locator("#file-details > summary").click();
    assert.equal(await page.locator("#warnings").textContent(), "");
    await page.evaluate(() => {
      window.scrollTo(0, 200);
      window.dispatchEvent(new Event("beforeprint"));
    });
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await page.evaluate(() => window.scrollTo(0, 0));
    await checkBounds(page, "初期横図");
    await page.emulateMedia({ media: "print" });
    await checkBounds(page, "横の印刷図", "#print-drawing svg");
    await page.emulateMedia({ media: null });
    await page.screenshot({
      path: path.join(out, channel + "-desktop.png"),
      fullPage: true,
    });
    await pdf(page, channel + "-print.pdf");
    await page.locator("#direction").selectOption("vertical");
    await checkBounds(page, "縦図");
    await page
      .locator("#drawing-viewport")
      .screenshot({ path: path.join(out, channel + "-vertical.png") });
    await page.emulateMedia({ media: "print" });
    await checkBounds(page, "縦の印刷図", "#print-drawing svg");
    await page.emulateMedia({ media: null });
    await pdf(page, channel + "-vertical.pdf", 2);
    await page.locator("#direction").selectOption("horizontal");
    for (const left of ["box", "recess"])
      for (const right of ["box", "recess"]) {
        const m = model();
        m.leftSeat = left;
        m.rightSeat = right;
        m.leftBoxPosition = "70";
        m.boltDepth = "52";
        await importModel(page, m);
        await checkBounds(page, left + "-" + right);
      }
    const asymmetric = model();
    asymmetric.washers.left = { partId: "spring", axial: "10.5", outer: "39" };
    asymmetric.washers.right = {
      partId: "tight",
      axial: "20.5",
      outer: "46.5",
    };
    asymmetric.boltDepth = "52";
    await importModel(page, asymmetric);
    await checkBounds(page, "左右異種座金");
    assert.equal(await page.locator("#result-required").textContent(), "328");
    for (const [type, e, state] of [
      ["single", 277, "fit"],
      ["single", 450.9, "over"],
      ["double", 600, "none"],
    ]) {
      const m = model(type, e);
      m.boltDepth = "52";
      await importModel(page, m);
      assert.equal(
        (await page.evaluate(() => BoltApp.getResult())).status,
        state,
      );
      await checkBounds(page, state);
      if (["short", "none"].includes(state)) {
        assert.equal(await page.locator("#print").isDisabled(), true);
        await page.locator("#output-confirmed").check();
      } else {
        assert.equal(await page.locator("#print").isDisabled(), false);
        assert.equal(
          await page.locator("#output-confirmation").isHidden(),
          true,
        );
      }
      await pdf(page, channel + "-" + state + ".pdf");
    }
    const short = model();
    short.candidate = "210";
    await importModel(page, short);
    await checkBounds(page, "短い候補");
    assert.match(
      await page.locator("#result-available").textContent(),
      /未到達/,
    );
    await page.locator("#output-confirmed").check();
    await pdf(page, channel + "-short.pdf");
    await page.locator("#clearance").fill("201");
    assert.equal(await page.locator("#output-confirmed").isChecked(), false);
    await importModel(page, model());
    const original = await page.evaluate(() => BoltApp.getModel());
    const dp = page.waitForEvent("download");
    await page.locator("#export").click();
    const download = await dp,
      file = path.join(out, channel + "-roundtrip.json");
    await download.saveAs(file);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).model, original);
    const sp = page.waitForEvent("download");
    await page.locator("#download-svg").click();
    const s = await sp,
      svgFile = path.join(out, channel + "-section.svg");
    await s.saveAs(svgFile);
    const svg = fs.readFileSync(svgFile, "utf8");
    assert.equal(svg, drawing.render(calc.calculate(original, data), data));
    await page.locator("#clearance").fill("205");
    await page.locator("#import-file").setInputFiles(file);
    await page.waitForFunction(() => BoltApp.getResult().effective === 277);
    await page.locator("#undo").click();
    assert.equal(await page.locator("#clearance").inputValue(), "205");
    await page.locator("#redo").click();
    assert.equal(await page.locator("#clearance").inputValue(), "200");
    const beforeZoom = await page.locator("#drawing svg").boundingBox();
    await page.locator("#zoom-in").click();
    const afterZoom = await page.locator("#drawing svg").boundingBox();
    assert.ok(Math.abs(afterZoom.width / beforeZoom.width - 1.25) < 0.01);
    await page.locator("#zoom-reset").click();
    await page.locator("#washer-left").focus();
    assert.ok(
      await page
        .locator('#drawing [data-row="washer-left"].focused-row')
        .count(),
    );
    await page.locator("#clearance").fill("201");
    await page.locator("[name=mode][value=direct]").check();
    assert.equal(await page.locator("#effective").inputValue(), "278");
    await page.locator("[name=mode][value=joint]").check();
    await page.locator("#clearance").fill("200");
    for (const m of [
      model("double", 1),
      model("double", 10000),
      Object.assign(model(), {
        beamWidth: "1000",
        beamHeight: "1000",
        column: "1000",
      }),
    ]) {
      await importModel(page, m);
      await checkBounds(page, "極端な寸法");
    }
    const large = model();
    large.washers.left = { partId: "custom", axial: "50", outer: "1000" };
    large.name = "長い名称".repeat(40);
    large.note = "長いメモ".repeat(200);
    await importModel(page, large);
    await checkBounds(page, "大きい座金");
    const full = drawing.render(calc.calculate(large, data), data);
    await page.evaluate((svg) => {
      const div = document.createElement("div");
      div.id = "export-check";
      div.innerHTML = svg;
      document.body.appendChild(div);
    }, full);
    await checkBounds(page, "長い名称の書出しSVG", "#export-check svg");
    await page.evaluate(() => document.getElementById("export-check").remove());
    await importModel(page, model());
    await page.locator("#clearance").fill("");
    assert.equal(await page.locator("#result-selected").textContent(), "--");
    await page.locator("#errors button").click();
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "clearance",
    );
    await page.locator("#clearance").fill("200.01");
    assert.equal(
      await page.locator("#clearance").getAttribute("aria-invalid"),
      "true",
    );
    await page.locator("#clearance").fill("200.1");
    await page.locator("#note").fill("検証用メモ");
    await page.reload();
    assert.equal(await page.locator("#clearance").inputValue(), "200.1");
    assert.equal(await page.locator("#note").inputValue(), "検証用メモ");
    await page.locator("#clearance").focus();
    assert.deepEqual(
      await page
        .locator("#clearance")
        .evaluate((el) => [el.selectionStart, el.selectionEnd]),
      [0, 5],
    );
    for (const w of [320, 390, 700, 950, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
        "横はみ出し " + w,
      );
      await checkBounds(page, "幅" + w);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(out, channel + "-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (common) {
      await page.locator("#save").click();
      await page.locator("#save").click();
      assert.equal(
        await page.evaluate(
          (k) => JSON.parse(localStorage.getItem(k)).items.length,
          savedKey,
        ),
        1,
      );
      await page.locator("#save-as").click();
      assert.equal(
        await page.evaluate(
          (k) => JSON.parse(localStorage.getItem(k)).items.length,
          savedKey,
        ),
        2,
      );
      await page.locator("#clearance").fill("");
      await page.locator("#save").click();
      await page.reload();
      assert.equal(await page.locator("#clearance").inputValue(), "");
      const dp = page.waitForEvent("download");
      await page.locator("#export").click();
      const dl = await dp;
      const f = path.join(out, channel + "-draft.json");
      await dl.saveAs(f);
      assert.equal(JSON.parse(fs.readFileSync(f, "utf8")).state, "draft");
      await page.locator("#open-saved").click();
      await page.locator(".saved-item button[title=削除]").first().click();
      await page.locator("#undo-delete").click();
      assert.equal(
        await page.evaluate(
          (k) => JSON.parse(localStorage.getItem(k)).items.length,
          savedKey,
        ),
        2,
      );
      await page.locator("#close-saved").click();
      const before = await page.evaluate(() => BoltApp.getModel());
      await page.locator("#import-file").setInputFiles({
        name: "bad.json",
        mimeType: "application/json",
        buffer: Buffer.from('{"format":"bolt-effective-length","version":1}'),
      });
      await page.waitForFunction(() =>
        document
          .getElementById("notice-message")
          .textContent.includes("読み込めません"),
      );
      assert.deepEqual(await page.evaluate(() => BoltApp.getModel()), before);
      await importModel(page, model());
      await page.locator("#save").click();
      await page.evaluate((k) => {
        const v = JSON.parse(localStorage.getItem(k));
        v.items.push(null);
        localStorage.setItem(k, JSON.stringify(v));
      }, savedKey);
      await page.locator("#open-saved").click();
      assert.equal(
        await page.locator(".saved-item button[title=開く]:enabled").count(),
        3,
      );
      assert.equal(
        await page.locator(".saved-item button[title=開く]:disabled").count(),
        1,
      );
      await page.locator("#close-saved").click();
      await page.evaluate(
        (k) => localStorage.setItem(k, "broken registry"),
        savedKey,
      );
      await page.locator("#open-saved").click();
      await page.getByRole("button", { name: "退避して一覧を再作成" }).click();
      assert.equal(
        await page.evaluate(
          (k) => JSON.parse(localStorage.getItem(k)).items.length,
          savedKey,
        ),
        0,
      );
      assert.ok(
        await page.evaluate(
          (k) =>
            Object.keys(localStorage).some((key) =>
              key.startsWith(k + ".recovery."),
            ),
          savedKey,
        ),
      );
      await page.locator("#close-saved").click();
      await page.evaluate(
        (k) =>
          localStorage.setItem(
            k,
            JSON.stringify({
              version: 1,
              current: { model: { name: "旧入力", rule: { offset: "30" } } },
            }),
          ),
        workspaceKey,
      );
      await page.reload();
      assert.equal(await page.locator("#name").inputValue(), "ボルト接合");
      assert.ok(
        await page.evaluate(
          (k) =>
            Object.keys(localStorage).some((key) =>
              key.startsWith(k + ".recovery."),
            ),
          workspaceKey,
        ),
      );
      const quota = await context.newPage();
      await quota.addInitScript(() => {
        Storage.prototype.setItem = function () {
          throw new DOMException("full", "QuotaExceededError");
        };
      });
      await quota.goto(url);
      await quota.locator("[name=boltType][value=double]").check();
      assert.match(
        await quota.locator("#session-status").textContent(),
        /自動保存できません/,
      );
      const qd = quota.waitForEvent("download");
      await quota.locator("#export").click();
      await (await qd).saveAs(path.join(out, channel + "-quota.json"));
      await quota.close({ runBeforeUnload: false });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    const summary = {
      channel,
      common,
      errors,
      external,
      catalogCounts: [29, 18],
      domainChecks: "passed",
      checkedAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(out, channel + (common ? "-common" : "") + "-result.json"),
      JSON.stringify(summary, null, 2),
    );
    return summary;
  } finally {
    await context.close();
    await browser.close();
  }
}
if (require.main === module)
  run()
    .then(console.log)
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
module.exports = { run, bounds, importModel };
