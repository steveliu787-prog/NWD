/* NWD site editor — in-place text & image editing with one-click GitHub publishing.
   Ported key scheme and crop logic from the original inline editor; publishing
   now commits directly to the repository through the GitHub REST Contents API. */
(function () {
  "use strict";

  var storageKey = "nwdrecruitment-content-edits";
  var tokenKey = "nwdrecruitment-editor-token";
  var loginKey = "nwdrecruitment-editor-login";
  var remotePath = "edits.json";
  var repoSlug = "steveliu787-prog/NWD";
  var branch = "main";
  var apiBase = "https://api.github.com";
  var liveEditsUrl = "edits.json";
  var imageDir = "assets/edits";
  var tokenCreateUrl = "https://github.com/settings/personal-access-tokens/new" +
    "?name=" + encodeURIComponent("NWD 网站编辑器") +
    "&description=" + encodeURIComponent("网页内容编辑发布") +
    "&target_name=steveliu787-prog" +
    "&expires_in=90" +
    "&contents=write";
  var supportedLangs = ["zh-CN", "zh-HK", "en"];

  var editorBar = null;
  var editorStatus = null;
  var publishButton = null;
  var revertButton = null;
  var connectButton = null;
  var imagePanel = null;
  var tokenPanel = null;
  var cropStage = null;
  var cropViewport = null;
  var cropCanvas = null;
  var cropZoomInput = null;
  var cropZoomValue = null;
  var cropSizeLabel = null;
  var imageUrlInput = null;
  var imageFileInput = null;
  var imageCurrentPreview = null;
  var imageOutputPreview = null;
  var inlineImageError = null;
  var tokenInput = null;
  var tokenStateLine = null;

  var activeLang = document.documentElement.lang || "zh-CN";
  var editingEnabled = false;
  var imageRecords = [];
  var textRecords = [];
  var edits = {};
  var remoteEdits = {};
  var activeTextRecord = null;
  var activeImageRecord = null;
  var tokenLogin = "";
  var publishState = { phase: "idle" };
  var moveRecords = [];
  var overlayNodes = {};
  var selectedLayoutTarget = null;
  var activeOverlayText = null;
  var imageEditTarget = null;
  var layoutDragSuppressClick = false;
  var layoutDragState = null;
  var layoutResizeState = null;
  var layoutTouched = false;
  var inspectorBar = null;
  var addMenu = null;
  var hiddenPanel = null;
  var floatingHandle = null;
  var addElementButton = null;
  var hiddenRestoreButton = null;
  var undoButton = null;
  var redoButton = null;
  var undoStack = [];
  var redoStack = [];
  var colorPresets = ["#A6192E", "#2B070C", "#251A1C", "#6E6265", "#E45869", "#FFFFFF"];
  var imageState = {
    image: null,
    rawSource: "",
    loadedSource: "",
    zoom: 1,
    panX: 0,
    panY: 0,
    baseScale: 1,
    targetRatio: 1,
    outputWidth: 0,
    outputHeight: 0,
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    panStartX: 0,
    panStartY: 0
  };

  /* ---------- UI construction ---------- */

  function buildToolbar() {
    var aside = document.createElement("aside");
    aside.id = "siteEditor";
    aside.className = "inline-editor";
    aside.setAttribute("hidden", "");
    aside.setAttribute("aria-hidden", "true");
    aside.innerHTML =
      '<div class="inline-editor-bar">' +
      '<div class="inline-editor-bar-inner">' +
      '<span class="inline-editor-mark">原位编辑</span>' +
      '<div class="inline-lang-tabs" aria-label="编辑语言">' +
      '<button type="button" data-editor-lang="zh-CN">简</button>' +
      '<button type="button" data-editor-lang="zh-HK">繁</button>' +
      '<button type="button" data-editor-lang="en">EN</button>' +
      '</div>' +
      '<button class="inline-tool-button" id="undoEdit" type="button" disabled title="Ctrl+Z">撤销</button>' +
      '<button class="inline-tool-button" id="redoEdit" type="button" disabled title="Ctrl+Shift+Z / Ctrl+Y">重做</button>' +
      '<button class="inline-tool-button" id="revertLocalEdits" type="button">放弃全部修改</button>' +
      '<button class="inline-tool-button" id="addElement" type="button">添加 ▾</button>' +
      '<button class="inline-tool-button" id="hiddenRestore" type="button" hidden>已删除</button>' +
      '<button class="inline-tool-button" id="connectGithub" type="button">连接 GitHub</button>' +
      '<button class="inline-tool-button primary" id="publishChanges" type="button">发布</button>' +
      '<button class="inline-tool-button quiet" id="closeInlineEditor" type="button">完成</button>' +
      '<div class="inline-editor-status" id="editorStatus" role="status" aria-live="polite"></div>' +
      '</div>' +
      '</div>';
    document.body.appendChild(aside);
    editorBar = aside;
    editorStatus = aside.querySelector("#editorStatus");
    publishButton = aside.querySelector("#publishChanges");
    revertButton = aside.querySelector("#revertLocalEdits");
    connectButton = aside.querySelector("#connectGithub");
    addElementButton = aside.querySelector("#addElement");
    hiddenRestoreButton = aside.querySelector("#hiddenRestore");
    undoButton = aside.querySelector("#undoEdit");
    redoButton = aside.querySelector("#redoEdit");
  }

  function buildImagePanel() {
    var panel = document.createElement("section");
    panel.id = "inlineImageEditor";
    panel.className = "inline-image-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    panel.setAttribute("aria-labelledby", "inlineImageTitle");
    panel.setAttribute("hidden", "");
    panel.innerHTML =
      '<header class="inline-image-panel-head">' +
      '<div>' +
      '<strong id="inlineImageTitle">图片编辑</strong>' +
      '<span id="inlineImageCaption">拖动图片并调整缩放，保持版块原有尺寸比例。</span>' +
      '</div>' +
      '<button class="inline-close" id="closeInlineImage" type="button" aria-label="关闭图片编辑">&times;</button>' +
      '</header>' +
      '<div class="inline-image-body">' +
      '<div class="inline-field">' +
      '<span class="inline-field-label">当前图片</span>' +
      '<div class="inline-current-image"><img id="imageCurrentPreview" alt=""></div>' +
      '</div>' +
      '<div class="inline-field">' +
      '<label for="imageUrlInput">图片地址</label>' +
      '<div class="inline-field-row">' +
      '<input id="imageUrlInput" type="url" placeholder="https://example.com/image.jpg" autocomplete="off">' +
      '<button class="inline-file-picker" id="loadImageUrl" type="button">载入</button>' +
      '</div>' +
      '</div>' +
      '<div class="inline-field">' +
      '<label class="inline-file-picker" for="imageFileInput">从电脑选择图片' +
      '<input id="imageFileInput" type="file" accept="image/jpeg,image/png,image/webp">' +
      '</label>' +
      '</div>' +
      '<div class="crop-stage" id="cropStage" hidden>' +
      '<div class="crop-stage-head">' +
      '<span>裁剪画面</span>' +
      '<span>拖拽图片调整位置</span>' +
      '</div>' +
      '<div class="crop-viewport" id="cropViewport"><canvas id="cropCanvas"></canvas></div>' +
      '<div class="crop-controls">' +
      '<label for="cropZoomInput">缩放 <span id="cropZoomValue">100%</span></label>' +
      '<button id="cropResetButton" type="button">重置位置</button>' +
      '</div>' +
      '<input id="cropZoomInput" type="range" min="1" max="4" step="0.01" value="1">' +
      '<p class="crop-size" id="cropSizeLabel"></p>' +
      '</div>' +
      '<div class="inline-output">' +
      '<div class="inline-output-preview"><img id="imageOutputPreview" alt=""></div>' +
      '<div class="inline-output-copy" id="imageOutputNote">裁剪后会按当前版块比例输出，页面布局不会变形。</div>' +
      '</div>' +
      '<p class="inline-image-error" id="inlineImageError" role="alert"></p>' +
      '<div class="inline-image-actions">' +
      '<button class="primary" id="applyCroppedImage" type="button">应用裁剪图片</button>' +
      '<button id="useRawImage" type="button">直接使用原图</button>' +
      '<button id="cancelInlineImage" type="button">取消</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(panel);
    imagePanel = panel;
    cropStage = panel.querySelector("#cropStage");
    cropViewport = panel.querySelector("#cropViewport");
    cropCanvas = panel.querySelector("#cropCanvas");
    cropZoomInput = panel.querySelector("#cropZoomInput");
    cropZoomValue = panel.querySelector("#cropZoomValue");
    cropSizeLabel = panel.querySelector("#cropSizeLabel");
    imageUrlInput = panel.querySelector("#imageUrlInput");
    imageFileInput = panel.querySelector("#imageFileInput");
    imageCurrentPreview = panel.querySelector("#imageCurrentPreview");
    imageOutputPreview = panel.querySelector("#imageOutputPreview");
    inlineImageError = panel.querySelector("#inlineImageError");
  }

  function buildTokenPanel() {
    var panel = document.createElement("section");
    panel.id = "inlineTokenPanel";
    panel.className = "inline-sync-panel";
    panel.setAttribute("aria-labelledby", "inlineTokenTitle");
    panel.setAttribute("hidden", "");
    panel.innerHTML =
      '<h3 id="inlineTokenTitle">连接 GitHub（仅需一次）</h3>' +
      '<p class="inline-sync-note">发布修改需要一枚只授权本仓库的令牌。令牌只保存在你这个浏览器里，可随时吊销。</p>' +
      '<ol class="inline-token-steps">' +
      '<li>点击 <strong>打开令牌创建页</strong>，名称和权限已自动填好。</li>' +
      '<li>在 <strong>Repository access</strong> 选择 <strong>Only select repositories</strong>，勾选 <strong>NWD</strong>。</li>' +
      '<li>拉到底部点击 <strong>Generate token</strong>，复制生成的令牌。</li>' +
      '<li>粘贴到下方输入框，点击 <strong>连接</strong>。</li>' +
      '</ol>' +
      '<div class="inline-token-actions">' +
      '<button id="openTokenPage" type="button">打开令牌创建页</button>' +
      '</div>' +
      '<div class="inline-field">' +
      '<label for="tokenInput">粘贴令牌（github_pat_ 开头）</label>' +
      '<input id="tokenInput" type="password" autocomplete="off" placeholder="github_pat_…">' +
      '</div>' +
      '<div class="inline-sync-actions">' +
      '<button class="primary" id="connectToken" type="button">连接</button>' +
      '<button id="disconnectToken" type="button">断开连接</button>' +
      '<button id="closeTokenPanel" type="button">关闭</button>' +
      '</div>' +
      '<p class="inline-token-connected" id="tokenState" data-state=""></p>';
    document.body.appendChild(panel);
    tokenPanel = panel;
    tokenInput = panel.querySelector("#tokenInput");
    tokenStateLine = panel.querySelector("#tokenState");
  }

  /* ---------- catalog & element addressing (ported verbatim for edits.json compatibility) ---------- */

  function isExcludedEditorElement(element) {
    if (!element || !element.closest) return true;
    return Boolean(element.closest("#siteEditor, #inlineImageEditor, #inlineTokenPanel, #jobGrid, #detailMain, #detailMeta, script, style, svg, nav, .site-header, .mobile-menu, form, .jobs-toolbar, .search-row, .filters-row"));
  }

  function isCatalogableText(element) {
    if (isExcludedEditorElement(element)) return false;
    if (!element.textContent || !element.textContent.trim()) return false;
    var children = Array.prototype.slice.call(element.children || []);
    var disallowed = children.some(function (child) {
      var tag = child.tagName.toUpperCase();
      return tag !== "BR" && tag !== "SVG";
    });
    return !disallowed;
  }

  function escapeSelector(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function computeElementKey(element) {
    var owner = null;
    if (element.id) owner = element.id;
    if (!owner) {
      var section = element.closest("section[id], footer, .view[id]");
      owner = section ? section.id : "page";
    }
    if (!owner) {
      var fallbackOwner = element.closest("section, footer, main");
      owner = fallbackOwner ? fallbackOwner.tagName.toLowerCase() : "page";
    }
    var tag = element.tagName.toLowerCase();
    var cls = element.classList && element.classList.length ? element.classList[0] : "";
    var selector = "#" + escapeSelector(owner) + " " + tag + (cls ? "." + escapeSelector(cls) : "");
    var bucket = document.querySelectorAll(selector);
    var index = Array.prototype.indexOf.call(bucket, element);
    if (index < 0) index = Array.prototype.indexOf.call(document.querySelectorAll(tag), element);
    if (index < 0) index = 0;
    return owner + ":" + tag + ":" + cls + ":" + index;
  }

  function keyForText(element) {
    return "text:" + computeElementKey(element);
  }

  function keyForElement(element) {
    var existing = element.getAttribute("data-editor-key");
    if (existing) return existing;
    return "el:" + computeElementKey(element);
  }

  function isMoveExcluded(element) {
    if (!element || !element.closest) return true;
    if (element.closest(".growth-side, .application-panel, .skip-link")) return true;
    return Boolean(element.closest("#siteEditor, #inlineImageEditor, #inlineTokenPanel, #layoutInspector, #addElementMenu, #hiddenRestorePanel, #jobGrid, #detailMain, #detailMeta, script, style, nav, .site-header, .mobile-menu, form, .jobs-toolbar, .search-row, .filters-row"));
  }

  function buildMoveCatalog() {
    moveRecords = [];
    var candidates = document.querySelectorAll("main *, footer *");
    Array.prototype.forEach.call(candidates, function (element) {
      if (element.hasAttribute("data-editor-key")) return;
      if (element.hasAttribute("data-move-key")) return;
      if (element.closest(".nwd-ov")) return;
      if (isMoveExcluded(element)) return;
      var key = keyForElement(element);
      element.setAttribute("data-move-key", key);
      var label = (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 38);
      if (!label) label = element.tagName.toLowerCase() + (element.classList && element.classList.length ? "." + element.classList[0] : "");
      moveRecords.push({ key: key, label: label, element: element });
    });
  }

  function buildCatalog() {
    imageRecords = [];
    textRecords = [];

    document.querySelectorAll("main img, footer img").forEach(function (img) {
      var base = (img.getAttribute("src") || "").split("/").pop().split("?")[0] || "image";
      var key = "image:" + base;
      var rect = img.getBoundingClientRect();
      var slotRatio = rect.width > 0 && rect.height > 0
        ? rect.width / rect.height
        : (img.naturalWidth / img.naturalHeight) || 16 / 10;
      img.setAttribute("data-editor-type", "image");
      img.setAttribute("data-editor-key", key);
      imageRecords.push({
        key: key,
        label: img.getAttribute("alt") || base,
        element: img,
        initial: img.getAttribute("src"),
        slotRatio: slotRatio
      });
    });

    document.querySelectorAll("main h1, main h2, main h3, main h4, main h5, main p, main li, main strong, main small, main blockquote, main figcaption, main span, main a, footer h2, footer h3, footer p, footer li, footer strong, footer small, footer a, footer span").forEach(function (element) {
      if (!isCatalogableText(element)) return;
      var key = keyForText(element);
      element.setAttribute("data-editor-type", "text");
      element.setAttribute("data-editor-key", key);
      textRecords.push({
        key: key,
        label: element.textContent.trim().replace(/\s+/g, " ").slice(0, 38),
        element: element,
        baselines: {}
      });
    });

    buildMoveCatalog();

    captureBaseline(activeLang);
  }

  /* ---------- edit application (ported) ---------- */

  function setLeafText(element, value) {
    var lines = String(value == null ? "" : value).replace(/\r\n/g, "\n").split("\n");
    var textNodes = Array.prototype.filter.call(element.childNodes, function (node) { return node.nodeType === Node.TEXT_NODE; });
    var firstElementChild = Array.prototype.find.call(element.childNodes, function (node) { return node.nodeType === Node.ELEMENT_NODE && node.tagName.toUpperCase() !== "BR"; }) || null;
    Array.prototype.forEach.call(element.querySelectorAll(":scope > br"), function (node) { node.parentNode.removeChild(node); });

    while (textNodes.length < lines.length) {
      var node = document.createTextNode("");
      element.insertBefore(node, firstElementChild);
      textNodes.push(node);
    }
    textNodes.forEach(function (node, index) { node.nodeValue = lines[index] || ""; });
    for (var i = 1; i < lines.length; i += 1) {
      element.insertBefore(document.createElement("br"), textNodes[i]);
    }
    element.style.removeProperty("white-space");
  }

  function textValue(record, lang) {
    var langEdits = edits[lang] || {};
    if (Object.prototype.hasOwnProperty.call(langEdits, record.key)) return langEdits[record.key];
    if (Object.prototype.hasOwnProperty.call(record.baselines, lang)) return record.baselines[lang];
    return record.element.textContent;
  }

  function imageValue(record) {
    var langEdits = edits[activeLang] || {};
    if (Object.prototype.hasOwnProperty.call(langEdits, record.key)) return langEdits[record.key];
    return record.initial;
  }

  function captureBaseline(lang) {
    if (supportedLangs.indexOf(lang) === -1) return;
    textRecords.forEach(function (record) {
      var langEdits = edits[lang] || {};
      if (Object.prototype.hasOwnProperty.call(langEdits, record.key)) return;
      if (Object.prototype.hasOwnProperty.call(record.baselines, lang)) return;
      record.baselines[lang] = record.element.textContent;
    });
  }

  function applyEdits() {
    var langEdits = edits[activeLang] || {};
    imageRecords.forEach(function (record) {
      record.element.setAttribute("src", imageValue(record));
      record.element.removeAttribute("srcset");
    });
    textRecords.forEach(function (record) {
      if (Object.prototype.hasOwnProperty.call(langEdits, record.key)) {
        setLeafText(record.element, langEdits[record.key]);
      } else if (Object.prototype.hasOwnProperty.call(record.baselines, activeLang)) {
        setLeafText(record.element, record.baselines[activeLang]);
      }
    });
  }

  /* ---------- local persistence ---------- */

  function readLocalEdits() {
    try {
      var value = window.localStorage.getItem(storageKey);
      return value ? JSON.parse(value) : {};
    } catch (error) {
      return {};
    }
  }

  function writeLocalEdits() {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(edits));
      return true;
    } catch (error) {
      setStatus("浏览器存储空间不足：如果刚添加了大图片，请先发布到 GitHub，或换小一点的图片再试。", "error");
      return false;
    }
  }

  function readToken() {
    try {
      return window.localStorage.getItem(tokenKey) || "";
    } catch (error) {
      return "";
    }
  }

  function saveToken(token) {
    try {
      window.localStorage.setItem(tokenKey, token);
    } catch (error) {}
  }

  function clearToken() {
    try {
      window.localStorage.removeItem(tokenKey);
      window.localStorage.removeItem(loginKey);
    } catch (error) {}
    tokenLogin = "";
  }

  /* ---------- status & change tracking ---------- */

  function setStatus(message, state) {
    if (!editorStatus) return;
    editorStatus.textContent = message || "";
    editorStatus.dataset.state = state || "";
  }

  function buildChangeSet() {
    var result = {};
    supportedLangs.forEach(function (lang) {
      var remote = remoteEdits[lang] || {};
      var local = edits[lang] || {};
      var diff = {};
      Object.keys(local).forEach(function (key) {
        if (remote[key] !== local[key]) diff[key] = local[key];
      });
      if (Object.keys(diff).length) result[lang] = diff;
    });
    if (layoutTouched || edits.layout) {
      var localLayout = normalizeLayout(edits.layout || null);
      var remoteLayout = normalizeLayout(remoteEdits.layout || null);
      if (stableStringify(localLayout) !== stableStringify(remoteLayout)) {
        result.layout = JSON.parse(JSON.stringify(localLayout));
      }
    }
    return result;
  }

  function countUnsyncedChanges() {
    var changeSet = buildChangeSet();
    var total = 0;
    Object.keys(changeSet).forEach(function (lang) {
      if (lang === "layout") return;
      total += Object.keys(changeSet[lang]).length;
    });
    total += countLayoutChanges(normalizeLayout(edits.layout || null), normalizeLayout(remoteEdits.layout || null));
    return total;
  }

  function updateStatus() {
    if (publishState.phase !== "idle") return;
    var n = countUnsyncedChanges();
    if (n > 0) setStatus(n + " 处修改待发布（已自动保存在本浏览器）", "");
    else setStatus("所有修改均已发布 ✓", "ok");
  }

  /* ---------- undo / redo ---------- */

  function pushUndoState(coalesceKey) {
    var now = Date.now();
    var top = undoStack[undoStack.length - 1];
    if (coalesceKey && top && top.coalesceKey === coalesceKey && now - top.at < 800) {
      top.at = now;
      return;
    }
    undoStack.push({ coalesceKey: coalesceKey || null, at: now, snapshot: JSON.parse(JSON.stringify(edits)) });
    if (undoStack.length > 40) undoStack.shift();
    redoStack.length = 0;
    updateUndoButtons();
  }

  function restoreEditsSnapshot(snapshot) {
    edits = snapshot;
    if (edits.layout) edits.layout = normalizeLayout(edits.layout);
    clearLayoutSelection();
    writeLocalEdits();
    applyAll();
    updateStatus();
    updateLayoutButtons();
    updateUndoButtons();
  }

  function undoEdit() {
    if (!editingEnabled || publishState.phase !== "idle" || !undoStack.length) return;
    if (layoutDragState && layoutDragState.dragging) return;
    if (layoutResizeState) return;
    if (activeTextRecord) commitTextEditing(true);
    if (activeOverlayText) commitOverlayTextEditing(true);
    var entry = undoStack.pop();
    if (!entry) return;
    redoStack.push({ coalesceKey: null, at: Date.now(), snapshot: JSON.parse(JSON.stringify(edits)) });
    restoreEditsSnapshot(entry.snapshot);
    setStatus("已撤销一步（还可撤销 " + undoStack.length + " 步）。", "ok");
  }

  function redoEdit() {
    if (!editingEnabled || publishState.phase !== "idle" || !redoStack.length) return;
    if (layoutDragState && layoutDragState.dragging) return;
    if (layoutResizeState) return;
    if (activeTextRecord) commitTextEditing(true);
    if (activeOverlayText) commitOverlayTextEditing(true);
    var entry = redoStack.pop();
    if (!entry) return;
    undoStack.push({ coalesceKey: null, at: Date.now(), snapshot: JSON.parse(JSON.stringify(edits)) });
    restoreEditsSnapshot(entry.snapshot);
    setStatus("已重做一步（还可重做 " + redoStack.length + " 步）。", "ok");
  }

  function updateUndoButtons() {
    if (!undoButton || !redoButton) return;
    var busy = publishState.phase !== "idle";
    undoButton.disabled = busy || !undoStack.length;
    redoButton.disabled = busy || !redoStack.length;
  }

  function setBusy(phase) {
    publishState.phase = phase;
    var busy = phase !== "idle";
    if (publishButton) {
      publishButton.disabled = busy;
      publishButton.classList.toggle("is-busy", busy);
    }
    if (revertButton) revertButton.disabled = busy;
    if (addElementButton) addElementButton.disabled = busy;
    if (hiddenRestoreButton) hiddenRestoreButton.disabled = busy;
    if (inspectorBar) inspectorBar.classList.toggle("is-locked", busy);
    document.querySelectorAll("[data-editor-lang]").forEach(function (button) {
      button.disabled = busy;
    });
    updateUndoButtons();
  }

  /* ---------- text editing ---------- */

  function focusEnd(element) {
    try {
      var range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (error) {}
  }

  function openTextEditing(record) {
    closeImageEditor();
    if (activeTextRecord && activeTextRecord !== record) commitTextEditing(true);
    activeTextRecord = record;
    record.savedText = record.element.textContent;
    record.element.setAttribute("contenteditable", "plaintext-only");
    record.element.focus();
    focusEnd(record.element);
    setStatus("正在编辑：" + record.label + "（点击空白处保存，Esc 取消）");
  }

  function commitTextEditing(save) {
    if (!activeTextRecord) return;
    var record = activeTextRecord;
    var value = record.element.textContent || "";
    var valueToApply = save ? value : record.savedText;
    record.element.removeAttribute("contenteditable");
    setLeafText(record.element, valueToApply);
    if (save && value !== record.savedText) {
      pushUndoState("text:" + activeLang + ":" + record.key);
      edits[activeLang] = edits[activeLang] || {};
      edits[activeLang][record.key] = value;
      writeLocalEdits();
      updateStatus();
    }
    activeTextRecord = null;
  }

  /* ---------- image editing & cropping (ported) ---------- */

  function setImageError(message) {
    inlineImageError.textContent = message || "";
    inlineImageError.classList.toggle("is-visible", Boolean(message));
  }

  function resetImageState() {
    imageState.image = null;
    imageState.rawSource = "";
    imageState.loadedSource = "";
    imageState.zoom = 1;
    imageState.panX = 0;
    imageState.panY = 0;
    imageState.baseScale = 1;
    imageState.targetRatio = 1;
    imageState.outputWidth = 0;
    imageState.outputHeight = 0;
    imageState.dragging = false;
    cropStage.hidden = true;
    cropZoomInput.value = "1";
    cropZoomValue.textContent = "100%";
    cropSizeLabel.textContent = "";
    imageOutputPreview.removeAttribute("src");
    setImageError("");
  }

  function loadImageSource(source) {
    return new Promise(function (resolve) {
      if (!source) {
        imageState.rawSource = "";
        imageCurrentPreview.removeAttribute("src");
        imageOutputPreview.removeAttribute("src");
        cropStage.hidden = true;
        setImageError("");
        resolve({ ok: false });
        return;
      }
      var image = new Image();
      if (/^https?:/.test(source)) image.crossOrigin = "anonymous";
      image.onload = function () {
        imageState.image = image;
        imageState.rawSource = source;
        imageState.loadedSource = source;
        imageState.zoom = 1;
        imageState.panX = 0;
        imageState.panY = 0;
        imageCurrentPreview.src = source;
        imageOutputPreview.src = source;
        cropStage.hidden = false;
        prepareCropCanvas();
        setImageError("");
        resolve({ ok: true });
      };
      image.onerror = function () {
        imageState.rawSource = source;
        imageCurrentPreview.src = source;
        imageOutputPreview.src = source;
        cropStage.hidden = true;
        setImageError("该图片无法在当前环境裁剪（可能缺少跨域许可）。仍可点击“直接使用原图”。");
        resolve({ ok: false });
      };
      image.src = source;
    });
  }

  function prepareCropCanvas() {
    if (!imageState.image || !cropStage || cropStage.hidden) return;
    var ratio = imageState.targetRatio || (imageState.image.naturalWidth / imageState.image.naturalHeight) || 16 / 10;
    var cssWidth = cropViewport.clientWidth || Math.min(430, window.innerWidth - 44);
    var cssHeight = cssWidth / ratio;
    cropViewport.style.aspectRatio = String(ratio);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cropCanvas.width = Math.round(cssWidth * dpr);
    cropCanvas.height = Math.round(cssHeight * dpr);
    var ctx = cropCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    imageState.baseScale = Math.max(cssWidth / imageState.image.naturalWidth, cssHeight / imageState.image.naturalHeight);
    var outputRatio = ratio;
    var outputWidth = imageState.image.naturalWidth;
    var outputHeight = Math.round(outputWidth / outputRatio);
    var maxSide = 1600;
    if (Math.max(outputWidth, outputHeight) > maxSide) {
      var scale = maxSide / Math.max(outputWidth, outputHeight);
      outputWidth = Math.round(outputWidth * scale);
      outputHeight = Math.round(outputHeight * scale);
    }
    if (Math.min(outputWidth, outputHeight) > 2400) {
      var capScale = 2400 / Math.min(outputWidth, outputHeight);
      outputWidth = Math.round(outputWidth * capScale);
      outputHeight = Math.round(outputHeight * capScale);
    }
    imageState.outputWidth = outputWidth;
    imageState.outputHeight = outputHeight;
    cropSizeLabel.textContent = "输出尺寸：" + outputWidth + " × " + outputHeight + " px，比例已锁定为当前版块。";
    drawCropCanvas();
  }

  function clampOffset(value, min, max) {
    if (min > max) return (min + max) / 2;
    return Math.min(max, Math.max(min, value));
  }

  function getDrawGeometry() {
    var image = imageState.image;
    var cssWidth = cropViewport.clientWidth || cropCanvas.width;
    var cssHeight = cssWidth / imageState.targetRatio;
    var scale = imageState.baseScale * imageState.zoom;
    var drawWidth = image.naturalWidth * scale;
    var drawHeight = image.naturalHeight * scale;
    var minX = drawWidth >= cssWidth ? cssWidth - drawWidth : (cssWidth - drawWidth) / 2;
    var maxX = drawWidth >= cssWidth ? 0 : (cssWidth - drawWidth) / 2;
    var minY = drawHeight >= cssHeight ? cssHeight - drawHeight : (cssHeight - drawHeight) / 2;
    var maxY = drawHeight >= cssHeight ? 0 : (cssHeight - drawHeight) / 2;
    var x = clampOffset(imageState.panX, minX, maxX);
    var y = clampOffset(imageState.panY, minY, maxY);
    return { x: x, y: y, width: drawWidth, height: drawHeight, scale: scale };
  }

  function drawCropCanvas() {
    if (!imageState.image || cropStage.hidden) return;
    var ctx = cropCanvas.getContext("2d");
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    var geometry = getDrawGeometry();
    ctx.drawImage(imageState.image, geometry.x, geometry.y, geometry.width, geometry.height);
    cropZoomValue.textContent = Math.round(imageState.zoom * 100) + "%";
  }

  function cropExportDataUrl() {
    if (!imageState.image) throw new Error("还没有可裁剪的图片。");
    var geometry = getDrawGeometry();
    var sourceWidth = geometry.width / geometry.scale;
    var sourceHeight = geometry.height / geometry.scale;
    var sourceX = -geometry.x / geometry.scale;
    var sourceY = -geometry.y / geometry.scale;
    sourceX = Math.max(0, Math.min(sourceX, imageState.image.naturalWidth - sourceWidth));
    sourceY = Math.max(0, Math.min(sourceY, imageState.image.naturalHeight - sourceHeight));
    var output = document.createElement("canvas");
    output.width = imageState.outputWidth;
    output.height = imageState.outputHeight;
    var ctx = output.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, output.width, output.height);
    ctx.drawImage(
      imageState.image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      imageState.outputWidth,
      imageState.outputHeight
    );
    try {
      var dataUrl = output.toDataURL("image/jpeg", 0.88);
      imageOutputPreview.src = dataUrl;
      return dataUrl;
    } catch (error) {
      var localHint = /^file:$/.test(window.location.protocol) ? "本地 file:// 预览受浏览器安全限制。请用“从电脑选择图片”重新选择图片后裁剪，或直接使用原图；线上 GitHub Pages 可自动裁剪。" : "裁剪导出失败：" + error.message;
      setImageError(localHint);
      return null;
    }
  }

  function openImageEditor(record) {
    if (activeTextRecord) commitTextEditing(true);
    activeImageRecord = record;
    imagePanel.hidden = false;
    imagePanel.classList.add("is-open");
    imagePanel.setAttribute("aria-hidden", "false");
    imagePanel.querySelector("#inlineImageCaption").textContent = "正在编辑：" + record.label;
    var value = imageValue(record);
    imageUrlInput.value = /^data:/.test(value) ? "" : value;
    imageCurrentPreview.src = value;
    imageOutputPreview.src = value;
    resetImageState();
    imageState.targetRatio = record.slotRatio;
    setStatus("正在编辑图片：" + record.label);
    loadImageSource(value);
  }

  function closeImageEditor() {
    activeImageRecord = null;
    imageEditTarget = null;
    imagePanel.hidden = true;
    imagePanel.classList.remove("is-open");
    imagePanel.setAttribute("aria-hidden", "true");
    resetImageState();
  }

  function applyImageValue(value) {
    if (!value) return;
    if (imageEditTarget) {
      var overlaySpec = overlaySpecForEdit(imageEditTarget.overlayId);
      if (overlaySpec) {
        pushUndoState("ovimage:" + imageEditTarget.overlayId);
        overlaySpec.src = value;
        updateOverlayElement(overlaySpec);
        writeLocalEdits();
        updateStatus();
      }
      closeImageEditor();
      return;
    }
    if (!activeImageRecord) return;
    pushUndoState("image:" + activeLang + ":" + activeImageRecord.key);
    edits[activeLang] = edits[activeLang] || {};
    edits[activeLang][activeImageRecord.key] = value;
    writeLocalEdits();
    applyEdits();
    updateStatus();
    closeImageEditor();
  }

  /* ---------- language layer (ported) ---------- */

  function setLangButtons() {
    document.querySelectorAll("[data-editor-lang]").forEach(function (button) {
      var active = button.getAttribute("data-editor-lang") === activeLang;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function updateActiveLang(lang) {
    if (supportedLangs.indexOf(lang) === -1) return;
    activeLang = lang;
    setLangButtons();
    captureBaseline(activeLang);
    applyEdits();
    applyLayout();
  }

  function restoreEditsBeforeLanguageSwitch(lang) {
    var langEdits = edits[lang] || {};
    textRecords.forEach(function (record) {
      if (!Object.prototype.hasOwnProperty.call(langEdits, record.key)) return;
      if (Object.prototype.hasOwnProperty.call(record.baselines, lang)) {
        setLeafText(record.element, record.baselines[lang]);
      }
    });
  }

  /* ---------- layout editing: state ---------- */

  function normalizeLayout(value) {
    var result = { moves: {}, sizes: {}, hidden: [], elements: [] };
    if (!value || typeof value !== "object") return result;
    if (value.moves && typeof value.moves === "object") {
      Object.keys(value.moves).forEach(function (key) {
        var m = value.moves[key];
        if (!m || typeof m !== "object") return;
        var dx = Math.round(Number(m.dx) || 0);
        var dy = Math.round(Number(m.dy) || 0);
        if (dx || dy) result.moves[key] = { dx: dx, dy: dy };
      });
    }
    if (value.sizes && typeof value.sizes === "object") {
      Object.keys(value.sizes).forEach(function (key) {
        var s = value.sizes[key];
        if (!s || typeof s !== "object") return;
        var w = Math.round(Number(s.w) || 0);
        var h = Math.round(Number(s.h) || 0);
        if (w > 0 || h > 0) result.sizes[key] = { w: w, h: h };
      });
    }
    if (Array.isArray(value.hidden)) {
      value.hidden.forEach(function (key) {
        if (typeof key === "string" && result.hidden.indexOf(key) === -1) result.hidden.push(key);
      });
    }
    if (Array.isArray(value.elements)) {
      value.elements.forEach(function (el) {
        if (!el || typeof el !== "object") return;
        if (!el.id || !el.type || !el.anchor) return;
        var spec = {
          id: String(el.id),
          type: String(el.type),
          anchor: String(el.anchor),
          x: Math.round(Number(el.x) || 0),
          y: Math.round(Number(el.y) || 0),
          w: Math.max(8, Math.round(Number(el.w) || 100)),
          h: Math.max(4, Math.round(Number(el.h) || 40)),
          z: Math.min(99, Math.max(1, Math.round(Number(el.z) || 6)))
        };
        if (el.color) spec.color = String(el.color);
        if (el.rot) spec.rot = Number(el.rot) || 0;
        if (typeof el.src === "string" && el.src) spec.src = el.src;
        if (el.text && typeof el.text === "object") {
          spec.text = {};
          supportedLangs.forEach(function (lang) {
            if (typeof el.text[lang] === "string") spec.text[lang] = el.text[lang];
          });
        }
        result.elements.push(spec);
      });
    }
    return result;
  }

  function effectiveLayout() {
    if (edits.layout) return edits.layout;
    return normalizeLayout(remoteEdits.layout || null);
  }

  function ensureLayout() {
    if (!edits.layout) edits.layout = normalizeLayout(remoteEdits.layout || null);
    layoutTouched = true;
    return edits.layout;
  }

  function layoutSpecById(id) {
    var layout = effectiveLayout();
    for (var i = 0; i < layout.elements.length; i += 1) {
      if (layout.elements[i].id === id) return layout.elements[i];
    }
    return null;
  }

  function overlaySpecForEdit(id) {
    var layout = ensureLayout();
    for (var i = 0; i < layout.elements.length; i += 1) {
      if (layout.elements[i].id === id) return layout.elements[i];
    }
    return null;
  }

  function generateOverlayId() {
    var layout = effectiveLayout();
    var id;
    do {
      id = "e-" + Math.random().toString(16).slice(2, 8);
    } while (layout.elements.some(function (el) { return el.id === id; }));
    return id;
  }

  function countLayoutChanges(local, remote) {
    var total = 0;
    Object.keys(local.moves).forEach(function (k) {
      var r = remote.moves[k];
      if (!r || r.dx !== local.moves[k].dx || r.dy !== local.moves[k].dy) total += 1;
    });
    Object.keys(remote.moves).forEach(function (k) { if (!local.moves[k]) total += 1; });
    Object.keys(local.sizes).forEach(function (k) {
      var r = remote.sizes[k];
      if (!r || r.w !== local.sizes[k].w || r.h !== local.sizes[k].h) total += 1;
    });
    Object.keys(remote.sizes).forEach(function (k) { if (!local.sizes[k]) total += 1; });
    local.hidden.forEach(function (k) { if (remote.hidden.indexOf(k) === -1) total += 1; });
    remote.hidden.forEach(function (k) { if (local.hidden.indexOf(k) === -1) total += 1; });
    var remoteById = {};
    remote.elements.forEach(function (el) { remoteById[el.id] = el; });
    var localIds = {};
    local.elements.forEach(function (el) {
      localIds[el.id] = true;
      if (!remoteById[el.id] || stableStringify(remoteById[el.id]) !== stableStringify(el)) total += 1;
    });
    remote.elements.forEach(function (el) { if (!localIds[el.id]) total += 1; });
    return total;
  }

  /* ---------- layout editing: anchors & rendering (visitors too) ---------- */

  function resolveAnchor(anchor) {
    if (!anchor) return null;
    if (anchor.charAt(0) === "@") {
      var parts = anchor.slice(1).split(":");
      if (parts.length < 2) return null;
      try {
        return document.querySelector("#" + escapeSelector(parts[0]) + " > section." + escapeSelector(parts.slice(1).join(":")));
      } catch (error) {
        return null;
      }
    }
    return document.getElementById(anchor);
  }

  function anchorForSection(section) {
    if (section.id) return section.id;
    var view = section.closest(".view");
    var viewId = view && view.id ? view.id : "";
    var cls = section.classList && section.classList.length ? section.classList[0] : section.tagName.toLowerCase();
    return "@" + viewId + ":" + cls;
  }

  function anchorForPoint(x, y) {
    var probe = document.elementFromPoint(x, y);
    var section = probe && probe.closest ? probe.closest("main section") : null;
    if (!section) section = document.querySelector(".view.active section");
    if (!section) section = document.querySelector("main section");
    if (!section) return null;
    return { section: section, anchor: anchorForSection(section) };
  }

  function overlayTextFor(spec) {
    if (!spec.text) return "";
    return spec.text[activeLang] || spec.text["zh-CN"] || spec.text["en"] || "";
  }

  function styleOverlayNode(node, spec) {
    node.style.left = spec.x + "px";
    node.style.top = spec.y + "px";
    node.style.width = spec.w + "px";
    node.style.height = spec.h + "px";
    node.style.zIndex = String(spec.z);
    node.style.transform = spec.rot ? "rotate(" + spec.rot + "deg)" : "";
    if (spec.type === "text") {
      if (spec.color) node.style.color = spec.color;
      else node.style.removeProperty("color");
    } else if (spec.type === "bubble" || spec.type === "arrow" || spec.type === "rect" || spec.type === "line") {
      if (spec.color) node.style.setProperty("--ov-color", spec.color);
      else node.style.removeProperty("--ov-color");
    }
  }

  function renderOverlayElement(spec) {
    var section = resolveAnchor(spec.anchor);
    if (!section) return null;
    var node = document.createElement("div");
    node.className = "nwd-ov nwd-ov-" + spec.type;
    node.setAttribute("data-ov-id", spec.id);
    styleOverlayNode(node, spec);
    if (spec.type === "image") {
      var img = document.createElement("img");
      img.alt = "";
      img.src = spec.src || "";
      node.appendChild(img);
    } else if (spec.type === "text" || spec.type === "bubble") {
      node.textContent = overlayTextFor(spec);
    }
    section.appendChild(node);
    overlayNodes[spec.id] = node;
    return node;
  }

  function updateOverlayElement(spec) {
    var node = overlayNodes[spec.id];
    if (!node) return;
    styleOverlayNode(node, spec);
    if (spec.type === "image") {
      var img = node.querySelector("img");
      if (!img) {
        img = document.createElement("img");
        img.alt = "";
        node.appendChild(img);
      }
      if (img.getAttribute("src") !== spec.src) img.src = spec.src || "";
    } else if (spec.type === "text" || spec.type === "bubble") {
      if (!(activeOverlayText && activeOverlayText.spec === spec)) {
        node.textContent = overlayTextFor(spec);
      }
    }
  }

  function applyLayout() {
    var layout = effectiveLayout();

    var needed = {};
    layout.elements.forEach(function (spec) { needed[spec.anchor] = true; });
    document.querySelectorAll("main .view section").forEach(function (section) {
      var anchor = anchorForSection(section);
      if (needed[anchor]) {
        if (getComputedStyle(section).position === "static") {
          section.style.position = "relative";
          section.setAttribute("data-ed-layout-host", "");
        }
      } else if (section.hasAttribute("data-ed-layout-host")) {
        section.removeAttribute("data-ed-layout-host");
        section.style.removeProperty("position");
      }
    });

    document.querySelectorAll("main [data-editor-key], main [data-move-key], footer [data-editor-key], footer [data-move-key]").forEach(function (element) {
      var key = element.getAttribute("data-editor-key") || element.getAttribute("data-move-key");
      var move = layout.moves[key];
      if (move) element.style.translate = move.dx + "px " + move.dy + "px";
      else element.style.removeProperty("translate");
      var size = layout.sizes[key];
      if (size) {
        if (size.w) element.style.width = size.w + "px";
        if (size.h) element.style.height = size.h + "px";
      } else {
        element.style.removeProperty("width");
        element.style.removeProperty("height");
      }
      element.classList.toggle("ed-layout-hidden", layout.hidden.indexOf(key) !== -1);
    });

    var live = {};
    layout.elements.forEach(function (spec) {
      live[spec.id] = true;
      if (overlayNodes[spec.id]) updateOverlayElement(spec);
      else renderOverlayElement(spec);
    });
    Object.keys(overlayNodes).forEach(function (id) {
      if (!live[id]) {
        overlayNodes[id].remove();
        delete overlayNodes[id];
        if (selectedLayoutTarget && selectedLayoutTarget.kind === "overlay" && selectedLayoutTarget.id === id) clearLayoutSelection();
      }
    });
    updateLayoutButtons();
  }

  function applyAll() {
    applyEdits();
    applyLayout();
  }

  function updateLayoutButtons() {
    if (!hiddenRestoreButton) return;
    var layout = effectiveLayout();
    var n = layout.hidden.length;
    hiddenRestoreButton.hidden = !editingEnabled || n === 0;
    hiddenRestoreButton.textContent = "已删除 (" + n + ")";
  }

  /* ---------- layout editing: selection & inspector ---------- */

  function buildLayoutUI() {
    inspectorBar = document.createElement("div");
    inspectorBar.id = "layoutInspector";
    inspectorBar.setAttribute("hidden", "");
    document.body.appendChild(inspectorBar);

    addMenu = document.createElement("div");
    addMenu.id = "addElementMenu";
    addMenu.setAttribute("hidden", "");
    [["text", "文字"], ["image", "图片"], ["bubble", "气泡"], ["arrow", "箭头"], ["rect", "矩形"], ["line", "线条"]].forEach(function (pair) {
      var item = document.createElement("button");
      item.type = "button";
      item.setAttribute("data-add-type", pair[0]);
      item.textContent = pair[1];
      addMenu.appendChild(item);
    });
    document.body.appendChild(addMenu);

    hiddenPanel = document.createElement("div");
    hiddenPanel.id = "hiddenRestorePanel";
    hiddenPanel.setAttribute("hidden", "");
    document.body.appendChild(hiddenPanel);

    floatingHandle = document.createElement("div");
    floatingHandle.className = "nwd-handle is-floating";
    floatingHandle.setAttribute("hidden", "");
    document.body.appendChild(floatingHandle);
  }

  function appendInspectorButton(label, onClick) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "inline-tool-button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    inspectorBar.appendChild(button);
    return button;
  }

  function appendInspectorHint(text) {
    var span = document.createElement("span");
    span.className = "inspector-hint";
    span.textContent = text;
    inspectorBar.appendChild(span);
  }

  function selectLayoutTarget(target) {
    if (publishState.phase !== "idle") return;
    if (activeTextRecord) commitTextEditing(true);
    if (activeOverlayText) commitOverlayTextEditing(true);
    clearLayoutSelection();
    var element = target.kind === "overlay" ? overlayNodes[target.id] : target.element;
    if (!element) return;
    selectedLayoutTarget = target;
    element.classList.add("is-layout-selected");
    renderInspector();
    attachResizeHandle();
    positionInspector();
  }

  function clearLayoutSelection() {
    detachResizeHandle();
    if (selectedLayoutTarget) {
      var element = selectedLayoutTarget.kind === "overlay" ? overlayNodes[selectedLayoutTarget.id] : selectedLayoutTarget.element;
      if (element) element.classList.remove("is-layout-selected");
    }
    selectedLayoutTarget = null;
    if (inspectorBar) inspectorBar.hidden = true;
  }

  function positionInspector() {
    if (!selectedLayoutTarget || !inspectorBar || inspectorBar.hidden) return;
    var element = selectedLayoutTarget.kind === "overlay" ? overlayNodes[selectedLayoutTarget.id] : selectedLayoutTarget.element;
    if (!element) return;
    var rect = element.getBoundingClientRect();
    var width = inspectorBar.offsetWidth || 320;
    var height = inspectorBar.offsetHeight || 44;
    var left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    var top = rect.top > height + 12 ? rect.top - height - 10 : Math.min(rect.bottom + 10, window.innerHeight - height - 8);
    inspectorBar.style.left = left + "px";
    inspectorBar.style.top = Math.max(8, top) + "px";
  }

  function renderInspector() {
    if (!selectedLayoutTarget) { inspectorBar.hidden = true; return; }
    inspectorBar.innerHTML = "";
    if (selectedLayoutTarget.kind === "existing") {
      var key = selectedLayoutTarget.key;
      appendInspectorButton("重置", function () { resetExistingElement(key); });
      appendInspectorButton("删除", function () { deleteSelectedLayoutTarget(); });
      appendInspectorHint("拖动移动 · 手柄调大小");
      inspectorBar.hidden = false;
      return;
    }
    var spec = overlaySpecForEdit(selectedLayoutTarget.id);
    if (!spec) { clearLayoutSelection(); return; }
    if (spec.type === "text" || spec.type === "bubble") {
      appendInspectorButton("编辑文字", function () { openOverlayTextEditing(spec); });
    }
    if (spec.type === "image") {
      appendInspectorButton("换图", function () { openOverlayImageEditor(spec); });
    }
    var swatchRow = document.createElement("span");
    swatchRow.className = "nwd-swatch-row";
    colorPresets.forEach(function (color) {
      var swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "nwd-swatch";
      swatch.style.background = color;
      swatch.title = color;
      swatch.addEventListener("click", function () {
        if (spec.color !== color) pushUndoState("ovcolor:" + spec.id);
        spec.color = color;
        writeLocalEdits();
        updateStatus();
        updateOverlayElement(spec);
        renderInspector();
        positionInspector();
      });
      swatchRow.appendChild(swatch);
    });
    inspectorBar.appendChild(swatchRow);
    if (spec.type === "arrow" || spec.type === "line" || spec.type === "rect") {
      appendInspectorButton("旋转", function () {
        pushUndoState("ovrot:" + spec.id);
        spec.rot = ((spec.rot || 0) + 45) % 360;
        writeLocalEdits(); updateStatus(); updateOverlayElement(spec); positionInspector();
      });
    }
    appendInspectorButton("上移层", function () {
      pushUndoState("ovz:" + spec.id);
      spec.z = Math.min(99, (spec.z || 6) + 1);
      writeLocalEdits(); updateStatus(); updateOverlayElement(spec);
    });
    appendInspectorButton("下移层", function () {
      pushUndoState("ovz:" + spec.id);
      spec.z = Math.max(1, (spec.z || 6) - 1);
      writeLocalEdits(); updateStatus(); updateOverlayElement(spec);
    });
    appendInspectorButton("复制", function () { duplicateOverlayElement(spec); });
    appendInspectorButton("删除", function () { deleteSelectedLayoutTarget(); });
    inspectorBar.hidden = false;
  }

  function resetExistingElement(key) {
    if (!edits.layout) {
      setStatus("该元素没有本地调整。", "ok");
      return;
    }
    if (edits.layout.moves[key] || edits.layout.sizes[key]) pushUndoState("reset:" + key);
    delete edits.layout.moves[key];
    delete edits.layout.sizes[key];
    clearLayoutSelection();
    writeLocalEdits();
    updateStatus();
    applyLayout();
  }

  function deleteSelectedLayoutTarget() {
    if (!selectedLayoutTarget || publishState.phase !== "idle") return;
    if (selectedLayoutTarget.kind === "overlay") {
      var layout = ensureLayout();
      var removedId = selectedLayoutTarget.id;
      pushUndoState("ovdelete:" + removedId);
      layout.elements = layout.elements.filter(function (el) { return el.id !== removedId; });
      clearLayoutSelection();
      writeLocalEdits();
      updateStatus();
      applyLayout();
      setStatus("叠加元素已删除。", "ok");
      return;
    }
    var existingLayout = ensureLayout();
    var existingKey = selectedLayoutTarget.key;
    if (existingLayout.hidden.indexOf(existingKey) === -1) {
      pushUndoState("hide:" + existingKey);
      existingLayout.hidden.push(existingKey);
    }
    clearLayoutSelection();
    writeLocalEdits();
    updateStatus();
    applyLayout();
    setStatus("元素已删除，可在“已删除”面板恢复。", "ok");
  }

  function duplicateOverlayElement(spec) {
    var layout = ensureLayout();
    var copy = JSON.parse(JSON.stringify(spec));
    copy.id = generateOverlayId();
    copy.x += 16;
    copy.y += 16;
    pushUndoState();
    layout.elements.push(copy);
    writeLocalEdits();
    updateStatus();
    applyLayout();
    selectLayoutTarget({ kind: "overlay", id: copy.id });
  }

  /* ---------- layout editing: resize handle ---------- */

  function attachResizeHandle() {
    if (!selectedLayoutTarget) return;
    if (selectedLayoutTarget.kind === "overlay") {
      var node = overlayNodes[selectedLayoutTarget.id];
      if (!node) return;
      if (!node.querySelector(":scope > .nwd-handle")) {
        var handle = document.createElement("div");
        handle.className = "nwd-handle";
        node.appendChild(handle);
      }
    } else {
      floatingHandle.hidden = false;
      positionFloatingHandle();
    }
  }

  function positionFloatingHandle() {
    if (!selectedLayoutTarget || floatingHandle.hidden) return;
    var element = selectedLayoutTarget.element;
    if (!element) return;
    var rect = element.getBoundingClientRect();
    floatingHandle.style.left = (rect.right - 7) + "px";
    floatingHandle.style.top = (rect.bottom - 7) + "px";
  }

  function detachResizeHandle() {
    if (selectedLayoutTarget && selectedLayoutTarget.kind === "overlay") {
      var node = overlayNodes[selectedLayoutTarget.id];
      if (node) {
        var handle = node.querySelector(":scope > .nwd-handle");
        if (handle) handle.remove();
      }
    }
    if (floatingHandle) floatingHandle.hidden = true;
  }

  /* ---------- layout editing: add menu & hidden panel ---------- */

  function closeAddElementMenu() {
    if (addMenu) addMenu.hidden = true;
  }

  function toggleAddElementMenu() {
    if (addMenu.hidden) {
      var rect = addElementButton.getBoundingClientRect();
      addMenu.style.left = Math.max(8, rect.left) + "px";
      addMenu.style.bottom = (window.innerHeight - rect.top + 10) + "px";
      addMenu.hidden = false;
    } else {
      addMenu.hidden = true;
    }
  }

  function closeHiddenRestorePanel() {
    if (hiddenPanel) hiddenPanel.hidden = true;
  }

  function createOverlayElement(type) {
    var point = anchorForPoint(window.innerWidth / 2, window.innerHeight / 2);
    if (!point) {
      setStatus("找不到可插入的版块。", "error");
      return;
    }
    var defaults = { text: [240, 64], bubble: [260, 110], rect: [220, 140], line: [160, 3], arrow: [150, 26], image: [320, 200] }[type] || [200, 80];
    var rect = point.section.getBoundingClientRect();
    var spec = {
      id: generateOverlayId(),
      type: type,
      anchor: point.anchor,
      x: Math.max(0, Math.round(window.innerWidth / 2 - rect.left - defaults[0] / 2)),
      y: Math.max(0, Math.round(window.innerHeight / 2 - rect.top - defaults[1] / 2)),
      w: defaults[0],
      h: defaults[1],
      z: 6,
      rot: 0
    };
    if (type === "text" || type === "bubble") {
      spec.text = {};
      supportedLangs.forEach(function (lang) {
        spec.text[lang] = type === "bubble" ? "双击编辑气泡文字" : "双击编辑文字";
      });
    }
    var layout = ensureLayout();
    pushUndoState();
    layout.elements.push(spec);
    writeLocalEdits();
    updateStatus();
    applyLayout();
    selectLayoutTarget({ kind: "overlay", id: spec.id });
    if (type === "image") openOverlayImageEditor(spec);
    else if (type === "text" || type === "bubble") openOverlayTextEditing(spec);
    closeAddElementMenu();
  }

  function renderHiddenRestorePanel() {
    var layout = effectiveLayout();
    hiddenPanel.innerHTML = "";
    var title = document.createElement("h3");
    title.textContent = "已删除的元素";
    hiddenPanel.appendChild(title);
    if (!layout.hidden.length) {
      var empty = document.createElement("p");
      empty.className = "inline-sync-note";
      empty.textContent = "当前没有已删除的元素。";
      hiddenPanel.appendChild(empty);
    }
    layout.hidden.forEach(function (key) {
      var row = document.createElement("div");
      row.className = "hidden-restore-row";
      var label = document.createElement("span");
      var record = moveRecords.find(function (item) { return item.key === key; });
      label.textContent = record ? record.label : key;
      var restore = document.createElement("button");
      restore.type = "button";
      restore.textContent = "恢复";
      restore.addEventListener("click", function () {
        var editLayout = ensureLayout();
        if (editLayout.hidden.indexOf(key) !== -1) pushUndoState("unhide:" + key);
        editLayout.hidden = editLayout.hidden.filter(function (item) { return item !== key; });
        writeLocalEdits();
        updateStatus();
        applyLayout();
        renderHiddenRestorePanel();
      });
      row.appendChild(label);
      row.appendChild(restore);
      hiddenPanel.appendChild(row);
    });
    var closeRow = document.createElement("div");
    closeRow.className = "inline-sync-actions";
    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "关闭";
    close.addEventListener("click", closeHiddenRestorePanel);
    closeRow.appendChild(close);
    hiddenPanel.appendChild(closeRow);
    var rect = hiddenRestoreButton.getBoundingClientRect();
    hiddenPanel.style.left = Math.max(8, rect.left) + "px";
    hiddenPanel.style.bottom = (window.innerHeight - rect.top + 10) + "px";
    hiddenPanel.hidden = false;
  }

  /* ---------- layout editing: overlay text & image editing ---------- */

  function openOverlayTextEditing(spec) {
    var node = overlayNodes[spec.id];
    if (!node) return;
    closeImageEditor();
    if (activeTextRecord) commitTextEditing(true);
    if (activeOverlayText && activeOverlayText.spec !== spec) commitOverlayTextEditing(true);
    var saved = spec.text && spec.text[activeLang] !== undefined ? spec.text[activeLang] : "";
    activeOverlayText = { spec: spec, node: node, saved: saved };
    node.setAttribute("contenteditable", "plaintext-only");
    node.focus();
    focusEnd(node);
    setStatus("正在编辑叠加文字，点击空白保存，Esc 取消。");
  }

  function commitOverlayTextEditing(save) {
    if (!activeOverlayText) return;
    var record = activeOverlayText;
    activeOverlayText = null;
    var value = record.node.textContent || "";
    record.node.removeAttribute("contenteditable");
    if (save) {
      var spec = overlaySpecForEdit(record.spec.id);
      if (spec && value !== record.saved) {
        pushUndoState("ovtext:" + activeLang + ":" + record.spec.id);
        spec.text = spec.text || {};
        spec.text[activeLang] = value;
        writeLocalEdits();
        updateStatus();
      }
    } else {
      record.node.textContent = record.saved;
    }
  }

  function openOverlayImageEditor(spec) {
    var node = overlayNodes[spec.id];
    if (!node) return;
    if (activeOverlayText) commitOverlayTextEditing(true);
    imageEditTarget = { overlayId: spec.id };
    var record = {
      key: "ov:" + spec.id,
      label: "叠加图片",
      element: node.querySelector("img"),
      initial: spec.src || "",
      slotRatio: spec.w > 0 && spec.h > 0 ? spec.w / spec.h : 16 / 10
    };
    openImageEditor(record);
  }

  /* ---------- layout editing: drag & resize controller ---------- */

  function onLayoutPointerDown(event) {
    layoutDragSuppressClick = false;
    if (!editingEnabled || publishState.phase !== "idle") return;
    if (event.button !== 0 && event.pointerType === "mouse") return;
    var target = event.target;
    if (!target || !target.closest) return;
    if (target.closest("#siteEditor, #inlineImageEditor, #inlineTokenPanel, #layoutInspector, #addElementMenu, #hiddenRestorePanel, .nwd-handle")) return;
    if (target.closest("[contenteditable]")) return;
    var overlayNode = target.closest(".nwd-ov");
    var moveTarget = overlayNode || target.closest("[data-editor-key], [data-move-key]");
    if (!moveTarget) return;
    if (overlayNode && !layoutSpecById(overlayNode.getAttribute("data-ov-id"))) return;
    if (!overlayNode) event.preventDefault();
    layoutDragState = {
      target: moveTarget,
      kind: overlayNode ? "overlay" : "existing",
      key: overlayNode ? null : (moveTarget.getAttribute("data-editor-key") || moveTarget.getAttribute("data-move-key")),
      overlayId: overlayNode ? overlayNode.getAttribute("data-ov-id") : null,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      dx: 0,
      dy: 0,
      snapX: 0,
      snapY: 0
    };
    if (layoutDragState.kind === "existing") {
      var effective = edits.layout && edits.layout.moves ? edits.layout.moves[layoutDragState.key] : null;
      layoutDragState.baseDx = (effective && effective.dx) || 0;
      layoutDragState.baseDy = (effective && effective.dy) || 0;
    }
    try { moveTarget.setPointerCapture(event.pointerId); } catch (error) {}
  }

  function onLayoutPointerMove(event) {
    if (layoutResizeState) {
      applyResizeLive(event);
      return;
    }
    if (!layoutDragState) return;
    var dx = event.clientX - layoutDragState.startX;
    var dy = event.clientY - layoutDragState.startY;
    if (!layoutDragState.dragging) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      layoutDragState.dragging = true;
      document.documentElement.classList.add("is-layout-dragging");
      try { window.getSelection().removeAllRanges(); } catch (error) {}
    }
    layoutDragState.dx = dx;
    layoutDragState.dy = dy;
    var host = layoutDragState.kind === "overlay" ? snapHostForOverlay(layoutDragState.overlayId) : snapHostForElement(layoutDragState.target);
    var hostRect = host ? host.getBoundingClientRect() : null;
    var movingRect = null;
    var overlaySpec = null;
    var overlayNode = null;
    if (layoutDragState.kind === "existing") {
      layoutDragState.target.style.translate = (layoutDragState.baseDx + dx) + "px " + (layoutDragState.baseDy + dy) + "px";
      var liveRect = layoutDragState.target.getBoundingClientRect();
      movingRect = { left: liveRect.left, top: liveRect.top, width: liveRect.width, height: liveRect.height };
    } else {
      overlaySpec = layoutSpecById(layoutDragState.overlayId);
      overlayNode = overlayNodes[layoutDragState.overlayId];
      if (overlaySpec && overlayNode && hostRect) {
        movingRect = { left: hostRect.left + overlaySpec.x + dx, top: hostRect.top + overlaySpec.y + dy, width: overlaySpec.w, height: overlaySpec.h };
      }
    }
    if (host && hostRect && movingRect) {
      var snap = computeDragSnap(layoutDragState, movingRect, host, hostRect);
      layoutDragState.snapX = snap.x;
      layoutDragState.snapY = snap.y;
      if (layoutDragState.kind === "existing") {
        if (snap.x || snap.y) {
          layoutDragState.target.style.translate = (layoutDragState.baseDx + dx + snap.x) + "px " + (layoutDragState.baseDy + dy + snap.y) + "px";
        }
      } else if (overlaySpec && overlayNode) {
        overlayNode.style.left = (overlaySpec.x + dx + snap.x) + "px";
        overlayNode.style.top = (overlaySpec.y + dy + snap.y) + "px";
      }
      renderSnapGuides(host, snap.guides);
    } else {
      layoutDragState.snapX = 0;
      layoutDragState.snapY = 0;
      clearSnapGuides();
    }
    if (selectedLayoutTarget) positionInspector();
    if (selectedLayoutTarget && selectedLayoutTarget.kind === "existing") positionFloatingHandle();
  }

  function onLayoutPointerUp(event) {
    if (layoutResizeState) {
      commitResize(event);
      return;
    }
    if (!layoutDragState) return;
    var state = layoutDragState;
    layoutDragState = null;
    document.documentElement.classList.remove("is-layout-dragging");
    try {
      if (state.target.hasPointerCapture(event.pointerId)) state.target.releasePointerCapture(event.pointerId);
    } catch (error) {}
    if (!state.dragging) return;
    layoutDragSuppressClick = true;
    clearSnapGuides();
    if (state.kind === "existing") {
      var dx = Math.round(state.baseDx + state.dx + (state.snapX || 0));
      var dy = Math.round(state.baseDy + state.dy + (state.snapY || 0));
      var layout = ensureLayout();
      var previousMove = layout.moves[state.key] || null;
      var nextMove = (dx || dy) ? { dx: dx, dy: dy } : null;
      if (previousMove || nextMove) pushUndoState("move:" + state.key);
      if (nextMove) layout.moves[state.key] = nextMove;
      else delete layout.moves[state.key];
      writeLocalEdits();
      updateStatus();
      selectLayoutTarget({ kind: "existing", key: state.key, element: state.target });
    } else {
      var layout2 = ensureLayout();
      var spec = layout2.elements.find(function (el) { return el.id === state.overlayId; });
      if (spec) {
        var netDx = Math.round(state.dx + (state.snapX || 0));
        var netDy = Math.round(state.dy + (state.snapY || 0));
        if (netDx || netDy) {
          pushUndoState("ovmove:" + state.overlayId);
          spec.x = Math.round(spec.x + netDx);
          spec.y = Math.round(spec.y + netDy);
        }
      }
      writeLocalEdits();
      updateStatus();
      selectLayoutTarget({ kind: "overlay", id: state.overlayId });
    }
  }

  function onLayoutPointerCancel(event) {
    clearSnapGuides();
    if (layoutDragState && layoutDragState.dragging) {
      var state = layoutDragState;
      if (state.kind === "existing") {
        state.target.style.translate = state.baseDx + "px " + state.baseDy + "px";
      } else {
        var spec = layoutSpecById(state.overlayId);
        var node = overlayNodes[state.overlayId];
        if (spec && node) {
          node.style.left = spec.x + "px";
          node.style.top = spec.y + "px";
        }
      }
      layoutDragSuppressClick = true;
    }
    if (layoutResizeState) cancelResize();
    layoutDragState = null;
    document.documentElement.classList.remove("is-layout-dragging");
  }

  function startResize(event) {
    if (!editingEnabled || publishState.phase !== "idle") return;
    if (!selectedLayoutTarget) return;
    var isOverlay = selectedLayoutTarget.kind === "overlay";
    var element = isOverlay ? overlayNodes[selectedLayoutTarget.id] : selectedLayoutTarget.element;
    if (!element) return;
    layoutResizeState = {
      isOverlay: isOverlay,
      element: element,
      startX: event.clientX,
      startY: event.clientY,
      startW: element.offsetWidth,
      startH: element.offsetHeight
    };
    event.preventDefault();
    event.stopPropagation();
    try { event.target.setPointerCapture(event.pointerId); } catch (error) {}
  }

  function applyResizeLive(event) {
    var state = layoutResizeState;
    var rawW = Math.max(16, Math.round(state.startW + event.clientX - state.startX));
    var rawH = Math.max(8, Math.round(state.startH + event.clientY - state.startY));
    var host = state.isOverlay
      ? snapHostForOverlay(selectedLayoutTarget && selectedLayoutTarget.id)
      : snapHostForElement(state.element);
    var hostRect = host ? host.getBoundingClientRect() : null;
    var snap = { w: 0, h: 0, guides: [] };
    if (host && hostRect) snap = computeResizeSnap(state, rawW, rawH, host, hostRect);
    var w = Math.max(8, Math.round(rawW + snap.w));
    var h = Math.max(4, Math.round(rawH + snap.h));
    state.newW = w;
    state.newH = h;
    state.element.style.width = w + "px";
    state.element.style.height = h + "px";
    if (host && hostRect) renderSnapGuides(host, snap.guides);
    else clearSnapGuides();
    positionInspector();
    if (!state.isOverlay) positionFloatingHandle();
  }

  function commitResize() {
    var state = layoutResizeState;
    layoutResizeState = null;
    clearSnapGuides();
    if (!state || !selectedLayoutTarget || (state.newW === undefined && state.newH === undefined)) return;
    if (state.isOverlay) {
      var layout = ensureLayout();
      var spec = layout.elements.find(function (el) { return el.id === selectedLayoutTarget.id; });
      if (spec) {
        if (state.newW !== spec.w || state.newH !== spec.h) pushUndoState("ovsize:" + selectedLayoutTarget.id);
        spec.w = state.newW || spec.w;
        spec.h = state.newH || spec.h;
      }
    } else {
      var key = selectedLayoutTarget.key;
      var layout2 = ensureLayout();
      var previousSize = layout2.sizes[key];
      if (!previousSize || previousSize.w !== state.newW || previousSize.h !== state.newH) pushUndoState("size:" + key);
      layout2.sizes[key] = { w: state.newW || state.startW, h: state.newH || state.startH };
    }
    layoutDragSuppressClick = true;
    writeLocalEdits();
    updateStatus();
    positionInspector();
    if (!state.isOverlay) positionFloatingHandle();
  }

  function cancelResize() {
    var state = layoutResizeState;
    layoutResizeState = null;
    clearSnapGuides();
    if (!state) return;
    state.element.style.removeProperty("width");
    state.element.style.removeProperty("height");
    applyLayout();
    positionInspector();
    if (!state.isOverlay) positionFloatingHandle();
  }

  /* ---------- layout editing: snap guides ---------- */

  var SNAP_THRESHOLD = 7;
  var guideNodes = [];
  var guideHostNode = null;

  function clearSnapGuides() {
    guideNodes.forEach(function (node) { node.remove(); });
    guideNodes = [];
    if (guideHostNode) {
      if (guideHostNode.hasAttribute("data-ed-guide-host") && !guideHostNode.hasAttribute("data-ed-layout-host")) {
        guideHostNode.removeAttribute("data-ed-guide-host");
        guideHostNode.style.removeProperty("position");
      }
      guideHostNode = null;
    }
  }

  function snapHostForOverlay(overlayId) {
    var spec = layoutSpecById(overlayId);
    return spec ? resolveAnchor(spec.anchor) : null;
  }

  function snapHostForElement(element) {
    if (!element || !element.closest) return null;
    return element.closest("main section") || element.closest("footer") || null;
  }

  function guideBoxRect(host) {
    if (!host) return null;
    var inner = host.querySelector(":scope > .container-wide, :scope > .hero-content");
    if (inner) {
      var innerRect = inner.getBoundingClientRect();
      if (innerRect.width > 80 && innerRect.height > 40) return innerRect;
    }
    return host.getBoundingClientRect();
  }

  function snapCandidates(box, siblings, axis) {
    var list = [];
    if (axis === "x") {
      list.push(box.left, box.left + box.width / 2, box.left + box.width);
      siblings.forEach(function (rect) {
        list.push(rect.left, rect.left + rect.width / 2, rect.left + rect.width);
      });
    } else {
      list.push(box.top, box.top + box.height / 2, box.top + box.height);
      siblings.forEach(function (rect) {
        list.push(rect.top, rect.top + rect.height / 2, rect.top + rect.height);
      });
    }
    return list;
  }

  function pickSnap(edges, candidates) {
    var best = null;
    for (var i = 0; i < edges.length; i += 1) {
      for (var j = 0; j < candidates.length; j += 1) {
        var diff = candidates[j] - edges[i];
        if (Math.abs(diff) < (best ? Math.abs(best.diff) : SNAP_THRESHOLD)) {
          best = { diff: diff, at: candidates[j] };
        }
      }
    }
    return best;
  }

  function overlaySiblings(host, selfId) {
    var rects = [];
    if (!host) return rects;
    Object.keys(overlayNodes).forEach(function (id) {
      if (id === selfId) return;
      var node = overlayNodes[id];
      if (!node || node.parentNode !== host) return;
      rects.push(node.getBoundingClientRect());
    });
    return rects;
  }

  function computeDragSnap(state, movingRect, host, hostRect) {
    var snap = { x: 0, y: 0, guides: [] };
    var box = guideBoxRect(host);
    if (!box) return snap;
    var siblings = state.kind === "overlay" ? overlaySiblings(host, state.overlayId) : [];
    var snapX = pickSnap(
      [movingRect.left, movingRect.left + movingRect.width / 2, movingRect.left + movingRect.width],
      snapCandidates(box, siblings, "x")
    );
    if (snapX) {
      snap.x = snapX.diff;
      snap.guides.push({ axis: "v", pos: snapX.at - hostRect.left });
    }
    var snapY = pickSnap(
      [movingRect.top, movingRect.top + movingRect.height / 2, movingRect.top + movingRect.height],
      snapCandidates(box, siblings, "y")
    );
    if (snapY) {
      snap.y = snapY.diff;
      snap.guides.push({ axis: "h", pos: snapY.at - hostRect.top });
    }
    return snap;
  }

  function computeResizeSnap(state, rawW, rawH, host, hostRect) {
    var snap = { w: 0, h: 0, guides: [] };
    var box = guideBoxRect(host);
    if (!box) return snap;
    var selfId = selectedLayoutTarget && selectedLayoutTarget.kind === "overlay" ? selectedLayoutTarget.id : null;
    var siblings = selfId ? overlaySiblings(host, selfId) : [];
    var rightEdge;
    var bottomEdge;
    if (state.isOverlay) {
      var spec = layoutSpecById(selfId);
      if (!spec) return snap;
      rightEdge = hostRect.left + spec.x + rawW;
      bottomEdge = hostRect.top + spec.y + rawH;
    } else {
      var rect = state.element.getBoundingClientRect();
      rightEdge = rect.left + rawW;
      bottomEdge = rect.top + rawH;
    }
    var snapX = pickSnap([rightEdge], snapCandidates(box, siblings, "x"));
    if (snapX) {
      snap.w = snapX.diff;
      snap.guides.push({ axis: "v", pos: snapX.at - hostRect.left });
    }
    var snapY = pickSnap([bottomEdge], snapCandidates(box, siblings, "y"));
    if (snapY) {
      snap.h = snapY.diff;
      snap.guides.push({ axis: "h", pos: snapY.at - hostRect.top });
    }
    return snap;
  }

  function renderSnapGuides(host, guides) {
    clearSnapGuides();
    if (!host || !guides.length) return;
    if (getComputedStyle(host).position === "static") {
      host.setAttribute("data-ed-guide-host", "");
      host.style.position = "relative";
      guideHostNode = host;
    }
    guides.forEach(function (guide) {
      var node = document.createElement("div");
      node.className = "ed-guide ed-guide-" + guide.axis;
      if (guide.axis === "v") node.style.left = Math.round(guide.pos) + "px";
      else node.style.top = Math.round(guide.pos) + "px";
      host.appendChild(node);
      guideNodes.push(node);
    });
  }

  /* ---------- GitHub API ---------- */

  async function ghApi(method, path, body, tokenOverride) {
    var token = tokenOverride || readToken();
    var init = {
      method: method,
      headers: {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    };
    if (token) init.headers["Authorization"] = "Bearer " + token;
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    var response;
    try {
      response = await fetch(apiBase + path, init);
    } catch (error) {
      throw { status: 0, message: "无法连接 api.github.com。请检查网络；如果用的是内置预览浏览器，请改用 Chrome 或 Edge 打开本页再发布。" };
    }
    var text = await response.text();
    var data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (error) {}
    }
    return { ok: response.ok, status: response.status, data: data, text: text };
  }

  function decodeBase64Utf8(value) {
    var clean = String(value || "").replace(/\s/g, "");
    var binary = atob(clean);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }

  function encodeBase64Utf8(value) {
    var bytes = new TextEncoder().encode(value);
    var binary = "";
    for (var i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function hashString(value) {
    var hash = 0x811c9dc5;
    for (var i = 0; i < value.length; i += 1) {
      hash = Math.imul(hash ^ value.charCodeAt(i), 16777619) >>> 0;
    }
    return ("00000000" + hash.toString(16)).slice(-8);
  }

  function safeImageName(key, dataUrl) {
    var slug = String(key || "image")
      .replace(/^image:/i, "")
      .replace(/\.[a-z0-9]+$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    if (!slug) slug = "image";
    return slug + "-" + hashString(dataUrl) + ".jpg";
  }

  function mergeEdits(remote, changeSet) {
    var merged = {};
    var langs = supportedLangs.slice();
    Object.keys(remote).forEach(function (lang) {
      if (langs.indexOf(lang) === -1 && lang !== "layout") langs.push(lang);
    });
    langs.forEach(function (lang) {
      merged[lang] = Object.assign({}, remote[lang] || {}, changeSet[lang] || {});
    });
    if (changeSet.layout !== undefined) merged.layout = changeSet.layout;
    else if (remote.layout) merged.layout = remote.layout;
    return merged;
  }

  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
    return "{" + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ":" + stableStringify(value[key]);
    }).join(",") + "}";
  }

  /* ---------- token panel ---------- */

  function setTokenState(message, state) {
    tokenStateLine.textContent = message || "";
    tokenStateLine.dataset.state = state || "";
  }

  function renderTokenState() {
    if (!connectButton) return;
    if (readToken() && tokenLogin) {
      connectButton.textContent = "已连接：" + tokenLogin;
    } else if (readToken()) {
      connectButton.textContent = "已连接 GitHub";
    } else {
      connectButton.textContent = "连接 GitHub";
    }
  }

  function openTokenPanel() {
    tokenPanel.hidden = false;
    tokenPanel.classList.add("is-open");
    if (readToken() && tokenLogin) setTokenState("已连接：" + tokenLogin + " ✓", "ok");
    else setTokenState("尚未连接。", "");
    window.setTimeout(function () { tokenInput.focus(); }, 0);
  }

  function closeTokenPanel() {
    tokenPanel.hidden = true;
    tokenPanel.classList.remove("is-open");
  }

  async function connectToken() {
    var token = (tokenInput.value || "").trim();
    if (!token) {
      setTokenState("请先粘贴令牌。", "error");
      return;
    }
    setTokenState("正在验证令牌…", "");
    try {
      var user = await ghApi("GET", "/user", undefined, token);
      if (user.status === 401) { setTokenState("令牌无效，请检查后重试。", "error"); return; }
      if (!user.ok) { setTokenState("读取 GitHub 账号失败（HTTP " + user.status + "）。", "error"); return; }
      var repo = await ghApi("GET", "/repos/" + repoSlug, undefined, token);
      if (repo.status === 404) { setTokenState("令牌访问不到 " + repoSlug + "：创建令牌时请勾选这个仓库。", "error"); return; }
      if (!repo.ok) { setTokenState("读取仓库信息失败（HTTP " + repo.status + "）。", "error"); return; }
      if (repo.data && repo.data.permissions && repo.data.permissions.push === false) {
        setTokenState("令牌缺少写入权限：请重新创建并授予 Contents Read and write。", "error");
        return;
      }
      tokenLogin = (user.data && user.data.login) || "";
      saveToken(token);
      try { window.localStorage.setItem(loginKey, tokenLogin); } catch (error) {}
      renderTokenState();
      setTokenState("已连接：" + tokenLogin + " ✓ 现在可以发布了。", "ok");
      setStatus("GitHub 已连接。", "ok");
      tokenInput.value = "";
    } catch (error) {
      setTokenState(error.message || "连接失败。", "error");
    }
  }

  function disconnectToken() {
    clearToken();
    renderTokenState();
    setTokenState("已断开连接。", "");
    setStatus("已断开 GitHub 连接。", "ok");
  }

  function handleAuthError() {
    clearToken();
    renderTokenState();
    openTokenPanel();
    setStatus("令牌无效或已过期，请重新连接。", "error");
  }

  /* ---------- publishing ---------- */

  function publishStamp() {
    var now = new Date();
    return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  }

  async function uploadPendingImages(changeSet) {
    var replacements = {};
    var tasks = [];
    supportedLangs.forEach(function (lang) {
      var changes = changeSet[lang];
      if (!changes) return;
      Object.keys(changes).forEach(function (key) {
        var value = changes[key];
        if (typeof value !== "string" || value.indexOf("data:") !== 0) return;
        tasks.push({ lang: lang, key: key, value: value });
      });
    });
    for (var i = 0; i < tasks.length; i += 1) {
      var task = tasks[i];
      setStatus("正在上传图片 " + (i + 1) + " / " + tasks.length + "…");
      var name = safeImageName(task.key, task.value);
      var path = imageDir + "/" + name;
      var contentPath = "/repos/" + repoSlug + "/contents/" + path + "?ref=" + encodeURIComponent(branch);
      var existing = await ghApi("GET", contentPath);
      if (!existing.ok && existing.status !== 404) {
        throw { status: existing.status, message: "读取仓库图片失败（HTTP " + existing.status + "）。" };
      }
      var body = {
        message: "Add site editor image " + name,
        content: task.value.replace(/^data:[^,]*,/, ""),
        branch: branch
      };
      if (existing.ok && existing.data && existing.data.sha) body.sha = existing.data.sha;
      var put = await ghApi("PUT", "/repos/" + repoSlug + "/contents/" + path, body);
      if (put.status === 409) {
        var again = await ghApi("GET", contentPath);
        if (again.ok && again.data && again.data.sha) {
          body.sha = again.data.sha;
          put = await ghApi("PUT", "/repos/" + repoSlug + "/contents/" + path, body);
        }
      }
      if (put.status === 401) throw { status: 401 };
      if (!put.ok) throw { status: put.status, message: "图片上传失败（HTTP " + put.status + "）。" };
      changeSet[task.lang][task.key] = path;
      replacements[task.lang] = replacements[task.lang] || {};
      replacements[task.lang][task.key] = { from: task.value, to: path };
    }

    var uploadedByName = {};
    var overlayTasks = [];
    if (changeSet.layout && Array.isArray(changeSet.layout.elements)) {
      changeSet.layout.elements.forEach(function (el) {
        if (el && typeof el.src === "string" && el.src.indexOf("data:") === 0) overlayTasks.push(el);
      });
    }
    for (var j = 0; j < overlayTasks.length; j += 1) {
      var overlayEl = overlayTasks[j];
      var overlayName = "ov-" + hashString(overlayEl.src) + ".jpg";
      var overlayPath = imageDir + "/" + overlayName;
      if (!uploadedByName[overlayName]) {
        setStatus("正在上传叠加图片 " + (j + 1) + " / " + overlayTasks.length + "…");
        var overlayContentPath = "/repos/" + repoSlug + "/contents/" + overlayPath + "?ref=" + encodeURIComponent(branch);
        var overlayExisting = await ghApi("GET", overlayContentPath);
        if (!overlayExisting.ok && overlayExisting.status !== 404) {
          throw { status: overlayExisting.status, message: "读取仓库图片失败（HTTP " + overlayExisting.status + "）。" };
        }
        if (!overlayExisting.ok) {
          var overlayBody = {
            message: "Add site editor overlay image " + overlayName,
            content: overlayEl.src.replace(/^data:[^,]*,/, ""),
            branch: branch
          };
          var overlayPut = await ghApi("PUT", "/repos/" + repoSlug + "/contents/" + overlayPath, overlayBody);
          if (overlayPut.status === 409) {
            var overlayAgain = await ghApi("GET", overlayContentPath);
            if (overlayAgain.ok && overlayAgain.data && overlayAgain.data.sha) {
              overlayBody.sha = overlayAgain.data.sha;
              overlayPut = await ghApi("PUT", "/repos/" + repoSlug + "/contents/" + overlayPath, overlayBody);
            }
          }
          if (overlayPut.status === 401) throw { status: 401 };
          if (!overlayPut.ok) throw { status: overlayPut.status, message: "叠加图片上传失败（HTTP " + overlayPut.status + "）。" };
        }
        uploadedByName[overlayName] = true;
      }
      replacements.layout = replacements.layout || {};
      replacements.layout[overlayEl.id] = { from: overlayEl.src, to: overlayPath };
      overlayEl.src = overlayPath;
    }
    return replacements;
  }

  function pollLiveEdits(expected) {
    var expectedJson = stableStringify(expected);
    var startedAt = Date.now();
    var timer = window.setInterval(function () {
      if (Date.now() - startedAt > 90000) {
        window.clearInterval(timer);
        setBusy("idle");
        setStatus("已提交，Pages 仍在发布中，约一分钟后刷新即可看到。", "ok");
        return;
      }
      fetch(liveEditsUrl + "?t=" + Date.now(), { cache: "no-store" })
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (live) {
          if (!live) return;
          if (stableStringify(live) === expectedJson) {
            window.clearInterval(timer);
            setBusy("idle");
            setStatus("已上线 ✓ 刷新页面即可看到最新内容。", "ok");
          }
        })
        .catch(function () {});
    }, 3000);
  }

  async function publish() {
    if (publishState.phase !== "idle") return;
    if (activeTextRecord) commitTextEditing(true);
    if (activeOverlayText) commitOverlayTextEditing(true);
    closeImageEditor();
    closeTokenPanel();
    if (!readToken()) {
      openTokenPanel();
      setStatus("请先连接 GitHub（仅需一次），连接后即可一键发布。", "ok");
      return;
    }
    var changeSet = buildChangeSet();
    if (!Object.keys(changeSet).length) {
      setStatus("没有待发布的修改。", "ok");
      return;
    }

    var total = countUnsyncedChanges();
    var stamp = publishStamp();

    setBusy("images");
    var replacements;
    try {
      replacements = await uploadPendingImages(changeSet);
    } catch (error) {
      setBusy("idle");
      updateStatus();
      if (error && error.status === 401) handleAuthError();
      else setStatus((error && error.message) || "图片上传失败。", "error");
      return;
    }

    setBusy("commit");
    var committed = null;
    for (var attempt = 0; attempt < 3 && !committed; attempt += 1) {
      try {
        var current = await ghApi("GET", "/repos/" + repoSlug + "/contents/" + remotePath + "?ref=" + encodeURIComponent(branch));
        if (current.status === 401) { setBusy("idle"); handleAuthError(); return; }
        if (!current.ok && current.status !== 404) {
          setBusy("idle");
          setStatus("读取 edits.json 失败（HTTP " + current.status + "）。", "error");
          return;
        }
        var remote = {};
        if (current.ok && current.data && current.data.content) {
          try { remote = JSON.parse(decodeBase64Utf8(current.data.content)); } catch (error) {}
        }
        var merged = mergeEdits(remote, changeSet);
        var put = await ghApi("PUT", "/repos/" + repoSlug + "/contents/" + remotePath, {
          message: "Update site content from editor " + stamp + " (" + total + " changes)",
          content: encodeBase64Utf8(JSON.stringify(merged, null, 2)),
          branch: branch,
          sha: current.ok && current.data ? current.data.sha : undefined
        });
        if (put.status === 401) { setBusy("idle"); handleAuthError(); return; }
        if (put.status === 409) continue;
        if (!put.ok) {
          setBusy("idle");
          var reason = put.data && put.data.message ? "：" + put.data.message : "";
          setStatus("提交失败（HTTP " + put.status + "）" + reason, "error");
          return;
        }
        committed = merged;
      } catch (error) {
        setBusy("idle");
        updateStatus();
        setStatus((error && error.message) || "提交失败。", "error");
        return;
      }
    }
    if (!committed) {
      setBusy("idle");
      setStatus("多次提交都遇到冲突，请稍后重试。", "error");
      return;
    }

    remoteEdits = committed;
    supportedLangs.forEach(function (lang) {
      var langReplacements = replacements[lang] || {};
      edits[lang] = edits[lang] || {};
      Object.keys(langReplacements).forEach(function (key) {
        if (edits[lang][key] === langReplacements[key].from) edits[lang][key] = langReplacements[key].to;
      });
      edits[lang] = Object.assign({}, committed[lang], edits[lang]);
    });
    if (replacements.layout && edits.layout) {
      Object.keys(replacements.layout).forEach(function (id) {
        var replacement = replacements.layout[id];
        edits.layout.elements.forEach(function (el) {
          if (el.id === id && el.src === replacement.from) el.src = replacement.to;
        });
      });
    }
    writeLocalEdits();
    applyAll();

    if (!/^https?:$/.test(window.location.protocol)) {
      setBusy("idle");
      setStatus("已提交到 GitHub。请打开线上网址查看发布效果。", "ok");
      return;
    }
    setBusy("poll");
    setStatus("已提交（" + total + " 处修改），等待 Pages 发布…", "ok");
    pollLiveEdits(committed);
  }

  async function loadRemoteEdits() {
    if (!/^https?:$/.test(window.location.protocol)) return;
    try {
      var response = await fetch(remotePath + "?t=" + Date.now(), { cache: "no-store" });
      if (!response.ok) return;
      remoteEdits = await response.json();
      var local = readLocalEdits();
      supportedLangs.forEach(function (lang) {
        edits[lang] = Object.assign({}, remoteEdits[lang] || {}, local[lang] || {});
      });
      if (local.layout) edits.layout = normalizeLayout(local.layout);
      else if (remoteEdits.layout) edits.layout = normalizeLayout(remoteEdits.layout);
      applyAll();
      updateStatus();
    } catch (error) {
      setStatus("线上内容暂未加载，发布前请先打开线上网址。", "error");
    }
  }

  /* ---------- editor session ---------- */

  function openEditor() {
    editingEnabled = true;
    editorBar.hidden = false;
    editorBar.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("is-editing-site");
    activeLang = document.documentElement.lang || "zh-CN";
    captureBaseline(activeLang);
    setLangButtons();
    updateStatus();
    updateLayoutButtons();
    updateUndoButtons();
  }

  function closeEditor() {
    if (activeTextRecord) commitTextEditing(true);
    if (activeOverlayText) commitOverlayTextEditing(true);
    closeImageEditor();
    closeTokenPanel();
    closeAddElementMenu();
    closeHiddenRestorePanel();
    clearLayoutSelection();
    clearSnapGuides();
    editingEnabled = false;
    editorBar.hidden = true;
    editorBar.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("is-editing-site");
    setStatus("");
    updateLayoutButtons();
    if (window.location.hash === "#editor") {
      try {
        history.replaceState(null, "", window.location.pathname + window.location.search);
      } catch (error) {}
    }
  }

  function toggleEditor() {
    if (editorBar.hidden) openEditor();
    else closeEditor();
  }

  function revertLocalEdits() {
    if (publishState.phase !== "idle") return;
    var n = countUnsyncedChanges();
    if (!n) {
      setStatus("没有可撤销的本地修改。", "ok");
      return;
    }
    if (!window.confirm("确定放弃 " + n + " 处未发布的本地修改？页面会恢复到最近一次发布的内容。（放弃后仍可用 撤销 找回）")) return;
    if (activeTextRecord) commitTextEditing(false);
    if (activeOverlayText) commitOverlayTextEditing(false);
    closeImageEditor();
    clearLayoutSelection();
    pushUndoState();
    edits = {};
    supportedLangs.forEach(function (lang) {
      edits[lang] = Object.assign({}, remoteEdits[lang] || {});
    });
    if (remoteEdits.layout) edits.layout = normalizeLayout(remoteEdits.layout);
    layoutTouched = Boolean(edits.layout);
    writeLocalEdits();
    applyAll();
    updateStatus();
    updateLayoutButtons();
  }

  /* ---------- event wiring ---------- */

  function wireEvents() {
    document.addEventListener("keydown", function (event) {
      var shortcut = event.ctrlKey || event.metaKey;
      if (shortcut && event.shiftKey && (event.key === "E" || event.key === "e")) {
        event.preventDefault();
        toggleEditor();
        return;
      }
      if (!editingEnabled) return;
      if (shortcut && !event.altKey && (event.key === "z" || event.key === "Z" || event.key === "y" || event.key === "Y")) {
        var undoField = event.target && event.target.closest && event.target.closest("input, textarea, [contenteditable]");
        if (undoField) return;
        event.preventDefault();
        if (event.shiftKey || event.key === "y" || event.key === "Y") redoEdit();
        else undoEdit();
        return;
      }
      if (event.key === "Escape") {
        if (activeTextRecord) {
          event.preventDefault();
          commitTextEditing(false);
          return;
        }
        if (activeOverlayText) {
          event.preventDefault();
          commitOverlayTextEditing(false);
          return;
        }
        if (!imagePanel.hidden) {
          closeImageEditor();
          return;
        }
        if (!tokenPanel.hidden) {
          closeTokenPanel();
          return;
        }
        if (!addMenu.hidden) {
          closeAddElementMenu();
          return;
        }
        if (!hiddenPanel.hidden) {
          closeHiddenRestorePanel();
          return;
        }
        if (selectedLayoutTarget) {
          clearLayoutSelection();
          return;
        }
      }
      if (activeTextRecord && event.key === "Enter" && shortcut) {
        event.preventDefault();
        commitTextEditing(true);
        return;
      }
      if (activeOverlayText && event.key === "Enter" && shortcut) {
        event.preventDefault();
        commitOverlayTextEditing(true);
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedLayoutTarget && !activeTextRecord && !activeOverlayText) {
        var activeNode = event.target;
        var isTypingContext = activeNode && activeNode.closest && activeNode.closest("input, textarea, [contenteditable]");
        if (!isTypingContext) {
          event.preventDefault();
          deleteSelectedLayoutTarget();
        }
      }
    });

    document.addEventListener("focusout", function (event) {
      if (activeTextRecord && event.target === activeTextRecord.element) {
        commitTextEditing(true);
        return;
      }
      if (activeOverlayText && event.target === activeOverlayText.node) {
        commitOverlayTextEditing(true);
      }
    });

    document.addEventListener("click", function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      if (layoutDragSuppressClick) {
        layoutDragSuppressClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      var toolTarget = target.closest("#siteEditor, #inlineImageEditor, #inlineTokenPanel, #layoutInspector, #addElementMenu, #hiddenRestorePanel, .nwd-handle");
      if (toolTarget) return;

      if (!editingEnabled) return;
      if (target.closest("[data-set-lang]")) {
        if (activeTextRecord) commitTextEditing(true);
        if (activeOverlayText) commitOverlayTextEditing(true);
        restoreEditsBeforeLanguageSwitch(activeLang);
        return;
      }

      var overlayNode = target.closest(".nwd-ov");
      if (overlayNode) {
        if (activeOverlayText && activeOverlayText.node === overlayNode) return;
        event.preventDefault();
        event.stopPropagation();
        var overlayId = overlayNode.getAttribute("data-ov-id");
        if (layoutSpecById(overlayId)) selectLayoutTarget({ kind: "overlay", id: overlayId });
        return;
      }

      var textElement = target.closest("[data-editor-type='text']");
      var imageElement = target.closest("[data-editor-type='image']");
      var moveElement = target.closest("[data-move-key]");

      if (textElement) {
        event.preventDefault();
        event.stopPropagation();
        if (activeTextRecord && activeTextRecord.element === textElement) return;
        var record = textRecords.find(function (item) { return item.element === textElement; });
        if (record) openTextEditing(record);
        return;
      }

      if (imageElement) {
        event.preventDefault();
        event.stopPropagation();
        selectLayoutTarget({ kind: "existing", key: imageElement.getAttribute("data-editor-key"), element: imageElement });
        var imageRecord = imageRecords.find(function (item) { return item.element === imageElement; });
        if (imageRecord) openImageEditor(imageRecord);
        return;
      }

      if (moveElement) {
        event.preventDefault();
        event.stopPropagation();
        var moveKey = moveElement.getAttribute("data-move-key");
        if (selectedLayoutTarget && selectedLayoutTarget.kind === "existing" && selectedLayoutTarget.key === moveKey) {
          clearLayoutSelection();
        } else {
          selectLayoutTarget({ kind: "existing", key: moveKey, element: moveElement });
        }
        return;
      }

      if (selectedLayoutTarget) clearLayoutSelection();
      closeAddElementMenu();

      if (target.closest("a, button, [data-route], [data-job-id]")) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);

    document.addEventListener("click", function (event) {
      var langButton = event.target.closest && event.target.closest("[data-set-lang]");
      if (langButton) {
        var nextLang = langButton.getAttribute("data-set-lang");
        window.setTimeout(function () { updateActiveLang(nextLang); }, 0);
      }

      var editorLangButton = event.target.closest && event.target.closest("[data-editor-lang]");
      if (editorLangButton) {
        var targetLang = editorLangButton.getAttribute("data-editor-lang");
        var pageButton = document.querySelector('[data-set-lang="' + targetLang + '"]');
        if (pageButton) pageButton.click();
      }
    });

    document.addEventListener("dblclick", function (event) {
      if (!editingEnabled) return;
      var target = event.target;
      if (!target || !target.closest) return;
      var node = target.closest(".nwd-ov-text, .nwd-ov-bubble");
      if (!node) return;
      var spec = layoutSpecById(node.getAttribute("data-ov-id"));
      if (!spec) return;
      event.preventDefault();
      event.stopPropagation();
      selectLayoutTarget({ kind: "overlay", id: spec.id });
      openOverlayTextEditing(spec);
    });

    document.addEventListener("contextmenu", function (event) {
      if (!editingEnabled) return;
      var target = event.target;
      if (!target || !target.closest) return;
      if (target.closest("[contenteditable]")) return;
      if (target.closest("#siteEditor, #inlineImageEditor, #inlineTokenPanel, #layoutInspector, #addElementMenu, #hiddenRestorePanel")) return;
      var overlayNode = target.closest(".nwd-ov");
      var stamped = overlayNode || target.closest("[data-editor-key], [data-move-key]");
      if (!stamped) return;
      event.preventDefault();
      if (overlayNode) {
        var overlayId = overlayNode.getAttribute("data-ov-id");
        if (layoutSpecById(overlayId)) selectLayoutTarget({ kind: "overlay", id: overlayId });
      } else {
        var stampedKey = stamped.getAttribute("data-editor-key") || stamped.getAttribute("data-move-key");
        if (stampedKey) selectLayoutTarget({ kind: "existing", key: stampedKey, element: stamped });
      }
    });

    document.addEventListener("pointerdown", function (event) {
      var target = event.target;
      if (!target || !target.classList || !target.classList.contains("nwd-handle")) return;
      startResize(event);
    }, true);
    document.addEventListener("pointerdown", onLayoutPointerDown, true);
    document.addEventListener("pointermove", onLayoutPointerMove, true);
    document.addEventListener("pointerup", onLayoutPointerUp, true);
    document.addEventListener("pointercancel", onLayoutPointerCancel, true);

    window.addEventListener("scroll", function () {
      if (!editingEnabled) return;
      positionInspector();
      positionFloatingHandle();
    }, true);

    window.addEventListener("beforeunload", function (event) {
      if (countUnsyncedChanges() > 0) {
        event.preventDefault();
        event.returnValue = "";
      }
    });

    revertButton.addEventListener("click", revertLocalEdits);
    publishButton.addEventListener("click", publish);
    connectButton.addEventListener("click", openTokenPanel);
    undoButton.addEventListener("click", undoEdit);
    redoButton.addEventListener("click", redoEdit);
    addElementButton.addEventListener("click", toggleAddElementMenu);
    hiddenRestoreButton.addEventListener("click", renderHiddenRestorePanel);
    addMenu.addEventListener("click", function (event) {
      var item = event.target.closest && event.target.closest("[data-add-type]");
      if (!item) return;
      createOverlayElement(item.getAttribute("data-add-type"));
    });
    editorBar.querySelector("#closeInlineEditor").addEventListener("click", closeEditor);

    tokenPanel.querySelector("#openTokenPage").addEventListener("click", function () {
      var opened = window.open(tokenCreateUrl, "_blank", "noopener,noreferrer");
      if (!opened) setTokenState("浏览器拦截了新窗口，请允许弹窗后重试。", "error");
    });
    tokenPanel.querySelector("#connectToken").addEventListener("click", connectToken);
    tokenPanel.querySelector("#disconnectToken").addEventListener("click", disconnectToken);
    tokenPanel.querySelector("#closeTokenPanel").addEventListener("click", closeTokenPanel);

    imagePanel.querySelector("#closeInlineImage").addEventListener("click", closeImageEditor);
    imagePanel.querySelector("#cancelInlineImage").addEventListener("click", closeImageEditor);
    imagePanel.querySelector("#loadImageUrl").addEventListener("click", function () {
      loadImageSource(imageUrlInput.value.trim());
    });
    imageFileInput.addEventListener("change", function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        imageUrlInput.value = "";
        loadImageSource(reader.result);
      };
      reader.readAsDataURL(file);
    });
    imagePanel.querySelector("#applyCroppedImage").addEventListener("click", function () {
      var dataUrl = cropExportDataUrl();
      if (dataUrl) applyImageValue(dataUrl);
    });
    imagePanel.querySelector("#useRawImage").addEventListener("click", function () {
      if (imageState.rawSource) {
        applyImageValue(imageState.rawSource);
      } else if (imageUrlInput.value.trim()) {
        applyImageValue(imageUrlInput.value.trim());
      } else {
        setStatus("请先选择或载入一张图片。", "error");
      }
    });

    cropZoomInput.addEventListener("input", function () {
      imageState.zoom = Number(cropZoomInput.value) || 1;
      drawCropCanvas();
    });
    imagePanel.querySelector("#cropResetButton").addEventListener("click", function () {
      imageState.zoom = 1;
      imageState.panX = 0;
      imageState.panY = 0;
      cropZoomInput.value = "1";
      drawCropCanvas();
    });

    cropViewport.addEventListener("pointerdown", function (event) {
      if (!imageState.image) return;
      event.preventDefault();
      imageState.dragging = true;
      imageState.dragStartX = event.clientX;
      imageState.dragStartY = event.clientY;
      imageState.panStartX = imageState.panX;
      imageState.panStartY = imageState.panY;
      cropViewport.setPointerCapture(event.pointerId);
    });
    cropViewport.addEventListener("pointermove", function (event) {
      if (!imageState.dragging || !imageState.image) return;
      imageState.panX = imageState.panStartX + event.clientX - imageState.dragStartX;
      imageState.panY = imageState.panStartY + event.clientY - imageState.dragStartY;
      drawCropCanvas();
    });
    cropViewport.addEventListener("pointerup", function (event) {
      imageState.dragging = false;
      if (cropViewport.hasPointerCapture(event.pointerId)) cropViewport.releasePointerCapture(event.pointerId);
    });
    cropViewport.addEventListener("pointercancel", function () {
      imageState.dragging = false;
    });

    window.addEventListener("resize", function () {
      if (editingEnabled && !imagePanel.hidden && imageState.image) {
        window.requestAnimationFrame(prepareCropCanvas);
      }
      if (editingEnabled) {
        positionInspector();
        positionFloatingHandle();
      }
    });

    window.addEventListener("hashchange", function () {
      if (window.location.hash === "#editor" && editorBar.hidden) openEditor();
    });
  }

  /* ---------- init ---------- */

  buildToolbar();
  buildImagePanel();
  buildTokenPanel();
  buildLayoutUI();
  wireEvents();

  try {
    tokenLogin = window.localStorage.getItem(loginKey) || "";
  } catch (error) {
    tokenLogin = "";
  }
  renderTokenState();

  buildCatalog();
  edits = readLocalEdits();
  if (edits.layout) {
    edits.layout = normalizeLayout(edits.layout);
    layoutTouched = true;
  }
  setLangButtons();
  applyEdits();
  applyLayout();
  loadRemoteEdits();

  if (window.location.hash === "#editor") openEditor();
})();
