(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BoltCalc = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  class InputError extends Error {
    constructor(field, message) {
      super(message);
      this.field = field;
    }
  }
  function fail(field, message) {
    throw new InputError(field, message);
  }
  function units(value, field, allowZero = false) {
    const str = String(value ?? "").trim();
    if (!/^\d+(?:\.\d)?$/.test(str))
      fail(
        field,
        "0.1 mm単位で入力してください。空欄や小数第2位は使えません。",
      );
    const [whole, decimal = "0"] = str.split(".");
    const n = Number(whole) * 10 + Number(decimal);
    if (!Number.isSafeInteger(n) || n < 0 || (!allowZero && n === 0))
      fail(
        field,
        allowZero
          ? "0以上の数値を入力してください。"
          : "0より大きい数値を入力してください。",
      );
    // 描画も含めて扱える寸法に限定する。
    if (n > 100000) fail(field, "寸法は10,000 mm以下で入力してください。");
    return n;
  }
  function format(n) {
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }
  const clone = (v) => JSON.parse(JSON.stringify(v));
  function createModel(data) {
    const p = data.parts.find((p) => p.id === "square");
    return {
      specVersion: data.specVersion,
      name: "ボルト接合",
      boltType: "",
      mode: "joint",
      direction: "horizontal",
      effective: "277",
      candidate: "auto",
      column: "105",
      beamWidth: "105",
      beamHeight: "105",
      clearance: "200",
      leftBoxPosition: "",
      boltDepth: "52",
      recessWidth: "60",
      leftSeat: "recess",
      rightSeat: "box",
      leftProjection: String(data.selectionRules.minimumProjection),
      rightProjection: String(data.selectionRules.minimumProjection),
      washers: {
        left: { partId: p.id, axial: p.axial, outer: p.outer },
        right: { partId: p.id, axial: p.axial, outer: p.outer },
      },
      note: "",
    };
  }
  function validateShape(m, data, draft = false) {
    if (!m || typeof m !== "object" || Array.isArray(m))
      fail("model", "入力条件の形式が不正です。");
    if (m.specVersion !== data.specVersion)
      fail(
        "model",
        "旧計算のデータは自動で読み替えません。元のJSONを残し、新しい条件で入力してください。",
      );
    for (const [k, max] of [
      ["name", 200],
      ["note", 2000],
    ]) {
      if (
        typeof m[k] !== "string" ||
        m[k].length > max ||
        (!draft && k === "name" && !m[k].trim())
      )
        fail(
          k,
          k === "name"
            ? "名称を1〜200文字で入力してください。"
            : "メモは2,000文字以内で入力してください。",
        );
    }
    for (const [k, values] of [
      ["boltType", ["", "single", "double"]],
      ["mode", ["joint", "direct"]],
      ["direction", ["horizontal", "vertical"]],
      ["leftSeat", ["box", "recess"]],
      ["rightSeat", ["box", "recess"]],
    ])
      if (!values.includes(m[k])) fail(k, "選択内容が不正です。");
    for (const k of [
      "effective",
      "column",
      "beamWidth",
      "beamHeight",
      "clearance",
      "leftBoxPosition",
      "boltDepth",
      "recessWidth",
      "leftProjection",
      "rightProjection",
    ]) {
      if (
        !["string", "number"].includes(typeof m[k]) ||
        String(m[k]).length > 50
      )
        fail(k, "寸法の形式が不正です。");
    }
    if (
      m.candidate !== "auto" &&
      !data.catalogs[m.boltType]?.lengths.includes(Number(m.candidate))
    )
      fail("candidate", "このボルトのカタログにない長さです。");
    for (const side of ["left", "right"]) {
      const p = m.washers?.[side];
      if (!p || !data.parts.some((d) => d.id === p.partId))
        fail("washer-" + side, "座金の種類が不正です。");
      for (const k of ["axial", "outer"])
        if (
          !["string", "number"].includes(typeof p[k]) ||
          String(p[k]).length > 50
        )
          fail("washer-" + side + "-" + k, "座金寸法の形式が不正です。");
      const part = data.parts.find((d) => d.id === p.partId);
      if (
        part.id !== "custom" &&
        (String(p.axial) !== part.axial ||
          (part.outer && String(p.outer) !== part.outer))
      )
        fail(
          "washer-" + side,
          "資料の座金寸法と異なります。変更する場合は「その他の座金」を選んでください。",
        );
    }
  }
  function calculate(m, data) {
    try {
      validateShape(m, data);
      if (!m.boltType) fail("boltType", "片引き・両引きを選んでください。");
      const d = data.dimensions,
        breakdown = [],
        warnings = [];
      const row = (group, label, n) =>
        breakdown.push({ group, label, value: n / 10 });
      const column = m.mode === "joint" ? units(m.column, "column") : null;
      const width = units(m.beamWidth, "beamWidth"),
        height = units(m.beamHeight, "beamHeight");
      const recessWidth =
        m.leftSeat === "recess" || m.rightSeat === "recess"
          ? units(m.recessWidth, "recessWidth")
          : null;
      const hasBox = m.leftSeat === "box" || m.rightSeat === "box";
      const boltDepth = units(m.boltDepth, "boltDepth");
      if (hasBox && width < d.box * 10)
        fail("beamWidth", "桁の幅はボックス穴58 mm以上にしてください。");
      if (recessWidth != null && recessWidth > width)
        fail("recessWidth", "座彫りの幅が桁の幅を超えています。");
      if (boltDepth >= height)
        fail("boltDepth", "ボルト深さは材料の高さより小さくしてください。");
      let start,
        end,
        effective,
        clearance = null;
      if (m.mode === "direct") {
        effective = units(m.effective, "effective");
        start = 0;
        end = effective;
        row("effective", "入力した有効長", effective);
      } else {
        clearance = units(m.clearance, "clearance", true);
        start =
          m.leftSeat === "recess"
            ? d.recess * 10
            : units(m.leftBoxPosition, "leftBoxPosition");
        if (start >= column)
          fail(
            m.leftSeat === "recess" ? "column" : "leftBoxPosition",
            "左の穴の内側は柱の右面より手前にしてください。",
          );
        if (m.leftSeat === "box" && start < d.box * 10)
          fail(
            "leftBoxPosition",
            "左の穴の内側までの距離は、穴幅58 mm以上にしてください。",
          );
        end =
          column + clearance - (m.rightSeat === "recess" ? d.recess * 10 : 0);
        effective = end - start;
        row("effective", "柱の幅", column);
        row(
          "effective",
          m.leftSeat === "recess" ? "左の座彫り" : "左端〜左の穴の内側",
          -start,
        );
        row(
          "effective",
          m.rightSeat === "box"
            ? "柱の右面〜右の穴の内側"
            : "柱の右面〜桁の右端",
          clearance,
        );
        if (m.rightSeat === "recess")
          row("effective", "右の座彫り", -d.recess * 10);
        if (end <= column)
          fail(
            "clearance",
            "右の穴の内側が柱にかかっています。柱からの距離を増やしてください。",
          );
      }
      if (effective <= 0)
        fail(
          "effective",
          "有効長が0以下になっています。穴の位置を確認してください。",
        );
      const washer = {};
      for (const side of ["left", "right"]) {
        const p = m.washers[side],
          part = data.parts.find((d) => d.id === p.partId);
        const axial = units(p.axial, "washer-" + side + "-axial");
        const outer =
          p.outer === "" ? null : units(p.outer, "washer-" + side + "-outer");
        if (outer != null && outer < d.boltDiameter * 10)
          fail(
            "washer-" + side + "-outer",
            "座金の外形はボルト径12 mm以上にしてください。",
          );
        if (outer == null)
          warnings.push(
            (side === "left" ? "左" : "右") +
              "の座金の外形は未設定です。図の外形は実寸ではありません。",
          );
        const available = m[side + "Seat"] === "box" ? d.box * 10 : recessWidth;
        if (outer != null && outer > available)
          warnings.push(
            (side === "left" ? "左" : "右") + "の座金が穴の幅を超えています。",
          );
        washer[side] = {
          partId: p.partId,
          name: part.name,
          axial: axial / 10,
          outer: outer == null ? null : outer / 10,
        };
        row("end", (side === "left" ? "左" : "右") + "の" + part.name, axial);
      }
      function projectionMinimum(side) {
        const n = units(m[side + "Projection"], side + "Projection");
        if (n < data.selectionRules.minimumProjection * 10)
          fail(side + "Projection", "かかり量は10 mm以上で入力してください。");
        return n;
      }
      const leftT = m.boltType === "double" ? projectionMinimum("left") : 0,
        rightT = projectionMinimum("right");
      const nuts = m.boltType === "double" ? 2 : 1;
      if (leftT) row("end", "左の最低かかり量", leftT);
      row("end", "右の最低かかり量", rightT);
      const core =
        units(washer.left.axial, "washer-left-axial") +
        effective +
        units(washer.right.axial, "washer-right-axial");
      const required = core + leftT + rightT,
        catalog = data.catalogs[m.boltType];
      const proposal = catalog.lengths.find((n) => n * 10 >= required) ?? null;
      const selected = m.candidate === "auto" ? proposal : Number(m.candidate);
      const excess = selected == null ? null : selected * 10 - required;
      let actualLeft = null,
        actualRight = null;
      // 座金の外面から測り、指定以上の出を確保して余りを左右へ均等に配分する。
      if (selected != null) {
        const total = selected * 10 - core;
        actualLeft = leftT;
        if (nuts === 2 && excess >= 0) {
          actualLeft = Math.max(
            leftT,
            Math.min(total - rightT, Math.floor(total / 2)),
          );
        }
        actualRight = total - actualLeft;
      }
      let status = selected == null ? "none" : excess < 0 ? "short" : "fit";
      if (status === "short")
        warnings.push(
          format(-excess / 10) +
            " mm不足しています。木部を短く読み替えていません。",
        );
      const engagement = (value) =>
        value == null ? null : Math.min(d.nut * 10, Math.max(0, value)) / 10;
      const protrusion = (value) =>
        value == null ? null : Math.max(0, value - d.nut * 10) / 10;
      const engaged = {
        left: nuts === 2 ? engagement(actualLeft) : 0,
        right: engagement(actualRight),
      };
      const protruding = {
        left: nuts === 2 ? protrusion(actualLeft) : 0,
        right: protrusion(actualRight),
      };
      if (
        protruding.left > data.selectionRules.maximumProtrusion ||
        protruding.right > data.selectionRules.maximumProtrusion
      ) {
        if (status === "fit") status = "over";
        if (m.candidate === "auto")
          warnings.push(
            "条件内のカタログ候補がありません。有効長は変更していません。",
          );
        warnings.push(
          "ナットからの飛び出しが10 mmを超えています。有効長とボルトの長さを確認してください。",
        );
      }
      const e0 = start / 10,
        e1 = end / 10;
      const leftWasherFace = e0 - washer.left.axial,
        rightWasherFace = e1 + washer.right.axial;
      const leftOuter = leftWasherFace - (nuts === 2 ? d.nut : 0);
      const rightOuter = rightWasherFace + d.nut;
      const boltStart =
        nuts === 2
          ? leftWasherFace - (actualLeft == null ? leftT / 10 : actualLeft / 10)
          : leftWasherFace;
      const boltEnd =
        selected == null ? rightWasherFace + rightT / 10 : boltStart + selected;
      for (const side of ["left", "right"]) {
        const protrusion = side === "left" ? e0 - boltStart : boltEnd - e1;
        const capacity = m[side + "Seat"] === "box" ? d.box : d.recess;
        if (protrusion > capacity)
          warnings.push(
            (side === "left" ? "左" : "右") +
              "のボルト先端が穴の長さを超えています。",
          );
      }
      const definitions = {
        effectiveStart:
          "左の" + (m.leftSeat === "box" ? "ボックス穴" : "座彫り") + "の内側",
        effectiveEnd:
          "右の" + (m.rightSeat === "box" ? "ボックス穴" : "座彫り") + "の内側",
        bolt:
          m.boltType === "single"
            ? "頭の座面から先端まで（頭の厚さは含まない）"
            : "ボルトの先端から先端まで",
      };
      return {
        ok: true,
        effective: effective / 10,
        endLength: (required - effective) / 10,
        required: required / 10,
        coreLength: core / 10,
        proposal,
        selected,
        excess: excess == null ? null : excess / 10,
        status,
        catalog: clone(catalog),
        definitions,
        projection: {
          left: actualLeft == null ? null : actualLeft / 10,
          right:
            actualRight == null || actualRight < 0 ? null : actualRight / 10,
          rightShortfall:
            actualRight != null ? Math.max(0, rightT - actualRight) / 10 : 0,
          requestedLeft: leftT / 10,
          requestedRight: rightT / 10,
        },
        engagement: engaged,
        protrusion: protruding,
        washers: washer,
        nuts,
        warnings,
        breakdown,
        input: clone(m),
        precision: 0.1,
        geometry: {
          start: e0,
          end: e1,
          column: column == null ? null : column / 10,
          clearance: clearance == null ? null : clearance / 10,
          width: width / 10,
          height: height / 10,
          recessWidth: recessWidth == null ? null : recessWidth / 10,
          boltDepth: boltDepth / 10,
          boltStart,
          boltEnd,
          leftOuter,
          rightOuter,
          leftWasherFace,
          rightWasherFace,
        },
        effectiveEquation:
          m.mode === "direct"
            ? "E = " + format(effective / 10)
            : "E = " +
              format(column / 10) +
              " − " +
              format(start / 10) +
              " + " +
              format(clearance / 10) +
              (m.rightSeat === "recess" ? " − 28" : "") +
              " = " +
              format(effective / 10),
        boltEquation:
          nuts === 2
            ? "左の最低かかり量 + 左座金 + 有効長 + 右座金 + 右の最低かかり量"
            : "左座金 + 有効長 + 右座金 + 右の最低かかり量",
      };
    } catch (error) {
      return {
        ok: false,
        errors: [
          {
            field: error.field || "model",
            message: error.message || "計算できませんでした。",
          },
        ],
      };
    }
  }
  function exportDocument(model, data, allowDraft = false) {
    validateShape(model, data, allowDraft);
    const result = calculate(model, data);
    if (!result.ok && !allowDraft)
      fail(result.errors[0].field, result.errors[0].message);
    return {
      format: "bolt-effective-length",
      version: 6,
      specVersion: data.specVersion,
      state: result.ok ? "calculated" : "draft",
      exportedAt: new Date().toISOString(),
      catalogVersion: data.catalogs[model.boltType]?.version ?? null,
      model: clone(model),
      result: result.ok ? result : null,
    };
  }
  function upgradeModel(model, data) {
    const m = clone(model);
    if (m?.specVersion === "2026-10-08-wood") {
      // 旧画面で深さが二重入力されていた場合、異なる値を勝手に選ばない。
      if (
        m.axisDepth !== "" &&
        units(m.axisDepth, "boltDepth") !== units(m.boxDepth, "boltDepth")
      )
        fail(
          "boltDepth",
          "旧データの2つの深さが異なります。元のJSONを残し、ボルト深さを入力し直してください。",
        );
      m.boltDepth = m.boxDepth;
      delete m.boxDepth;
      delete m.axisDepth;
      m.specVersion = "2026-10-09-bolt-depth";
    }
    if (m?.specVersion === "2026-10-09-bolt-depth") {
      // 利用者の訂正に合わせ指定値を座金からの出として再計算する。元データは呼出側で退避する。
      m.leftProjection = m.leftTightening;
      m.rightProjection = m.rightTightening;
      delete m.leftTightening;
      delete m.rightTightening;
      m.specVersion = "2026-10-15-nut-engagement";
    }
    if (m?.specVersion === "2026-10-15-nut-engagement") {
      // 新しい最低値だけ適用し、未入力や不正な途中入力はそのまま残す。
      for (const side of ["left", "right"]) {
        const key = side + "Projection";
        try {
          const previous = units(m[key], key);
          if (
            previous >= 30 &&
            previous < data.selectionRules.minimumProjection * 10
          )
            m[key] = String(data.selectionRules.minimumProjection);
        } catch (error) {
          // 空欄や不正な値を推測して埋めない。
        }
      }
      m.specVersion = data.specVersion;
    }
    validateShape(m, data, true);
    return m;
  }
  function importDocument(doc, data) {
    const legacy =
      (doc?.version === 3 && doc.specVersion === "2026-10-08-wood") ||
      (doc?.version === 4 && doc.specVersion === "2026-10-09-bolt-depth") ||
      (doc?.version === 5 && doc.specVersion === "2026-10-15-nut-engagement");
    if (
      !doc ||
      doc.format !== "bolt-effective-length" ||
      (!legacy &&
        (doc.version !== 6 || doc.specVersion !== data.specVersion)) ||
      !["calculated", "draft"].includes(doc.state)
    )
      fail(
        "import",
        "旧計算または対応していないJSONです。新しい条件へ自動で読み替えません。",
      );
    if (!doc.model) fail("import", "入力条件がありません。");
    if (doc.model.specVersion !== doc.specVersion)
      fail("import", "JSONと入力条件の版が一致しません。");
    const m = upgradeModel(doc.model, data);
    validateShape(m, data, doc.state === "draft");
    if (m.boltType && doc.catalogVersion !== data.catalogs[m.boltType].version)
      fail("import", "カタログの版が異なります。入力は変更していません。");
    const r = calculate(m, data);
    if (doc.state !== "draft" && !r.ok)
      fail(r.errors[0].field, r.errors[0].message);
    return m;
  }
  function requiresOutputConfirmation(result) {
    return Boolean(result?.ok && ["short", "none"].includes(result.status));
  }
  return {
    InputError,
    units,
    format,
    createModel,
    upgradeModel,
    validateShape,
    calculate,
    exportDocument,
    importDocument,
    requiresOutputConfirmation,
  };
});
