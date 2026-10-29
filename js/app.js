(function () {
  "use strict";
  const data = window.BOLT_DEFAULTS,
    calc = window.BoltCalc,
    drawing = window.BoltDrawing;
  const $ = (id) => document.getElementById(id),
    esc = drawing.escape;
  const storageKey = "bolt-effective-length.saved.v1";
  const workspaceKey = "bolt-effective-length.workspace.v1";
  let model = calc.createModel(data),
    result = null,
    svg = "",
    zoom = 100,
    noticeTimer;
  let savedId = null,
    past = [],
    future = [],
    lastState,
    replaying = false,
    autosaveFailed = false,
    deletedItem = null,
    editGroup = "",
    lastEditGroup = "",
    lastEditAt = 0,
    outputSignature = "";
  let pendingWorkspaceRecovery = null;
  let printScroll = null;
  let lastDiagram = null,
    editorKey = "",
    editorTargetIndex = 0;
  const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const clone = (object) => JSON.parse(JSON.stringify(object));
  function icons() {
    if (window.lucide) window.lucide.createIcons();
  }
  function notify(message) {
    $("notice-message").textContent = message;
    $("notice").hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      $("notice").hidden = true;
    }, 6500);
  }
  function snapshot() {
    return { model: clone(model), savedId };
  }
  function encode() {
    return JSON.stringify(snapshot());
  }
  function saveWorkspace() {
    try {
      if (pendingWorkspaceRecovery !== null) {
        localStorage.setItem(
          `${workspaceKey}.recovery.${Date.now()}`,
          pendingWorkspaceRecovery,
        );
        pendingWorkspaceRecovery = null;
      }
      localStorage.setItem(
        workspaceKey,
        JSON.stringify({
          version: 1,
          catalogVersions: Object.fromEntries(
            Object.entries(data.catalogs).map(([type, catalog]) => [
              type,
              catalog.version,
            ]),
          ),
          current: snapshot(),
          history: past.slice(-30),
        }),
      );
      autosaveFailed = false;
      $("session-status").textContent =
        `${result?.ok ? "計算済み" : "途中入力"}・自動保存済み`;
    } catch (error) {
      $("session-status").textContent =
        "自動保存できません・JSONで退避してください";
      if (!autosaveFailed)
        notify("端末の保存領域を使用できません。入力はJSONで書き出せます。");
      autosaveFailed = true;
    }
  }
  function recordChange() {
    const next = encode();
    if (
      !replaying &&
      lastState &&
      JSON.parse(lastState).model &&
      JSON.stringify(model) !== JSON.stringify(JSON.parse(lastState).model)
    ) {
      const now = Date.now();
      // 同じ欄の連続入力は一回の取り消しにまとめる。
      if (
        !editGroup ||
        editGroup !== lastEditGroup ||
        now - lastEditAt > 1200
      ) {
        past.push(JSON.parse(lastState));
        if (past.length > 100) past.shift();
      }
      future = [];
      lastEditGroup = editGroup;
      lastEditAt = now;
    }
    lastState = next;
    $("undo").disabled = !past.length;
    $("redo").disabled = !future.length;
    if (!replaying) saveWorkspace();
  }
  function replaceModel(next, id = null) {
    closeEditor(false);
    model = next;
    savedId = id;
    zoom = 100;
    renderForm();
  }
  function restoreHistory(backward) {
    const source = backward ? past : future,
      target = backward ? future : past;
    if (!source.length) return;
    target.push(snapshot());
    const entry = source.pop();
    replaying = true;
    replaceModel(clone(entry.model), entry.savedId);
    replaying = false;
    lastState = encode();
    lastEditGroup = "";
    saveWorkspace();
    $("undo").disabled = !past.length;
    $("redo").disabled = !future.length;
  }
  function filename(extension, suffix = "", name = model.name) {
    let stem =
      name
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .slice(0, 80)
        .replace(/[. ]+$/g, "") || "bolt";
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem))
      stem = "_" + stem;
    return `${stem}${suffix}.${extension}`;
  }
  function focusedField() {
    const el = document.activeElement;
    if (!el || !el.matches("input,select,textarea")) return null;
    return el.id
      ? `#${el.id}`
      : el.dataset.part != null
        ? `[data-part="${el.dataset.part}"][data-key="${el.dataset.key}"]`
        : el.dataset.member != null
          ? `[data-member="${el.dataset.member}"][data-key="${el.dataset.key}"]`
          : null;
  }
  function refocus(selector) {
    const el = selector && document.querySelector(selector);
    if (el && el !== document.activeElement) el.focus({ preventScroll: true });
  }
  function highlightFocusedRow() {
    document
      .querySelectorAll("#drawing [data-row]")
      .forEach((el) => el.classList.remove("focused-row"));
    const el = document.activeElement;
    const key = el?.dataset.side
      ? "washer-" + el.dataset.side
      : ["column", "clearance"].includes(el?.id)
        ? "wood"
        : el?.id === "boltDepth"
          ? "depth"
          : "";
    if (key)
      document
        .querySelectorAll(`#drawing [data-row="${key}"]`)
        .forEach((item) => item.classList.add("focused-row"));
  }
  function applyZoom() {
    const el = $("drawing").querySelector("svg");
    if (!el) return;
    const box = el.viewBox.baseVal,
      viewport = $("drawing-viewport");
    const fit = Math.min((viewport.clientWidth - 12) / box.width, 1.15);
    const readableFit = Math.max(fit, Math.min(1, 620 / box.width));
    $("drawing").style.width =
      Math.max(1, (box.width * readableFit * zoom) / 100) + "px";
    $("drawing").style.height =
      Math.max(1, (box.height * readableFit * zoom) / 100) + "px";
    $("zoom-label").textContent = zoom + "%";
    positionEditor();
  }
  function setValue(id, value) {
    if ($(id).value !== String(value)) $(id).value = value;
  }
  function selectOptions(items, selected) {
    return items
      .map(
        ([value, label]) =>
          `<option value="${esc(value)}"${String(selected) === String(value) ? " selected" : ""}>${esc(label)}</option>`,
      )
      .join("");
  }
  function steppedValue(input, direction) {
    if (input.disabled || input.readOnly) return null;
    const key = input.id === "diagram-value" ? editorKey : input.id;
    if (!key) return null;
    try {
      // 0.1 mm単位の整数で増減し、小数部分を丸めない。
      const next = calc.units(input.value, key, true) + direction * 10;
      const minimum =
        key === "clearance"
          ? 0
          : ["leftProjection", "rightProjection"].includes(key)
            ? data.selectionRules.minimumProjection * 10
            : 1;
      return next >= minimum && next <= 100000 ? calc.format(next / 10) : null;
    } catch (error) {
      return null;
    }
  }
  function refreshNumberControls() {
    let added = false;
    for (const input of document.querySelectorAll(
      'input[inputmode="decimal"]',
    )) {
      let box = input.closest(".number-input");
      if (!box) {
        const label = input.closest("label.field"),
          field = document.createElement("div");
        // ラベル内に複数の操作部品を置かず、入力との関連付けを明示する。
        for (const attribute of [...label.attributes]) {
          field.setAttribute(attribute.name, attribute.value);
          label.removeAttribute(attribute.name);
        }
        label.replaceWith(field);
        label.htmlFor = input.id;
        box = document.createElement("span");
        box.className = "number-input";
        field.append(label, box);
        box.append(input);
        const controls = document.createElement("span");
        controls.className = "number-stepper";
        for (const [direction, name, symbol] of [
          [1, "1 mm増やす", "chevron-up"],
          [-1, "1 mm減らす", "chevron-down"],
        ]) {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.step = direction;
          button.dataset.input = input.id;
          button.title = name;
          button.setAttribute("aria-label", name);
          button.setAttribute("aria-controls", input.id);
          button.innerHTML = icon(symbol);
          controls.append(button);
        }
        box.append(controls);
        added = true;
      }
      for (const button of box.querySelectorAll("[data-step]"))
        button.disabled =
          steppedValue(input, Number(button.dataset.step)) == null;
    }
    if (added) icons();
  }
  function stepNumber(input, direction) {
    const next = steppedValue(input, direction);
    if (next == null) return;
    const focusedButton = document.activeElement?.matches("[data-step]")
      ? document.activeElement.dataset.step
      : null;
    input.value = next;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (focusedButton)
      document
        .querySelector(
          `[data-input="${input.id}"][data-step="${focusedButton}"]`,
        )
        ?.focus({ preventScroll: true });
  }
  function renderHardware() {
    const focus = focusedField();
    $("hardware").innerHTML = ["left", "right"]
      .map((side) => {
        const p = model.washers[side],
          part = data.parts.find((d) => d.id === p.partId);
        const label = side === "left" ? "左" : "右",
          custom = p.partId === "custom";
        return `<div class="washer-fields">
        <label class="field">${label}の座金<select id="washer-${side}" data-side="${side}" data-key="partId">${selectOptions(
          data.parts.map((p) => [p.id, p.name]),
          p.partId,
        )}</select></label>
        <div class="fixed-dimensions">厚さ ${esc(p.axial || "未入力")} mm / 外形 ${esc(p.outer || "未設定")} mm</div>
        <div class="small-grid"${custom || !part.outer ? "" : " hidden"}>
          <label class="field">厚さ<span class="unit">mm</span><input id="washer-${side}-axial" data-side="${side}" data-key="axial" type="text" inputmode="decimal" value="${esc(p.axial)}"${custom ? "" : " readonly"} /></label>
          <label class="field">外形の幅<span class="unit">mm</span><input id="washer-${side}-outer" data-side="${side}" data-key="outer" type="text" inputmode="decimal" placeholder="未設定" value="${esc(p.outer)}"${custom || !part.outer ? "" : " readonly"} /></label>
        </div><div class="part-source">${esc(part.source)}</div>
      </div>`;
      })
      .join("");
    refreshNumberControls();
    icons();
    refocus(focus);
  }
  function renderForm() {
    if (
      (editorKey === "effective" && model.mode !== "direct") ||
      (["column", "clearance", "leftBoxPosition"].includes(editorKey) &&
        model.mode !== "joint") ||
      (editorKey === "leftBoxPosition" && model.leftSeat !== "box") ||
      (editorKey === "leftProjection" && model.boltType !== "double")
    )
      closeEditor(false);
    for (const id of [
      "name",
      "effective",
      "direction",
      "note",
      "column",
      "beamWidth",
      "beamHeight",
      "clearance",
      "leftBoxPosition",
      "boltDepth",
      "recessWidth",
      "leftSeat",
      "rightSeat",
      "leftProjection",
      "rightProjection",
    ])
      setValue(id, model[id]);
    for (const name of ["boltType", "mode"])
      document.querySelectorAll("[name=" + name + "]").forEach((el) => {
        el.checked = el.value === model[name];
      });
    $("direct-fields").hidden = model.mode !== "direct";
    $("joint-fields").hidden = model.mode !== "joint";
    $("left-box-field").hidden = model.leftSeat !== "box";
    $("clearance-title").textContent =
      model.rightSeat === "box"
        ? "柱の右面から右の穴の内側まで"
        : "柱の右面から桁の右端まで";
    $("recess-width-field").hidden =
      model.leftSeat !== "recess" && model.rightSeat !== "recess";
    $("left-tightening-field").hidden = model.boltType !== "double";
    $("nut-count").textContent =
      model.boltType === "double"
        ? "座金：左右各1枚 / ナット：左右各1個"
        : model.boltType === "single"
          ? "座金：左右各1枚 / ナット：右に1個"
          : "座金：左右各1枚";
    renderHardware();
    renderOutput();
  }
  function renderCatalog() {
    const c = data.catalogs[model.boltType];
    $("candidate").innerHTML = selectOptions(
      [
        ["auto", "必要長以上の最小候補"],
        ...(c
          ? c.lengths.map((n) => [
              String(n),
              `${n} mm${result?.ok && n < result.required ? " · 不足" : ""}`,
            ])
          : []),
      ],
      model.candidate,
    );
    $("candidate").disabled = !c;
    $("catalog-count").textContent = c
      ? `${c.lengths.length}種 · ${c.product}`
      : "ボルト種別未選択";
    $("catalog-source").textContent = c
      ? `${c.source} ／ 版 ${c.version} ／ 単位 mm`
      : "";
    $("catalog").innerHTML = c
      ? c.lengths
          .map((n) => {
            const short = result.ok && n < result.required,
              chosen = result.ok && n === result.selected,
              proposed = result.ok && n === result.proposal;
            const state = short
              ? "不足"
              : chosen
                ? "採用候補"
                : proposed
                  ? "最小候補"
                  : "掲載長さ";
            return `<button type="button" data-length="${n}" class="${short ? "too-short " : ""}${chosen ? "selected " : ""}${proposed ? "proposed" : ""}" aria-pressed="${chosen}" aria-label="${n} mm・${state}" title="${n} mm・${state}">${n}</button>`;
          })
          .join("")
      : "";
  }
  function fieldElement(field) {
    return field === "boltType"
      ? document.querySelector("[name=boltType]")
      : $(field);
  }
  function renderInputDrawing() {
    const draft = result.ok
      ? result
      : calc.calculate(
          {
            ...clone(model),
            boltType: model.boltType || "double",
            candidate: model.boltType ? model.candidate : "auto",
          },
          data,
        );
    if (draft.ok) lastDiagram = draft;
    if (!lastDiagram) {
      const initial = calc.createModel(data);
      initial.boltType = "double";
      lastDiagram = calc.calculate(initial, data);
    }
    $("drawing").innerHTML = drawing.render(lastDiagram, data, {
      compact: true,
      interactive: true,
      preview: !result.ok,
      geometryPending: !draft.ok,
      sourceModel: model,
    });
    $("drawing").className = result.ok ? "" : "diagram-preview";
    $("diagram-state").textContent = result.ok
      ? ""
      : !model.boltType
        ? "ボルト未選択"
        : "入力中の参考図・未計算";
    $("dimension-summary").textContent =
      `桁 ${model.beamWidth || "未入力"} × ${model.beamHeight || "未入力"} / ボルト深さ ${model.boltDepth || "未入力"} / 最低かかり量 ${model.boltType === "double" ? "左" + (model.leftProjection || "未入力") + "・" : ""}右${model.rightProjection || "未入力"} mm`;
    $("file-summary").textContent = model.name;
    if (editorKey) {
      const field = editorKey;
      $("diagram-error").textContent =
        result.errors
          ?.filter(
            (error) =>
              error.field === field || error.field.startsWith(field + "-"),
          )
          .map((error) => error.message)
          .join(" ") || "";
      if (!field.startsWith("washer-") && !field.endsWith("Seat")) {
        try {
          calc.units(model[field], field, field === "clearance");
        } catch (error) {
          $("diagram-error").textContent = error.message;
        }
      }
    }
  }
  function refreshEditorParts() {
    const p = model.washers[editorKey.split("-")[1]],
      part = data.parts.find((item) => item.id === p.partId);
    $("diagram-part-size").textContent =
      `厚さ ${p.axial || "未入力"} mm / 外形 ${p.outer || "未設定"} mm`;
    $("diagram-custom-fields").hidden = part.id !== "custom" && !!part.outer;
    setValue("diagram-axial", p.axial);
    $("diagram-axial").readOnly = part.id !== "custom";
    setValue("diagram-outer", p.outer);
    $("diagram-outer").readOnly = part.id !== "custom" && !!part.outer;
  }
  function editorAnchor() {
    const targets = document.querySelectorAll(
      `#drawing [data-edit="${editorKey}"]`,
    );
    return targets[editorTargetIndex] || targets[0];
  }
  function positionEditor() {
    const editor = $("diagram-editor");
    if (!editorKey || editor.hidden) return;
    const anchor = editorAnchor();
    if (!anchor) {
      closeEditor(false);
      return;
    }
    document.querySelectorAll("#drawing [data-edit]").forEach((target) => {
      const active = target === anchor;
      target.classList.toggle("editing-target", active);
      target.setAttribute("aria-expanded", String(active));
      target.setAttribute("aria-controls", "diagram-editor");
    });

    // 再描画された同じ編集対象を追い、表示中の画面内に変更欄を収める。
    const viewport = window.visualViewport,
      margin = 12,
      gap = 8,
      viewLeft = (viewport?.offsetLeft || 0) + margin,
      viewTop = (viewport?.offsetTop || 0) + margin,
      viewWidth = Math.max(
        1,
        (viewport?.width || window.innerWidth) - 2 * margin,
      ),
      viewHeight = Math.max(
        1,
        (viewport?.height || window.innerHeight) - 2 * margin,
      ),
      viewRight = viewLeft + viewWidth,
      viewBottom = viewTop + viewHeight;
    editor.style.maxWidth = viewWidth + "px";
    editor.style.maxHeight = viewHeight + "px";
    const box = anchor.getBoundingClientRect(),
      size = editor.getBoundingClientRect(),
      width = Math.min(size.width || 280, viewWidth),
      height = Math.min(size.height || 180, viewHeight),
      clamp = (n, min, max) => Math.max(min, Math.min(n, Math.max(min, max)));
    let left = clamp(
        (box.left + box.right - width) / 2,
        viewLeft,
        viewRight - width,
      ),
      top = box.bottom + gap,
      placement = "below";
    if (top + height > viewBottom) {
      if (box.top - gap - height >= viewTop) {
        top = box.top - gap - height;
        placement = "above";
      } else if (box.right + gap + width <= viewRight) {
        left = box.right + gap;
        top = box.top;
        placement = "right";
      } else if (box.left - gap - width >= viewLeft) {
        left = box.left - gap - width;
        top = box.top;
        placement = "left";
      } else if (box.top - viewTop > viewBottom - box.bottom) {
        top = box.top - gap - height;
        placement = "above";
      }
    }
    editor.style.left = left + "px";
    editor.style.top = clamp(top, viewTop, viewBottom - height) + "px";
    editor.dataset.placement = placement;
  }
  function openEditor(key, target = null) {
    const titles = {
      column: model.leftSeat === "box" ? "梁側の基準幅" : "柱の幅",
      clearance:
        model.rightSeat === "box"
          ? "柱から右の穴まで（内側）"
          : "柱から桁の右端まで",
      leftBoxPosition: "左端から左の穴まで（内側）",
      effective: "有効長",
      leftSeat: "左の穴",
      rightSeat: "右の穴",
      "washer-left": "左の座金",
      "washer-right": "右の座金",
      beamWidth: "桁の幅",
      beamHeight: "桁の高さ",
      boltDepth: "ボルト深さ（外ツラから芯）",
      recessWidth: "座彫りの幅",
      leftProjection: "左の最低かかり量",
      rightProjection: "右の最低かかり量",
    };
    if (!titles[key]) return;
    editorKey = key;
    editorTargetIndex = Math.max(
      0,
      [...document.querySelectorAll(`#drawing [data-edit="${key}"]`)].indexOf(
        target,
      ),
    );
    const washer = key.startsWith("washer-"),
      seat = key.endsWith("Seat");
    $("diagram-title").textContent = titles[key];
    $("diagram-number-field").hidden = washer || seat;
    $("diagram-option-field").hidden = !washer && !seat;
    $("diagram-custom-fields").hidden = true;
    $("diagram-part-size").textContent = "";
    $("diagram-error").textContent = "";
    if (washer) {
      const side = key.split("-")[1];
      $("diagram-option").innerHTML = selectOptions(
        data.parts.map((p) => [p.id, p.name]),
        model.washers[side].partId,
      );
      refreshEditorParts();
    } else if (seat) {
      $("diagram-option").innerHTML = selectOptions(
        [
          ["recess", "座彫り"],
          ["box", "ボックス穴"],
        ],
        model[key],
      );
      $("diagram-part-size").textContent =
        model[key] === "box" ? "58 × 58 mm" : "28 mm";
    } else $("diagram-value").value = model[key];
    renderInputDrawing();
    refreshNumberControls();
    $("diagram-editor").hidden = false;
    $("diagram-workbench").classList.add("editing");
    applyZoom();
    const field = $(washer || seat ? "diagram-option" : "diagram-value");
    field.focus({ preventScroll: true });
    if (!washer && !seat) field.select();
  }
  function closeEditor(restoreFocus = true) {
    const anchor = editorKey && editorAnchor();
    editorKey = "";
    $("diagram-editor").hidden = true;
    $("diagram-workbench").classList.remove("editing");
    document.querySelectorAll("#drawing .editing-target").forEach((target) => {
      target.classList.remove("editing-target");
      target.setAttribute("aria-expanded", "false");
    });
    applyZoom();
    lastEditGroup = "";
    if (restoreFocus && anchor) anchor.focus({ preventScroll: true });
  }
  function endValues(quantity, suffix = " mm", separator = " / ") {
    const format = (n) => (n == null ? "未到達" : calc.format(n) + suffix);
    return result.selected == null
      ? "--"
      : model.boltType === "double"
        ? `左 ${format(quantity.left)}${separator}右 ${format(quantity.right)}`
        : `右 ${format(quantity.right)}`;
  }
  function renderOutput() {
    const focused = focusedField();
    result = calc.calculate(model, data);
    if (editorKey.startsWith("washer-")) {
      $("diagram-option").value = model.washers[editorKey.split("-")[1]].partId;
      refreshEditorParts();
    } else if (editorKey.endsWith("Seat")) {
      $("diagram-option").value = model[editorKey];
      $("diagram-part-size").textContent =
        model[editorKey] === "box" ? "58 × 58 mm" : "28 mm";
    } else if (
      editorKey &&
      $("diagram-value").value !== String(model[editorKey])
    )
      $("diagram-value").value = model[editorKey];
    const signature = JSON.stringify(model);
    if (signature !== outputSignature) $("output-confirmed").checked = false;
    outputSignature = signature;
    $("output-confirmation").hidden = !calc.requiresOutputConfirmation(result);
    document.querySelectorAll("[aria-invalid]").forEach((el) => {
      el.removeAttribute("aria-invalid");
      el.removeAttribute("aria-describedby");
    });
    document.querySelectorAll(".inline-error").forEach((el) => el.remove());
    $("errors").replaceChildren();
    $("warnings").textContent = "";
    $("result-context").textContent =
      model.boltType === "double"
        ? "両引き・ナット2個"
        : model.boltType === "single"
          ? "片引き・ナット1個"
          : "";
    if (result.ok) {
      for (const [key, value] of Object.entries({
        selected: result.selected,
        effective: result.effective,
        required: result.required,
        excess: result.excess,
      }))
        $("result-" + key).textContent =
          value == null ? "--" : calc.format(value);
      $("result-available").textContent = endValues(
        result.projection,
        "",
        "\n",
      );
      $("result-engaged").textContent = endValues(result.engagement);
      $("result-protruding").textContent = endValues(result.protrusion);
      $("selection-status").textContent = {
        fit: "長さ条件を満たす",
        over: "ナット外に10 mm超",
        short: "長さ不足",
        none: "該当候補なし",
      }[result.status];
      $("selection-status").className = "status " + result.status;
      $("warnings").textContent = result.warnings.join(" ");
      try {
        svg = drawing.render(result, data);
        renderInputDrawing();
        $("drawing").className = "";
      } catch (error) {
        svg = "";
        $("drawing").textContent = "図を描画できません。";
        $("drawing").className = "empty";
        $("warnings").textContent += " 図の出力エラー。";
      }
      $("measurement-definitions").replaceChildren();
      for (const [label, value] of [
        ["有効長の左端", result.definitions.effectiveStart],
        ["有効長の右端", result.definitions.effectiveEnd],
        ["ボルト長", result.definitions.bolt],
        ["かかり量", "座金の外面からボルト先端まで"],
      ]) {
        const line = document.createElement("div");
        line.textContent = label + "：" + value;
        $("measurement-definitions").appendChild(line);
      }
      $("equation").textContent =
        result.effectiveEquation +
        " mm\n必要長 " +
        calc.format(result.required) +
        " = " +
        result.boltEquation +
        "\nかかり量は座金の外面からボルト先端まで（ナット厚さは重複加算しない）";
      $("breakdown").innerHTML = result.breakdown
        .map(
          (row) =>
            `<tr><td>${esc(row.label)}</td><td>${row.value > 0 ? "+" : ""}${esc(calc.format(row.value))}</td></tr>`,
        )
        .join("");
    } else {
      for (const key of [
        "selected",
        "effective",
        "required",
        "excess",
        "available",
        "engaged",
        "protruding",
      ])
        $("result-" + key).textContent = "--";
      $("selection-status").textContent = model.boltType
        ? "未計算"
        : "種別を選択";
      $("selection-status").className = "status";
      for (const error of result.errors) {
        const link = document.createElement("button");
        link.type = "button";
        link.className = "error-link";
        link.textContent = error.message;
        link.addEventListener("click", () => {
          const el = fieldElement(error.field);
          if (el) {
            if (el.closest("details")) el.closest("details").open = true;
            el.scrollIntoView({ block: "center" });
            el.focus({ preventScroll: true });
          }
        });
        $("errors").appendChild(link);
        const el = fieldElement(error.field);
        if (el) {
          el.setAttribute("aria-invalid", "true");
          const small = document.createElement("small");
          small.className = "inline-error";
          small.id = "validation-" + error.field;
          small.textContent = error.message;
          el.setAttribute("aria-describedby", small.id);
          el.closest(".field")?.appendChild(small);
        }
      }
      svg = "";
      renderInputDrawing();
      $("measurement-definitions").textContent = "";
      $("equation").textContent = "未計算";
      $("breakdown").replaceChildren();
    }
    $("download-svg").disabled = !svg;
    $("print").disabled = !canPrint();
    if (!svg) {
      $("drawing").style.width = "";
      $("drawing").style.height = "";
    }
    applyZoom();
    renderCatalog();
    refocus(focused);
    highlightFocusedRow();
    recordChange();
    renderPrintConditions();
    refreshNumberControls();
    positionEditor();
  }
  function renderPrintConditions() {
    document.body.classList.toggle(
      "vertical-print",
      model.direction === "vertical",
    );
    const parent = $("print-conditions");
    parent.replaceChildren();
    $("print-drawing").innerHTML = result.ok
      ? drawing.render(result, data, { compact: true, print: true })
      : "";
    if (!result.ok) return;
    const heading = document.createElement("h2");
    heading.textContent = "入力条件";
    parent.appendChild(heading);
    const lines = [
      "名称：" + model.name,
      `入力：${model.mode === "joint" ? "柱と穴の位置から" : "有効長を入力"} / 図：${model.direction === "horizontal" ? "横向き" : "縦向き"}`,
      `桁：幅 ${model.beamWidth} × 高さ ${model.beamHeight} mm`,
      `穴：左 ${model.leftSeat === "box" ? "ボックス穴" : "座彫り"} / 右 ${model.rightSeat === "box" ? "ボックス穴" : "座彫り"}`,
      "座彫り28 mm / ボックス穴58 × 58 mm / ナット厚さ10 mm",
      `ボルト深さ：外ツラからボルト芯まで ${model.boltDepth} mm`,
      `最低かかり量：${model.boltType === "double" ? "左 " + model.leftProjection + " / " : ""}右 ${model.rightProjection} mm`,
      "かかり量：" + endValues(result.projection),
      "ナットへのかかり：" + $("result-engaged").textContent,
      "ナットからの飛び出し：" + $("result-protruding").textContent,
      "カタログ：" + result.catalog.source + " / 版 " + result.catalog.version,
    ];
    if (model.mode === "joint") {
      lines.push(
        `柱の幅：${model.column} mm / 柱からの距離：${model.clearance} mm`,
      );
      if (model.leftSeat === "box")
        lines.push("柱の左端〜左の穴の内側：" + model.leftBoxPosition + " mm");
    }
    for (const side of ["left", "right"]) {
      const p = result.washers[side];
      lines.push(
        `${side === "left" ? "左" : "右"}の${p.name}：厚さ ${p.axial} / 外形 ${p.outer ?? "未設定"} mm`,
      );
    }
    if (model.note) lines.push("メモ：" + model.note);
    for (const line of lines) {
      const p = document.createElement("p");
      p.textContent = line;
      parent.appendChild(p);
    }
  }
  function canPrint() {
    return (
      result?.ok &&
      (!calc.requiresOutputConfirmation(result) ||
        $("output-confirmed").checked)
    );
  }
  function download(content, type, name) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(new Blob([content], { type }));
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function savedItems() {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    let value;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        "保存領域が壊れています。退避用JSONを書き出してください。元データは上書きしません。",
      );
    }
    if (!value)
      throw new Error("保存領域の形式が不正です。元データは上書きしません。");
    if (value.version !== 1 || !Array.isArray(value.items))
      throw new Error("保存データの形式が不正です。");
    return value.items;
  }
  function writeSaved(items) {
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, items }));
  }
  function renderRecovery() {
    for (const key of Object.keys(localStorage).filter(
      (key) =>
        key.startsWith(storageKey + ".recovery.") ||
        key.startsWith(workspaceKey + ".recovery."),
    )) {
      const row = document.createElement("div");
      row.className = "saved-item";
      const label = document.createElement("span");
      label.textContent =
        "退避データ / " +
        new Date(Number(key.split(".").pop())).toLocaleString("ja-JP");
      const button = document.createElement("button");
      button.type = "button";
      button.title = "退避データを書き出す";
      button.setAttribute("aria-label", button.title);
      button.innerHTML = icon("download");
      button.addEventListener("click", () =>
        download(
          localStorage.getItem(key),
          "application/json",
          "bolt-recovery.json",
        ),
      );
      row.append(label, button);
      $("saved-list").appendChild(row);
    }
    icons();
  }
  function renderSaved() {
    $("saved-list").replaceChildren();
    let items;
    try {
      items = savedItems();
    } catch (error) {
      const message = document.createElement("p");
      message.textContent = error.message;
      const backup = document.createElement("button");
      backup.type = "button";
      backup.textContent = "保存領域を退避";
      backup.addEventListener("click", () =>
        download(
          localStorage.getItem(storageKey),
          "application/json",
          "bolt-storage-recovery.json",
        ),
      );
      const repair = document.createElement("button");
      repair.type = "button";
      repair.textContent = "退避して一覧を再作成";
      repair.addEventListener("click", () => {
        try {
          localStorage.setItem(
            `${storageKey}.recovery.${Date.now()}`,
            localStorage.getItem(storageKey),
          );
          writeSaved([]);
          savedId = null;
          lastState = encode();
          saveWorkspace();
          renderSaved();
          notify(
            "保存領域の原文を退避して一覧を再作成しました。退避データは保存一覧から書き出せます。",
          );
        } catch (error) {
          notify("退避できなかったため、元データは変更していません。");
        }
      });
      $("saved-list").append(message, backup, repair);
      renderRecovery();
      return;
    }
    if (!items.length) {
      $("saved-list").textContent = "保存した構成はありません。";
      renderRecovery();
      return;
    }
    for (const [index, item] of items.entries()) {
      let next,
        invalid = "";
      try {
        if (
          !item ||
          typeof item.id !== "string" ||
          typeof item.savedAt !== "string"
        )
          throw new Error("保存レコードの形式が不正です。");
        next = calc.importDocument(item.document, data);
      } catch (error) {
        invalid = error.message;
      }
      const row = document.createElement("div");
      row.className = "saved-item";
      const name = document.createElement("div");
      name.className = "saved-name";
      name.textContent =
        item?.document?.model?.name ||
        (invalid ? "読込できない保存データ" : "名称なし");
      const date = document.createElement("small");
      const r = next && calc.calculate(next, data);
      date.textContent =
        invalid ||
        `${r.ok ? `${next.boltType === "single" ? "片引き" : "両引き"} / E ${calc.format(r.effective)} / L ${r.selected ?? "未選定"} mm` : "途中入力"} / ${new Date(item.savedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`;
      name.appendChild(date);
      row.appendChild(name);
      for (const [action, title, ico] of [
        ["load", "開く", "folder-open"],
        ["export", "JSONを書き出す", "download"],
        ["remove", "削除", "trash-2"],
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.title = title;
        button.setAttribute("aria-label", title);
        button.innerHTML = icon(ico);
        button.disabled = action === "load" && !!invalid;
        button.addEventListener("click", () => {
          try {
            if (JSON.stringify(savedItems()[index]) !== JSON.stringify(item)) {
              renderSaved();
              throw new Error(
                "保存一覧が変更されました。更新された一覧から選び直してください。",
              );
            }
            if (action === "load") {
              replaceModel(clone(next), item.id);
              $("saved-dialog").close();
              notify(
                `保存した構成を開きました。${item.document.version < 6 ? "新基準（かかり10 mm以上・飛び出し10 mmまで）で読み込みました。必要長と候補を確認してください。" : ""}前の入力は「元に戻す」で復元できます。`,
              );
            }
            if (action === "export")
              download(
                JSON.stringify(invalid ? item : item.document, null, 2),
                "application/json",
                invalid
                  ? "bolt-record-recovery.json"
                  : filename("json", "", next.name),
              );
            if (action === "remove") {
              const current = savedItems();
              deletedItem = { item: current[index], index };
              current.splice(index, 1);
              writeSaved(current);
              if (item?.id === savedId) {
                savedId = null;
                lastState = encode();
                saveWorkspace();
              }
              renderSaved();
              notify("端末内の保存データを削除しました。");
              $("undo-delete").hidden = false;
              clearTimeout(noticeTimer);
            }
          } catch (error) {
            notify("保存データを処理できません：" + error.message);
          }
        });
        row.appendChild(button);
      }
      $("saved-list").appendChild(row);
    }
    icons();
    renderRecovery();
  }
  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest("[data-step]")) event.preventDefault();
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-step]");
    if (!button || button.disabled) return;
    event.preventDefault();
    stepNumber($(button.dataset.input), Number(button.dataset.step));
  });
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
      return;
    const input = event.target;
    if (
      !input.matches('input[inputmode="decimal"]') ||
      !["ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    stepNumber(input, event.key === "ArrowUp" ? 1 : -1);
  });
  for (const id of [
    "name",
    "effective",
    "note",
    "column",
    "beamWidth",
    "beamHeight",
    "clearance",
    "leftBoxPosition",
    "boltDepth",
    "recessWidth",
    "leftProjection",
    "rightProjection",
  ])
    $(id).addEventListener("input", (event) => {
      model[id] = event.target.value;
      renderOutput();
    });
  $("drawing").addEventListener("click", (event) => {
    const target = event.target.closest("[data-edit]");
    if (target) openEditor(target.dataset.edit, target);
  });
  $("drawing").addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    const target = event.target.closest("[data-edit]");
    if (target) {
      event.preventDefault();
      openEditor(target.dataset.edit, target);
    }
  });
  $("diagram-value").addEventListener("input", (event) => {
    if (!editorKey) return;
    model[editorKey] = event.target.value;
    setValue(editorKey, event.target.value);
    renderOutput();
  });
  $("diagram-option").addEventListener("change", (event) => {
    if (!editorKey) return;
    if (editorKey.startsWith("washer-")) {
      const part = data.parts.find((p) => p.id === event.target.value);
      model.washers[editorKey.split("-")[1]] = {
        partId: part.id,
        axial: part.axial,
        outer: part.outer,
      };
      refreshEditorParts();
    } else model[editorKey] = event.target.value;
    renderForm();
    if (
      editorKey === "leftSeat" &&
      model.leftSeat === "box" &&
      model.leftBoxPosition === ""
    )
      openEditor("leftBoxPosition");
    else if (editorKey.endsWith("Seat"))
      $("diagram-part-size").textContent =
        model[editorKey] === "box" ? "58 × 58 mm" : "28 mm";
  });
  for (const key of ["axial", "outer"])
    $("diagram-" + key).addEventListener("input", (event) => {
      if (!editorKey.startsWith("washer-")) return;
      model.washers[editorKey.split("-")[1]][key] = event.target.value;
      renderHardware();
      renderOutput();
      $("diagram-part-size").textContent =
        `厚さ ${model.washers[editorKey.split("-")[1]].axial || "未入力"} mm / 外形 ${model.washers[editorKey.split("-")[1]].outer || "未設定"} mm`;
    });
  $("diagram-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const invalid = result.errors?.some(
      (error) =>
        error.field === editorKey || error.field.startsWith(editorKey + "-"),
    );
    if (invalid || $("diagram-error").textContent) return;
    closeEditor();
  });
  $("close-diagram").addEventListener("click", () => closeEditor());
  document.addEventListener("pointerdown", (event) => {
    if (
      editorKey &&
      !event.target.closest(
        "#diagram-editor, #drawing [data-edit], .drawing-actions, #dimension-details",
      )
    )
      closeEditor(false);
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !$("diagram-editor").hidden &&
      !$("saved-dialog").open
    ) {
      event.preventDefault();
      closeEditor();
    }
  });
  for (const id of ["direction", "leftSeat", "rightSeat"])
    $(id).addEventListener("change", (event) => {
      model[id] = event.target.value;
      renderForm();
    });
  document.querySelectorAll("[name=boltType]").forEach((el) =>
    el.addEventListener("change", () => {
      model.boltType = el.value;
      model.candidate = "auto";
      renderForm();
    }),
  );
  document.querySelectorAll("[name=mode]").forEach((el) =>
    el.addEventListener("change", () => {
      if (el.value === "direct") {
        const current = result.ok
          ? result
          : calc.calculate(
              {
                ...clone(model),
                boltType: model.boltType || "double",
                candidate: "auto",
              },
              data,
            );
        if (current.ok) model.effective = calc.format(current.effective);
      }
      model.mode = el.value;
      renderForm();
    }),
  );
  $("hardware").addEventListener("input", (event) => {
    const el = event.target,
      side = el.dataset.side;
    if (!side) return;
    const p = model.washers[side];
    p[el.dataset.key] = el.value;
    if (el.dataset.key === "partId") {
      const part = data.parts.find((d) => d.id === el.value);
      p.axial = part.axial;
      p.outer = part.outer;
      renderHardware();
    }
    renderOutput();
  });
  $("candidate").addEventListener("change", (event) => {
    model.candidate = event.target.value;
    renderOutput();
  });
  $("catalog").addEventListener("click", (event) => {
    const button = event.target.closest("[data-length]");
    if (!button) return;
    model.candidate = button.dataset.length;
    renderOutput();
  });
  for (const [id, change] of [
    ["zoom-in", 25],
    ["zoom-out", -25],
    ["zoom-reset", 0],
  ])
    $(id).addEventListener("click", () => {
      zoom = change ? Math.min(800, Math.max(25, zoom + change)) : 100;
      applyZoom();
    });
  $("download-svg").addEventListener("click", () => {
    if (svg) download(svg, "image/svg+xml", filename("svg", "-section"));
  });
  $("export").addEventListener("click", () => {
    try {
      download(
        JSON.stringify(calc.exportDocument(model, data, true), null, 2),
        "application/json",
        filename("json"),
      );
    } catch (error) {
      notify(error.message);
    }
  });
  $("import").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024)
        throw new Error("JSONは2 MB以下にしてください。");
      const doc = JSON.parse(await file.text());
      const next = calc.importDocument(doc, data);
      replaceModel(next);
      notify(
        `${result.ok ? "JSONを読み込み、再計算しました" : "途中入力のJSONを開きました"}。${doc.version < 6 ? "新基準（かかり10 mm以上・飛び出し10 mmまで）で読み込みました。必要長と候補を確認してください。" : ""}前の入力は「元に戻す」で復元できます。`,
      );
    } catch (error) {
      notify(`「${file.name}」を読み込めません：${error.message}`);
    } finally {
      event.target.value = "";
    }
  });
  function saveConfiguration(asNew) {
    try {
      const items = savedItems();
      const index = asNew
        ? -1
        : items.findIndex((item) => item?.id === savedId);
      const entry = {
        id: index >= 0 ? savedId : crypto.randomUUID(),
        savedAt: new Date().toISOString(),
        document: calc.exportDocument(model, data, true),
      };
      if (index >= 0) items[index] = entry;
      else items.push(entry);
      writeSaved(items);
      savedId = entry.id;
      lastState = encode();
      saveWorkspace();
      notify(
        `${result.ok ? "構成" : "途中入力"}を${index >= 0 ? "更新" : "保存"}しました。`,
      );
    } catch (error) {
      notify(
        "端末に保存できません。JSON書き出しを使用してください：" +
          error.message,
      );
    }
  }
  $("save").addEventListener("click", () => saveConfiguration(false));
  $("save-as").addEventListener("click", () => saveConfiguration(true));
  $("undo-delete").addEventListener("click", () => {
    if (!deletedItem) return;
    try {
      const items = savedItems();
      items.splice(
        Math.min(deletedItem.index, items.length),
        0,
        deletedItem.item,
      );
      writeSaved(items);
      deletedItem = null;
      $("undo-delete").hidden = true;
      renderSaved();
      notify("削除した保存データを復元しました。");
    } catch (error) {
      notify(error.message);
    }
  });
  $("open-saved").addEventListener("click", () => {
    try {
      renderSaved();
      $("saved-dialog").showModal();
    } catch (error) {
      notify("保存データを開けません：" + error.message);
    }
  });
  $("close-saved").addEventListener("click", () => $("saved-dialog").close());
  $("reset").addEventListener("click", () => {
    replaceModel(calc.createModel(data));
    $("zoom-label").textContent = "100%";
    notify(
      "入力条件を初期状態に戻しました。前の入力は「元に戻す」で復元できます。",
    );
  });
  $("print").addEventListener("click", () => {
    if (canPrint()) {
      $("breakdown-details").open = true;
      renderPrintConditions();
      window.print();
    }
  });
  window.addEventListener("beforeprint", () => {
    printScroll = { x: window.scrollX, y: window.scrollY };
    window.scrollTo(0, 0);
    document.body.classList.toggle("print-blocked", !canPrint());
    $("breakdown-details").open = true;
    renderPrintConditions();
  });
  window.addEventListener("afterprint", () => {
    document.body.classList.remove("print-blocked");
    if (printScroll) window.scrollTo(printScroll.x, printScroll.y);
    printScroll = null;
  });
  $("output-confirmed").addEventListener("change", () => {
    $("print").disabled = !canPrint();
  });
  $("undo").addEventListener("click", () => restoreHistory(true));
  $("redo").addEventListener("click", () => restoreHistory(false));
  $("dismiss-notice").addEventListener("click", () => {
    $("notice").hidden = true;
    clearTimeout(noticeTimer);
  });
  window.addEventListener("resize", applyZoom);
  window.addEventListener("scroll", positionEditor, true);
  window.visualViewport?.addEventListener("resize", positionEditor);
  window.visualViewport?.addEventListener("scroll", positionEditor);
  if (window.ResizeObserver)
    new window.ResizeObserver(positionEditor).observe($("diagram-editor"));
  document.addEventListener(
    "input",
    (event) => {
      const el = event.target;
      editGroup =
        el.id ||
        `${el.dataset.member != null ? "member" : "part"}-${el.dataset.member ?? el.dataset.part}-${el.dataset.key}`;
    },
    true,
  );
  document.addEventListener(
    "click",
    () => {
      editGroup = "";
    },
    true,
  );
  document.querySelector(".workspace").addEventListener("focusin", (event) => {
    const el = event.target;
    if (el.matches('input[type="text"]')) {
      el.select();
      el.dataset.selectOnClick = "true";
    }
    highlightFocusedRow();
  });
  document.querySelector(".workspace").addEventListener("mouseup", (event) => {
    if (event.target.dataset.selectOnClick) {
      event.preventDefault();
      delete event.target.dataset.selectOnClick;
    }
  });
  document.querySelector(".workspace").addEventListener("focusout", (event) => {
    delete event.target.dataset.selectOnClick;
    lastEditGroup = "";
  });
  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const input = event.target.matches("input,textarea,select");
    if (!input && ["z", "y"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      restoreHistory(event.key.toLowerCase() === "z" && !event.shiftKey);
    }
    if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveConfiguration(event.shiftKey);
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (autosaveFailed && past.length) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  try {
    const raw = localStorage.getItem(workspaceKey);
    if (raw) {
      try {
        const session = JSON.parse(raw);
        if (session?.version !== 1 || !session.current)
          throw new Error("作業データの形式が不正です。");
        const restored = calc.upgradeModel(session.current.model, data);
        const type = restored.boltType;
        if (
          type &&
          session.catalogVersions &&
          session.catalogVersions[type] !== data.catalogs[type].version
        )
          throw new Error("カタログ版が異なるため、自動適用しません。");
        if (session.current.model.specVersion !== data.specVersion) {
          pendingWorkspaceRecovery = raw;
          localStorage.setItem(`${workspaceKey}.recovery.${Date.now()}`, raw);
          pendingWorkspaceRecovery = null;
          notify(
            "新基準（かかり10 mm以上・飛び出し10 mmまで）で読み込みました。必要長と候補を確認してください。元の作業データも退避しています。",
          );
        }
        model = restored;
        savedId =
          typeof session.current.savedId === "string"
            ? session.current.savedId
            : null;
        past = (
          Array.isArray(session.history) ? session.history.slice(-30) : []
        ).flatMap((entry) => {
          try {
            return [{ ...entry, model: calc.upgradeModel(entry.model, data) }];
          } catch (error) {
            return [];
          }
        });
      } catch (error) {
        // 壊れた自動保存も、初期化前に端末内へ原文を退避する。
        pendingWorkspaceRecovery = raw;
        localStorage.setItem(`${workspaceKey}.recovery.${Date.now()}`, raw);
        pendingWorkspaceRecovery = null;
        notify(
          `${error.message} 自動保存の原文を退避しました。保存済みの構成は変更していません。`,
        );
      }
    }
  } catch (error) {
    autosaveFailed = true;
  }
  lastState = encode();
  window.BoltApp = {
    getModel: () => clone(model),
    getResult: () => clone(result),
  };
  renderForm();
  icons();
})();
