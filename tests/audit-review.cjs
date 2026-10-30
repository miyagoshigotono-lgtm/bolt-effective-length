const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const data = require("../data/defaults.json");
const calc = require("../js/calculator.js");
const drawing = require("../js/drawing.js");
const root = path.resolve(__dirname, "..");
const output = path.join(__dirname, "review-output");

function custom() {
  const model = calc.createModel(data);
  model.boltType = "single";
  model.presetId = "custom";
  model.rule.kind = "custom";
  model.rule.confirmed = true;
  model.rule.name = "監査用ルール";
  return model;
}

async function run() {
  fs.mkdirSync(output, { recursive: true });
  const report = [];
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      offline: true,
    });
    const page = await context.newPage();
    await page.goto(pathToFileURL(path.join(root, "bolt.html")).href);
    await page
      .locator("#selection-status")
      .filter({ hasText: "種別を選択" })
      .waitFor();
    async function load(model) {
      const document = calc.exportDocument(model, data);
      await page
        .locator("#import-file")
        .setInputFiles({
          name: "review.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(document)),
        });
      await page.waitForFunction(
        (name) => window.BoltApp.getModel().name === name,
        model.name,
      );
    }
    async function textBoxes() {
      return page.locator("#drawing svg text").evaluateAll((elements) =>
        elements.map((element) => {
          const b = element.getBBox();
          return {
            text: element.textContent,
            x: b.x,
            y: b.y,
            width: b.width,
            height: b.height,
          };
        }),
      );
    }

    let model = custom();
    model.name = "保存操作の監査";
    await load(model);
    await page.locator("#save").click();
    await page.locator("#save").click();
    report.push({
      case: "保存を2回押した場合",
      items: await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("bolt-effective-length.saved.v1"))
            .items.length,
      ),
    });
    await page.locator("#effective").fill("");
    report.push({
      case: "未完の入力を保存できるか",
      saveDisabled: await page.locator("#save").isDisabled(),
      exportDisabled: await page.locator("#export").isDisabled(),
    });

    model = custom();
    model.name = "プリセット切替の監査";
    await load(model);
    await page.locator("#note").fill("未保存の編集内容");
    await page.locator("#preset").selectOption("sample2_left_example");
    report.push({
      case: "プリセット切替時の編集保持",
      noteAfter: await page.locator("#note").inputValue(),
    });

    model = custom();
    model.name = "金物操作の監査";
    model.rule.endOperation = "parts";
    model.hardware = [
      {
        partId: "flat",
        side: "right",
        count: "1",
        axial: "4.5",
        include: true,
      },
    ];
    await load(model);
    const select = page.locator('[data-part="0"][data-key="partId"]');
    await select.focus();
    await select.selectOption("nut");
    report.push({
      case: "金物選択後のキーボードフォーカス",
      activeTag: await page.evaluate(() => document.activeElement.tagName),
    });
    await page.locator("#confirmed").check();
    await page.locator('[data-part="0"][data-key="count"]').fill("2");
    report.push({
      case: "個数変更の即時計算",
      calculated: (await page.evaluate(() => window.BoltApp.getResult())).ok,
      ruleApplied: await page.locator("#confirmed").isChecked(),
    });

    model = custom();
    model.name = "候補有効長の監査";
    model.effective = "5";
    model.rule.offset = "200";
    model.candidate = "110";
    const negative = calc.calculate(model, data);
    report.push({
      case: "候補長より端部構成長が大きい場合",
      status: negative.status,
      available: negative.candidateEffective,
    });

    model = custom();
    model.name = "金物の表示範囲の監査";
    model.hardware = [
      {
        partId: "flat",
        side: "right",
        count: "1",
        axial: "450",
        include: false,
      },
    ];
    await load(model);
    const outside = await page
      .locator("#drawing svg rect")
      .evaluateAll((elements) =>
        elements
          .filter((element) => element.getAttribute("fill") === "#dae5eb")
          .map((element) => {
            const b = element.getBBox();
            return { x: b.x, right: b.x + b.width };
          }),
      );
    report.push({
      case: "加算対象外の大きい金物",
      viewBoxRight: 960,
      rectangles: outside,
    });
    await page.screenshot({
      path: path.join(output, "hardware-outside.png"),
      fullPage: true,
    });

    model = custom();
    model.name = "多数部材の監査";
    model.mode = "members";
    model.members = Array.from({ length: 40 }, (_, i) => ({
      name: `部材${i + 1}`,
      axis: "width",
      width: "1",
      height: "240",
      recessLeft: "0",
      recessRight: "0",
    }));
    await load(model);
    const labels = (await textBoxes()).filter((box) => /^\d+ ·/.test(box.text));
    const collisions = [];
    for (let i = 0; i < labels.length; i++)
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i],
          b = labels[j];
        if (
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height
        )
          collisions.push([a.text, b.text]);
      }
    report.push({
      case: "40部材の寸法ラベル",
      overlaps: collisions.length,
      examples: collisions.slice(0, 3),
    });
    await page.screenshot({
      path: path.join(output, "member-labels.png"),
      fullPage: true,
    });

    model = custom();
    model.name = "スマートフォン拡大の監査";
    await load(model);
    await page.setViewportSize({ width: 390, height: 844 });
    const before = await page.locator("#drawing svg").boundingBox();
    await page.locator("#zoom-in").click();
    const after = await page.locator("#drawing svg").boundingBox();
    report.push({
      case: "390px幅で100%から125%への拡大",
      label: await page.locator("#zoom-label").textContent(),
      beforeWidth: before.width,
      afterWidth: after.width,
    });

    model = custom();
    const exported = drawing.render(calc.calculate(model, data), data);
    report.push({
      case: "SVG単体の測定定義・ルール名",
      containsRuleName: exported.includes(model.rule.name),
      containsStartDefinition: exported.includes(
        model.rule.definitions.effectiveStart,
      ),
    });

    const old = calc.exportDocument(model, data);
    old.catalogVersion = "unknown-old-version";
    report.push({
      case: "カタログ版違いのJSON",
      acceptedWithoutWarning: Boolean(calc.importDocument(old, data)),
    });
    await page.evaluate(() =>
      localStorage.setItem(
        "bolt-effective-length.saved.v1",
        JSON.stringify({ version: 1, items: [null] }),
      ),
    );
    await page.locator("#open-saved").click();
    report.push({
      case: "保存項目が一部壊れている場合",
      dialogOpen: await page
        .locator("#saved-dialog")
        .evaluate((element) => element.open),
      message: await page.locator("#notice").textContent(),
    });

    fs.writeFileSync(
      path.join(output, "findings.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
