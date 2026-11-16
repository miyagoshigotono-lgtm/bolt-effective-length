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

test("外形未設定の平座金はボルトの下に隠れず、破線の仮表示として残る", async () => {
  const m=Object.assign(calc.createModel(data),{boltType:'single',column:'120',clearance:'150',rightSeat:'recess'});
  const flat=data.parts.find(part=>part.id==='flat');
  for(const side of ['left','right'])m.washers[side]={partId:flat.id,axial:flat.axial,outer:flat.outer};
  for(const direction of ['horizontal','vertical']){
    m.direction=direction;
    const r=calc.calculate(m,data),before=JSON.stringify(r);
    assert.equal(r.ok,true);assert.equal(r.effective,214);assert.equal(r.selected,240);
    for(const options of [{compact:true,interactive:true,workspace:true},{},{compact:true,print:true}]){
      const svg=drawing.render(r,data,options),dom=new JSDOM(svg,{contentType:'image/svg+xml'});
      try{
        const doc=dom.window.document,bore=doc.querySelector('[data-row="bore-right"]');
        for(const side of ['left','right']){
          const plate=doc.querySelector(`[data-row="washer-${side}"]`);
          assert.equal(r.washers[side].outer,null);
          assert.equal(plate.getAttribute('stroke-dasharray'),'3 2');
          assert.ok(Number(plate.getAttribute('height'))>Number(bore.getAttribute('height')),'座金の仮外形がボルト径より大きい');
        }
        const {data:pixels,info}=await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({resolveWithObject:true});
        let gold=0;
        for(let i=0;i<pixels.length;i+=info.channels)if(pixels[i]===255 && pixels[i+1]===225 && pixels[i+2]===161)gold++;
        assert.ok(gold>0,'描画後も座金の色がボルトの外側に見える');
        assert.equal(JSON.stringify(r),before);
      }finally{dom.window.close();}
    }
  }
});

test("外ツラの2部材・接面・座彫り28と長さは、片引き・両引き・タテ・ヨコ・全出力で一致",async()=>{
  await fs.mkdir(out,{recursive:true});
  for(const boltType of ['single','double'])for(const direction of ['horizontal','vertical']){
    const m=Object.assign(calc.createModel(data),{mode:'outside',boltType,direction,leftSeat:'recess',rightSeat:'recess',member1Height:'180',member2Height:'210'});
    const r=calc.calculate(m,data),before=JSON.stringify(r);
    assert.equal(r.ok,true);
    for(const options of [{compact:true,interactive:true,workspace:true},{},{compact:true,print:true}]){
      const svg=drawing.render(r,data,options),dom=new JSDOM(svg,{contentType:'image/svg+xml'});
      try{
        const doc=dom.window.document,member1=doc.querySelector('[data-row="member-1"]'),member2=doc.querySelector('[data-row="member-2"]');
        const w1=Number(member1.getAttribute('width')),w2=Number(member2.getAttribute('width')),scale=w1/180;
        assert.ok(Math.abs(w2/210-scale)<0.0001);
        assert.ok(Math.abs(Number(member1.getAttribute('x'))+w1-Number(member2.getAttribute('x')))<0.002);
        assert.equal(doc.querySelectorAll('[data-member-break]').length,4);
        assert.equal(doc.querySelector('[data-edit="leftSeat"]'),null);assert.equal(doc.querySelector('[data-edit="rightSeat"]'),null);
        for(const side of ['left','right']){
          const hole=doc.querySelector(`[data-row="${side}-seat"]`);
          assert.equal(hole.dataset.seat,'recess');assert.ok(Math.abs(Number(hole.getAttribute('width'))/scale-28)<0.001);
          assert.ok(doc.querySelector(`[data-row="washer-${side}"]`));
        }
        assert.ok(doc.querySelector('[data-row="bolt"]'));
        assert.equal(doc.documentElement.dataset.effective,'334');assert.equal(doc.documentElement.hasAttribute('data-bolt-depth'),false);
        assert.match(doc.documentElement.textContent,/外ツラ～外ツラ 390/);
        assert.match(doc.documentElement.textContent,/部材長さ方向は省略/);
        assert.equal(doc.querySelector('[data-row="depth"]'),null);
        for(const text of [...doc.querySelectorAll('text')].filter(el=>/梁の側面|柱どうし/.test(el.textContent)))assert.equal(text.closest('[transform]'),null);
        assert.ok(!/NaN|Infinity|undefined/.test(svg));assert.equal(JSON.stringify(r),before);
        if(options.workspace && boltType==='single')await sharp(Buffer.from(svg)).png().toFile(path.join(out,`outside-${direction}.png`));
      }finally{dom.window.close();}
    }
  }
});

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

