(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BoltDrawing = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const esc = (v) =>
    String(v).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[c],
    );
  const num = (v) => Math.round(v * 1000) / 1000;
  const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  function split(value, width, size) {
    const rows = [];
    let line = "",
      length = 0;
    const tokens =
      String(value).match(/[A-Za-z0-9._-]+|[^\x00-\x7f]|[\s\S]/gu) || [];
    for (const token of tokens) {
      const measure = (str) =>
        [...str].reduce(
          (n, c) => n + (/[\x00-\x7f]/.test(c) ? size * 0.62 : size),
          0,
        );
      // 数値と単位は途中で切らない。欄より長い名称だけ文字単位で折り返す。
      const pieces = measure(token) > width ? [...token] : [token];
      for (const c of pieces) {
        const advance = measure(c);
        if (c === "\n" || (length + advance > width && line)) {
          rows.push(line.trimEnd());
          line = "";
          length = 0;
          if (c === "\n") continue;
        }
        if (!line && c === " ") continue;
        line += c;
        length += advance;
      }
    }
    if (line) rows.push(line);
    return rows;
  }
  function render(r, data, options = {}) {
    if (!r.ok) throw new Error("未計算です。");
    options = {
      ...options,
      interactive: options.interactive && !options.print,
    };
    const current = options.sourceModel || r.input,
      m = options.preview
        ? { ...r.input, leftSeat: current.leftSeat, rightSeat: current.rightSeat }
        : r.input,
      g = { ...r.geometry },
      d = data.dimensions;
    let leftPositionPending = false;
    if (options.preview) {
      const recessWidth = /^\d+(?:\.\d)?$/.test(String(current.recessWidth))
        ? Number(current.recessWidth)
        : 0;
      g.recessWidth =
        recessWidth > 0 && recessWidth <= g.width
          ? recessWidth
          : g.recessWidth || Math.min(60, g.width);
      if (g.column != null) {
        if (m.leftSeat === "box") {
          const position = /^\d+(?:\.\d)?$/.test(String(current.leftBoxPosition))
            ? Number(current.leftBoxPosition)
            : 0;
          leftPositionPending = position < d.box || position >= g.column;
          // 未入力の穴は位置未確定の記号として中央に置く。入力や計算には使わない。
          g.start = leftPositionPending ? (d.box + g.column) / 2 : position;
        } else g.start = d.recess;
        g.end =
          g.column + g.clearance - (m.rightSeat === "recess" ? d.recess : 0);
      }
    }
    const vertical = current.direction === "vertical",
      width = vertical ? 750 : 1000;
    const id = options.print
      ? "woodHatch-print"
      : options.compact
        ? "woodHatch-screen"
        : "woodHatch-export";
    const chart = [],
      detail = [];
    const min = Math.min(
      g.start - (m.leftSeat === "box" ? 78 : 28),
      g.boltStart - 10,
      g.column == null ? Infinity : 0,
    );
    const max = Math.max(g.end + (m.rightSeat === "box" ? 78 : 28), g.boltEnd);
    const scale = Math.min(
      760 / (max - min),
      170 /
        Math.max(
          g.width,
          g.column ?? 0,
          r.washers.left.outer ?? 12,
          r.washers.right.outer ?? 12,
          21.9,
        ),
    );
    const origin = 120 + (760 - (max - min) * scale) / 2;
    const X = (x) => origin + (x - min) * scale,
      axis = 250;
    function endSummary(side) {
      if (r.selected == null) return "かかり量 未選定 / ナット外 未選定";
      return (
        "かかり量 " +
        (r.projection[side] == null ? "未到達" : fmt(r.projection[side])) +
        " / ナット外 " +
        fmt(r.protrusion[side])
      );
    }
    function endLines(side) {
      return options.print ? endSummary(side).split(" / ") : [endSummary(side)];
    }
    function text(
      list,
      x,
      y,
      value,
      maxWidth = 850,
      size = 15,
      color = "#334b45",
      anchor = "start",
      edit = "",
    ) {
      if (options.print) size = Math.round(size * 1.25);
      if (options.workspace) size = Math.max(size, vertical ? 28 : 22);
      const lines = split(value, maxWidth, size);
      const interactive = options.interactive && edit;
      if (interactive) {
        const tw = Math.max(
          70,
          ...lines.map((line) =>
            [...line].reduce(
              (n, c) => n + (/[^\x00-\x7f]/.test(c) ? size : size * 0.62),
              0,
            ),
          ),
        );
        const left = anchor === "middle" ? x - tw / 2 : x;
        list.push(
          `<g class="diagram-target" role="button" tabindex="0" data-edit="${esc(edit)}" aria-label="${esc(value)}を変更"><title>${esc(value)}を変更</title><rect class="edit-hit" x="${num(left - 10)}" y="${num(y - size - 10)}" width="${num(tw + 20)}" height="${num(Math.max(48, lines.length * size * 1.5 + 14))}" rx="3" fill="transparent"/>`,
        );
      }
      list.push(
        `<text x="${num(x)}" y="${num(y)}" fill="${color}" font-size="${size}" text-anchor="${anchor}">${lines.map((line, i) => `<tspan x="${num(x)}" dy="${i ? size * 1.5 : 0}">${esc(line)}</tspan>`).join("")}</text>`,
      );
      if (interactive) list.push("</g>");
      return interactive
        ? Math.max(56, lines.length * size * 1.5 + 24)
        : Math.max(1, lines.length) * size * 1.5 + 4;
    }
    function line(x1, y1, x2, y2, color = "#566d66", dash = "") {
      chart.push(
        `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" stroke="${color}" stroke-width="1.2"${dash ? ' stroke-dasharray="' + dash + '"' : ""}/>`,
      );
    }
    function rect(x, y, w, h, fill, row = "", stroke = "#516e62", dash = "") {
      const edit = row.endsWith("-seat")
        ? row.split("-")[0] + "Seat"
        : row.startsWith("washer-")
          ? row
          : "";
      if (options.interactive && edit)
        chart.push(
          `<g class="diagram-target" role="button" tabindex="0" data-edit="${edit}" aria-label="${edit.endsWith("Seat") ? (edit.startsWith("left") ? "左" : "右") + "の穴" : (edit.endsWith("left") ? "左" : "右") + "の座金"}を変更"><title>種類を変更</title>`,
        );
      chart.push(
        `<rect x="${num(X(x))}" y="${num(axis + y * scale)}" width="${num(w * scale)}" height="${num(h * scale)}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${row ? ' data-row="' + row + '"' : ""}${edit.endsWith("Seat") ? ` data-seat="${m[edit]}" data-position-known="${row !== "left-seat" || !leftPositionPending}"` : ""}${dash ? ' stroke-dasharray="' + dash + '"' : ""}/>`,
      );
      if (options.interactive && edit) chart.push("</g>");
    }
    function dim(a, b, y, label, color = "#476b5e", edit = "") {
      line(X(a), axis, X(a), y + 8, color, "3 4");
      line(X(b), axis, X(b), y + 8, color, "3 4");
      line(X(a), y, X(b), y, color);
      for (const x of [X(a), X(b)]) line(x - 4, y + 4, x + 4, y - 4, color);
      text(
        chart,
        (X(a) + X(b)) / 2,
        y - 10,
        label,
        460,
        options.interactive ? 20 : 16,
        color,
        "middle",
        edit,
      );
    }
    // 平面の軸断面。木部・穴・金物は同じ縮尺で配置する。
    const woodStart = m.leftSeat === "box" ? g.start - 78 : g.start - 28;
    // 箱穴の先は材が続くため、短い省略区間と破断線を置く。材の全長ではない。
    const woodEnd = g.end + (m.rightSeat === "box" ? 78 : 28);
    if (g.column != null) {
      const leftWidth = m.leftSeat === "recess" ? g.column : g.width;
      rect(0, -leftWidth / 2, g.column, leftWidth, "url(#" + id + ")", "wood");
      rect(
        g.column,
        -g.width / 2,
        woodEnd - g.column,
        g.width,
        "url(#" + id + ")",
        "wood",
      );
      dim(
        0,
        g.column,
        150,
        m.leftSeat === "recess"
          ? "柱 " + fmt(g.column) + "角"
          : "梁側 " + fmt(g.column),
        "#476b5e",
        "column",
      );
      dim(
        g.column,
        m.rightSeat === "box" ? g.end : woodEnd,
        420,
        (m.leftSeat === "recess" ? "柱から " : "基準から ") + fmt(g.clearance),
        "#476b5e",
        "clearance",
      );
      if (options.interactive && !options.workspace && current.leftSeat === "box")
        dim(
          0,
          g.start,
          460,
          "左穴まで " + (current.leftBoxPosition || "未入力"),
          "#476b5e",
          "leftBoxPosition",
        );
    } else
      rect(
        woodStart,
        -g.width / 2,
        woodEnd - woodStart,
        g.width,
        "url(#" + id + ")",
        "wood",
      );
    // 座彫り側は柱の側面・梁の平面として、木部の輪郭を上下へ延ばす。
    for (const side of ["left", "right"]) {
      if (m[side + "Seat"] !== "recess") continue;
      const left =
          side === "left"
            ? (g.column == null ? woodStart : 0)
            : Math.max(woodStart, woodEnd - g.width),
        right =
          side === "left"
            ? g.column ?? Math.min(woodEnd, woodStart + g.width)
            : woodEnd,
        memberWidth = side === "left" && g.column != null ? g.column : g.width,
        top = axis - (memberWidth * scale) / 2,
        bottom = axis + (memberWidth * scale) / 2,
        extendedTop = axis - (Math.max(memberWidth, g.width) * scale) / 2 - 55,
        extendedBottom = axis + (Math.max(memberWidth, g.width) * scale) / 2 + 55;
      chart.push(
        `<g data-member-continuation="${side}" data-member-view="column-or-beam-side">`,
      );
      for (const edge of [left, right]) {
        line(X(edge), extendedTop, X(edge), top);
        line(X(edge), bottom, X(edge), extendedBottom);
      }
      if (side === "right" || g.column == null) {
        const interfaceX = X(side === "left" ? right : left);
        line(interfaceX, top, interfaceX, bottom);
      }
      chart.push("</g>");
    }
    if (m.rightSeat === "box") {
      const x = X(woodEnd),
        top = axis - (g.width * scale) / 2,
        bottom = axis + (g.width * scale) / 2;
      line(x, top, x, bottom, "white");
      chart.push(
        `<path d="M ${num(x)} ${num(top)} l -4 ${num((bottom - top) / 4)} l 8 ${num((bottom - top) / 2)} l -4 ${num((bottom - top) / 4)}" fill="none" stroke="#516e62" stroke-width="1.5"/>`,
      );
    }
    for (const side of ["left", "right"]) {
      const seat = m[side + "Seat"],
        face = side === "left" ? g.start : g.end;
      const span = seat === "box" ? 58 : 28,
        opening = seat === "box" ? 58 : g.recessWidth;
      rect(
        side === "left" ? face - span : face,
        -opening / 2,
        span,
        opening,
        "#ffffff",
        side + "-seat",
        "#516e62",
        side === "left" && leftPositionPending ? "4 4" : "",
      );
      dim(
        side === "left" ? face - span : face,
        side === "left" ? face : face + span,
        380,
        fmt(span),
      );
      if (options.preview) continue;
      const p = r.washers[side],
        outer = p.outer ?? 12;
      const wx = side === "left" ? face - p.axial : face;
      const stepped = p.partId === "spring" || p.partId === "tight";
      const baseX = stepped && side === "left" ? face - 4.5 : wx;
      rect(
        baseX,
        -outer / 2,
        stepped ? 4.5 : p.axial,
        outer,
        "#ffe1a1",
        "washer-" + side,
        "#866020",
        p.outer == null ? "3 2" : "",
      );
      if (p.partId === "spring" || p.partId === "tight") {
        const base = 4.5,
          inner = p.partId === "spring" ? 25 : 38;
        const innerX = side === "left" ? wx : wx + base;
        rect(
          innerX,
          -inner / 2,
          p.axial - base,
          inner,
          "#e8c576",
          "washer-" + side,
          "#866020",
        );
      }
      if (side === "right" || m.boltType === "double") {
        const nutX = side === "left" ? face - p.axial - 10 : face + p.axial;
        rect(nutX, -10.95, 10, 21.9, "#d4dce2", "nut-" + side, "#596b7d");
        // 軸断面のねじ穴を空け、ナットの途中で止まるボルト先端を見えるようにする。
        rect(nutX, -6, 10, 12, "#ffffff", "bore-" + side, "none");
        for (const dy of [-6, 6])
          line(
            X(nutX),
            axis + dy * scale,
            X(nutX + 10),
            axis + dy * scale,
            "#596b7d",
            "2 2",
          );
      }
      line(
        X(face),
        axis - (g.width * scale) / 2 - 6,
        X(face),
        axis + (g.width * scale) / 2 + 6,
        "#087f76",
        "2 3",
      );
    }
    if (!options.preview && m.boltType === "single") {
      // 一体の頭と軸を一つの輪郭で描く。頭の比率は形状表示用で、実寸ではない。
      const seat = X(g.boltStart),
        tip = X(g.boltEnd),
        shaftHalf = 6 * scale,
        headWidth = shaftHalf * 1.5,
        headHalf = shaftHalf * 1.8,
        bevel = shaftHalf * 0.35,
        back = seat - headWidth;
      chart.push(`<g data-row="bolt" data-integrated-head="true" data-head-dimensions="unconfirmed" data-head-seat-x="${num(seat)}" data-head-back-x="${num(back)}">
        <title>ナット形の頭がボルトと一体（頭の寸法は未設定）</title>
        <path data-row="head" d="M ${num(seat)} ${num(axis - headHalf)} L ${num(back + bevel)} ${num(axis - headHalf)} L ${num(back)} ${num(axis - headHalf + bevel)} L ${num(back)} ${num(axis + headHalf - bevel)} L ${num(back + bevel)} ${num(axis + headHalf)} L ${num(seat)} ${num(axis + headHalf)} L ${num(seat)} ${num(axis + shaftHalf)} L ${num(tip)} ${num(axis + shaftHalf)} L ${num(tip)} ${num(axis - shaftHalf)} L ${num(seat)} ${num(axis - shaftHalf)} Z" fill="#b9c6cf" stroke="#536577" stroke-width="1.5"/>
        <path d="M ${num(back + bevel)} ${num(axis - headHalf * 0.65)} H ${num(seat)} M ${num(back + bevel)} ${num(axis + headHalf * 0.65)} H ${num(seat)}" fill="none" stroke="#738491" stroke-width="0.8"/>
      </g>`);
    } else if (!options.preview && g.boltEnd > g.boltStart)
      rect(
        g.boltStart,
        -6,
        g.boltEnd - g.boltStart,
        12,
        "#b9c6cf",
        "bolt",
        "#536577",
      );
    line(X(min) - 12, axis, X(max) + 12, axis, "#738c90", "7 5");
    dim(
      g.start,
      g.end,
      105,
      "有効長 E " +
        (options.geometryPending || leftPositionPending
          ? "未確定"
          : fmt(options.preview ? g.end - g.start : r.effective)),
      "#087f76",
      current.mode === "direct" ? "effective" : "",
    );
    if (!options.preview)
      dim(
        g.boltStart,
        g.boltEnd,
        70,
        (r.selected == null ? "必要長 " : "ボルト L ") +
          fmt(r.selected ?? r.required),
        "#b23a46",
      );
    text(
      chart,
      500,
      24,
      "平面・ボルト軸の断面 / 単位 mm",
      850,
      16,
      "#334b45",
      "middle",
    );
    if (!options.interactive)
      text(
        chart,
        110,
        460,
        "桁の幅 " +
          fmt(g.width) +
          (m.boltType === "single"
            ? " / 一体の頭は形状表示（寸法未設定）"
            : ""),
        800,
        15,
      );
    const startY = vertical ? 1020 : 505;
    let heights = [];
    const cols = options.workspace ? [] : options.interactive
      ? [
          {
            title: "左",
            lines: [
              {
                value:
                  current.leftSeat === "box" ? "ボックス穴 58角" : "座彫り 28",
                edit: "leftSeat",
              },
              {
                value: data.parts.find(
                  (p) => p.id === current.washers.left.partId,
                ).name,
                edit: "washer-left",
              },
              ...(!options.preview && current.boltType === "single"
                ? ["ナット一体の頭"]
                : []),
              ...(!options.preview && current.boltType === "double"
                ? [endSummary("left")]
                : []),
            ],
          },
          {
            title: "木部",
            lines: [
              { value: "桁の幅 " + fmt(g.width), edit: "beamWidth" },
              { value: "ボルト深さ " + fmt(g.boltDepth), edit: "boltDepth" },
            ],
          },
          {
            title: "右",
            lines: [
              {
                value:
                  current.rightSeat === "box" ? "ボックス穴 58角" : "座彫り 28",
                edit: "rightSeat",
              },
              {
                value: data.parts.find(
                  (p) => p.id === current.washers.right.partId,
                ).name,
                edit: "washer-right",
              },
              ...(!options.preview ? [endSummary("right")] : []),
            ],
          },
        ]
      : [
          {
            title: "左の金物",
            lines: [
              r.washers.left.name + " " + fmt(r.washers.left.axial),
              m.boltType === "double"
                ? "ナット 10"
                : "ナット一体の頭（厚さは長さに含めない）",
              ...(m.boltType === "double" ? endLines("left") : []),
              "穴：" +
                (m.leftSeat === "box"
                  ? "58 × 58"
                  : "28 / 幅 " + fmt(g.recessWidth)),
            ],
          },
          {
            title: "締め付ける木部",
            lines: [
              "有効長 " + fmt(r.effective),
              r.effectiveEquation,
              "ボルト径 12",
              "ボルト深さ " + fmt(g.boltDepth) + "（外ツラ〜芯）",
            ],
          },
          {
            title: "右の金物",
            lines: [
              r.washers.right.name + " " + fmt(r.washers.right.axial),
              "ナット 10",
              ...endLines("right"),
              "穴：" +
                (m.rightSeat === "box"
                  ? "58 × 58"
                  : "28 / 幅 " + fmt(g.recessWidth)),
            ],
          },
        ];
    cols.forEach((col, i) => {
      const x = 30 + (i * (width - 60)) / 3,
        cw = (width - 60) / 3 - 18;
      let y = startY;
      y +=
        text(detail, x, y, col.title, cw, 17, "#087f76") +
        (options.interactive ? 12 : 0);
      for (const value of col.lines.filter(Boolean))
        y +=
          typeof value === "object"
            ? text(
                detail,
                x,
                y,
                value.value,
                cw,
                20,
                "#087f76",
                "start",
                value.edit,
              )
            : text(detail, x, y, value, cw, 15);
      heights.push(y);
    });
    let bottom = options.workspace ? (vertical ? 1010 : 485) : Math.max(...heights) + 12;
    if (options.print && !vertical) {
      detail.length = 0;
      let y = 505;
      for (const value of [
        "左：" +
          r.washers.left.name +
          " " +
          fmt(r.washers.left.axial) +
          (m.boltType === "double"
            ? " / ナット10 / " + endSummary("left")
            : " / ナット一体の頭"),
        "右：" +
          r.washers.right.name +
          " " +
          fmt(r.washers.right.axial) +
          " / ナット10 / " +
          endSummary("right"),
        "ボルト深さ " +
          fmt(g.boltDepth) +
          "（外ツラ〜芯） / 材料の高さ " +
          fmt(g.height),
      ])
        y += text(detail, 110, y, value, 800, 16);
      bottom = y + 5;
    }
    if (!options.print && !options.interactive) {
      const x = 40,
        y = bottom + 40,
        s = Math.min(1.1, 140 / g.height, 110 / g.width),
        right = x + g.width * s,
        axisY = y + g.boltDepth * s,
        dimX = right + 14;
      text(detail, x, bottom + 10, "ボルト深さ・位置図", 240, 16, "#087f76");
      // 穴の底は描かず、材料の外ツラとボルト芯の位置だけを示す。
      detail.push(`<g data-row="depth" data-depth-scale="${s}" data-depth-face-y="${y}" data-bolt-axis-y="${axisY}">
        <rect x="${x}" y="${num(y)}" width="${num(g.width * s)}" height="${num(g.height * s)}" fill="url(#${id})" stroke="#516e62"/>
        <line x1="${x}" x2="${num(dimX + 4)}" y1="${num(y)}" y2="${num(y)}" stroke="#087f76" data-depth-face="outer"/>
        <line x1="${x - 5}" x2="${num(dimX + 4)}" y1="${num(axisY)}" y2="${num(axisY)}" stroke="#b23a46" stroke-dasharray="5 3" data-depth-axis="bolt"/>
        <line x1="${num(dimX)}" x2="${num(dimX)}" y1="${num(y)}" y2="${num(axisY)}" stroke="#087f76"/>
        <path d="M ${num(dimX - 3)} ${num(y + 3)} l 6 -6 M ${num(dimX - 3)} ${num(axisY + 3)} l 6 -6" fill="none" stroke="#087f76"/>
      </g>`);
      let ty = y + 15;
      for (const value of [
        "外ツラからボルト芯まで " + fmt(g.boltDepth),
        "材料の幅 " + fmt(g.width) + " × 高さ " + fmt(g.height),
      ])
        ty += text(detail, 195, ty, value, width - 225, 15);
      bottom = Math.max(y + g.height * s, ty) + 25;
    }
    if (!options.compact) {
      bottom += 15;
      bottom += text(detail, 30, bottom, "名称：" + m.name, width - 60, 18);
      if (m.note)
        bottom += text(detail, 30, bottom, "メモ：" + m.note, width - 60, 15);
      for (const warning of r.warnings)
        bottom += text(detail, 30, bottom, warning, width - 60, 15, "#87600a");
      bottom += text(
        detail,
        30,
        bottom,
        r.catalog.product + " / 版 " + r.catalog.version,
        width - 60,
        15,
      );
    }
    const transform = vertical
      ? ' transform="translate(600, 10) rotate(90)"'
      : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${num(bottom + 20)}" role="${options.interactive ? "group" : "img"}" aria-label="穴と木部とボルトの寸法図"
      data-effective="${options.preview ? "" : r.effective}" data-selected="${options.preview ? "" : (r.selected ?? "")}" data-required="${options.preview ? "" : r.required}" data-bolt-depth="${g.boltDepth}"${options.preview ? ' data-preview="true"' : ""}>
      <title>${options.preview ? "未計算の入力図" : esc(m.name) + " / E " + fmt(r.effective) + " / L " + (r.selected ?? "該当なし")}</title>
      <metadata>${esc(JSON.stringify(options.preview ? { specVersion: data.specVersion, model: current, state: "preview" } : { specVersion: data.specVersion, model: m, result: r }))}</metadata>
      <defs><pattern id="${id}" width="9" height="9" patternUnits="userSpaceOnUse"><rect width="9" height="9" fill="#f1f7f3"/><path d="M-2 9 L9-2 M7 11 L11 7" stroke="#ccd9ca" stroke-width="0.8"/></pattern></defs>
      <rect width="100%" height="100%" fill="white"/>
      <g font-family="Meiryo, Yu Gothic UI, sans-serif"><g${transform}>${chart.join("")}</g>${detail.join("")}</g>
    </svg>`;
  }
  return { render, escape: esc };
});