test("座彫り側だけ柱・梁側面の輪郭を上下に延ばし、片引き・両引き・全出力で一致", () => {
  for (const direction of ["horizontal", "vertical"])
    for (const boltType of ["single", "double"])
      for (const mode of ["joint", "direct"])
        for (const leftSeat of ["recess", "box"])
          for (const rightSeat of ["recess", "box"])
            for (const options of [
              { compact: true, interactive: true },
              {},
              { compact: true, print: true },
            ]) {
              const m = Object.assign(calc.createModel(data), {
                direction, boltType, mode, leftSeat, rightSeat, leftBoxPosition: "70",
              });
              const r = calc.calculate(m, data);
              assert.equal(r.ok, true);
              const before = JSON.stringify(r);
              const svg = drawing.render(r, data, options);
              const dom = new JSDOM(svg, { contentType: "image/svg+xml" });
              try {
                const doc = dom.window.document;
                assert.equal(Number(doc.documentElement.dataset.effective), r.effective);
                for (const side of ["left", "right"]) {
                  const seat = m[side + "Seat"];
                  const hole = doc.querySelector(`[data-row="${side}-seat"]`);
                  assert.equal(hole.dataset.seat, seat);
                  const continuation = doc.querySelector(`[data-member-continuation="${side}"]`);
                  if (seat === "box") {
                    assert.equal(continuation, null);
                    assert.equal(hole.getAttribute("width"), hole.getAttribute("height"));
                    continue;
                  }
                  assert.ok(continuation);
                  assert.ok(continuation.querySelectorAll("line").length >= 4);
                  const lines = [...continuation.querySelectorAll("line")];
                  assert.ok(lines.every((line) => line.getAttribute("x1") === line.getAttribute("x2")));
                  assert.ok(lines.every((line) => !line.hasAttribute("stroke-dasharray")));
                  assert.ok(lines.some((line) => Number(line.getAttribute("y2")) - Number(line.getAttribute("y1")) >= 55));
                }
                assert.equal(JSON.stringify(r), before);
              } finally {
                dom.window.close();
              }
            }
});

test("未確定の入力図でも最新の穴形状を使い、未知の位置や有効長を確定値に見せない", () => {
  for (const direction of ["horizontal", "vertical"])
    for (const boltType of ["single", "double"]) {
      const baseline = Object.assign(calc.createModel(data), { direction, boltType });
      const r = calc.calculate(baseline, data);
      const current = { ...baseline, leftSeat: "box", leftBoxPosition: "" };
      const before = JSON.stringify({ r, current });
      const svg = drawing.render(r, data, {
        compact: true, interactive: true, preview: true, geometryPending: true,
        sourceModel: current,
      });
      const dom = new JSDOM(svg, { contentType: "image/svg+xml" });
      try {
        const doc = dom.window.document;
        const hole = doc.querySelector('[data-row="left-seat"]');
        assert.equal(hole.dataset.seat, "box");
        assert.equal(hole.dataset.positionKnown, "false");
        assert.equal(hole.getAttribute("width"), hole.getAttribute("height"));
        assert.ok(hole.hasAttribute("stroke-dasharray"));
        assert.ok(doc.documentElement.textContent.includes("有効長 E 未確定"));
        assert.equal(doc.documentElement.dataset.effective, "");
        assert.equal(doc.querySelector('[data-member-continuation="left"]'), null);
        assert.equal(JSON.stringify({ r, current }), before);
        assert.ok(!/NaN|Infinity/.test(svg));
      } finally {
        dom.window.close();
      }
    }
});
