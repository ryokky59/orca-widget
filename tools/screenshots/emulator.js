// Scriptable のウィジェット API をブラウザでまねて、OrcaStatus.js をそのまま描画する。
// README 用のスクリーンショットを作るためだけのもの。実機の見た目とは細部が違う。
(function () {
  let THEME = "light"; // Color.dynamic の切り替え
  let MONO = false; // ロック画面: iOS は色を白一色にする

  // ---- 値の型 ----
  class Color {
    constructor(hex, alpha = 1) {
      const h = String(hex).replace("#", "");
      const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
      this.r = parseInt(full.slice(0, 2), 16);
      this.g = parseInt(full.slice(2, 4), 16);
      this.b = parseInt(full.slice(4, 6), 16);
      this.alpha = alpha;
    }
    css() {
      if (MONO) return `rgba(255,255,255,${this.alpha})`;
      return `rgba(${this.r},${this.g},${this.b},${this.alpha})`;
    }
    static dynamic(light, dark) {
      return { css: () => (THEME === "dark" ? dark : light).css() };
    }
    static white() { return new Color("#ffffff"); }
    static black() { return new Color("#000000"); }
    static clear() { return new Color("#000000", 0); }
  }
  const css = (c) => (c ? c.css() : null);

  class Size { constructor(w, h) { this.width = w; this.height = h; } }
  class Point { constructor(x, y) { this.x = x; this.y = y; } }
  class Rect {
    constructor(x, y, w, h) { this.x = x; this.y = y; this.width = w; this.height = h; }
  }

  const WEIGHTS = { regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800 };
  function mkFont(size, weight, rounded) { return { size, weight, rounded }; }
  const Font = {};
  for (const [w, n] of Object.entries(WEIGHTS)) {
    const base = w === "regular" ? "systemFont" : `${w}SystemFont`;
    Font[base] = (s) => mkFont(s, n, false);
    Font[w === "regular" ? "regularRoundedSystemFont" : `${w}RoundedSystemFont`] = (s) => mkFont(s, n, true);
  }
  const fontCSS = (f) =>
    `${f.weight} ${f.size}px ${f.rounded ? '"SF Pro Rounded", ui-rounded, ' : ""}-apple-system, "SF Pro Text", "Hiragino Sans", sans-serif`;

  class DateFormatter {
    string(d) {
      const pad = (n) => String(n).padStart(2, "0");
      return (this.dateFormat || "HH:mm").replace(/E|HH|H|mm/g, (t) =>
        t === "E" ? "日月火水木金土"[d.getDay()] : t === "HH" ? pad(d.getHours()) : t === "H" ? d.getHours() : pad(d.getMinutes()));
    }
  }

  // ---- 描画 (DrawContext) ----
  class Path {
    constructor() { this.ops = []; }
    addRoundedRect(r, rw, rh) { this.ops.push(["rr", r, Math.min(rw, rh)]); }
    addRect(r) { this.ops.push(["rr", r, 0]); }
    addEllipse(r) { this.ops.push(["el", r]); }
    addLines(pts) { this.ops.push(["ln", pts]); }
  }
  const SCALE = 3;
  class DrawContext {
    constructor() { this.size = new Size(100, 100); this._path = null; this._lw = 1; this._center = false; }
    _c() {
      if (!this._canvas) {
        this._canvas = document.createElement("canvas");
        this._canvas.width = this.size.width * SCALE;
        this._canvas.height = this.size.height * SCALE;
        this._g = this._canvas.getContext("2d");
        this._g.scale(SCALE, SCALE);
      }
      return this._g;
    }
    _trace(p) {
      const g = this._c();
      g.beginPath();
      for (const op of p.ops) {
        if (op[0] === "rr") { const r = op[1]; g.roundRect(r.x, r.y, r.width, r.height, op[2]); }
        else if (op[0] === "el") { const r = op[1]; g.ellipse(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, r.height / 2, 0, 0, Math.PI * 2); }
        else if (op[0] === "ln") { op[1].forEach((pt, i) => (i ? g.lineTo(pt.x, pt.y) : g.moveTo(pt.x, pt.y))); }
      }
    }
    addPath(p) { this._path = p; }
    setFillColor(c) { this._c().fillStyle = css(c); }
    setStrokeColor(c) { this._c().strokeStyle = css(c); }
    setLineWidth(w) { this._c().lineWidth = w; }
    fillPath() { if (this._path) { this._trace(this._path); this._c().fill(); this._path = null; } }
    strokePath() { if (this._path) { this._trace(this._path); this._c().lineCap = "round"; this._c().stroke(); this._path = null; } }
    fillRect(r) { this._c().fillRect(r.x, r.y, r.width, r.height); }
    strokeEllipse(r) { const p = new Path(); p.addEllipse(r); this._trace(p); this._c().stroke(); }
    fillEllipse(r) { const p = new Path(); p.addEllipse(r); this._trace(p); this._c().fill(); }
    setTextAlignedCenter() { this._center = true; }
    setTextAlignedLeft() { this._center = false; }
    setTextColor(c) { this._textColor = c; }
    setFont(f) { this._font = f; }
    drawTextInRect(text, r) {
      const g = this._c();
      g.save();
      g.font = fontCSS(this._font || Font.systemFont(12));
      g.fillStyle = css(this._textColor || Color.black());
      g.textBaseline = "top";
      g.textAlign = this._center ? "center" : "left";
      g.fillText(text, this._center ? r.x + r.width / 2 : r.x, r.y);
      g.restore();
    }
    getImage() { this._c(); return { src: this._canvas.toDataURL("image/png"), size: this.size }; }
  }

  // ---- ウィジェットの木 ----
  class WText {
    constructor(text) { this.kind = "text"; this.text = text; this.font = Font.systemFont(17); this.lineLimit = 0; this.minimumScaleFactor = 1; this.align = "left"; }
    centerAlignText() { this.align = "center"; }
    leftAlignText() { this.align = "left"; }
    rightAlignText() { this.align = "right"; }
  }
  class WImage {
    constructor(img) { this.kind = "image"; this.img = img; this.imageSize = null; }
  }
  class WStack {
    constructor(vertical = false) {
      this.kind = "stack"; this.vertical = vertical; this.align = "top"; this.children = [];
      this.padding = [0, 0, 0, 0]; this.size = null; this.backgroundColor = null; this.cornerRadius = 0; this.spacing = 0;
    }
    layoutHorizontally() { this.vertical = false; }
    layoutVertically() { this.vertical = true; }
    topAlignContent() { this.align = "top"; }
    centerAlignContent() { this.align = "center"; }
    bottomAlignContent() { this.align = "bottom"; }
    setPadding(t, l, b, r) { this.padding = [t, l, b, r]; }
    useDefaultPadding() {}
    addStack() { const s = new WStack(); this.children.push(s); return s; }
    addText(t) { const n = new WText(String(t)); this.children.push(n); return n; }
    addImage(img) { const n = new WImage(img); this.children.push(n); return n; }
    addSpacer(len) { const n = { kind: "spacer", len: len == null ? null : len }; this.children.push(n); return n; }
  }
  class ListWidget extends WStack {
    constructor() { super(true); this.padding = [16, 16, 16, 16]; }
    async presentLarge() {}
    async presentMedium() {}
    async presentSmall() {}
  }

  // 伸びたがるか（SwiftUI の Spacer は親を目いっぱいまで広げる）
  function wants(n) {
    if (n.kind !== "stack") return { w: false, h: false };
    let w = false, h = false;
    for (const c of n.children) {
      if (c.kind === "spacer" && c.len == null) { if (n.vertical) h = true; else w = true; }
      const cw = wants(c);
      w = w || cw.w; h = h || cw.h;
    }
    if (n.size && n.size.width > 0) w = false;
    if (n.size && n.size.height > 0) h = false;
    return { w, h };
  }

  function renderNode(n, parentVertical) {
    let el;
    if (n.kind === "spacer") {
      el = document.createElement("div");
      el.style.flex = n.len == null ? "1 1 0" : `0 0 ${n.len}px`;
      el.style.minWidth = el.style.minHeight = "0";
      return el;
    }
    if (n.kind === "text") {
      el = document.createElement("div");
      el.className = "wtext";
      el.textContent = n.text;
      el.style.font = fontCSS(n.font);
      el.style.lineHeight = "1.2";
      el.style.color = css(n.textColor) || (MONO || THEME === "dark" ? "#fff" : "#000");
      el.style.textAlign = n.align;
      el.style.flex = "0 1 auto";
      el.style.minWidth = "0";
      el.style.maxWidth = "100%";
      if (n.lineLimit === 1) { el.style.whiteSpace = "pre"; el.style.overflow = "hidden"; el.style.textOverflow = "ellipsis"; }
      el.dataset.size = n.font.size;
      el.dataset.min = n.minimumScaleFactor;
      return el;
    }
    if (n.kind === "image") {
      el = document.createElement("img");
      el.src = n.img.src;
      const s = n.imageSize || n.img.size;
      el.style.width = s.width + "px";
      el.style.height = s.height + "px";
      el.style.flex = "0 0 auto";
      return el;
    }
    el = document.createElement("div");
    el.style.display = "flex";
    el.style.flexDirection = n.vertical ? "column" : "row";
    el.style.alignItems = { top: "flex-start", center: "center", bottom: "flex-end" }[n.align];
    el.style.gap = n.spacing ? n.spacing + "px" : "0";
    const [t, l, b, r] = n.padding;
    el.style.padding = `${t}px ${r}px ${b}px ${l}px`;
    el.style.boxSizing = "border-box";
    el.style.minWidth = el.style.minHeight = "0";
    if (n.backgroundColor) el.style.background = css(n.backgroundColor);
    if (n.cornerRadius) { el.style.borderRadius = n.cornerRadius + "px"; el.style.overflow = "hidden"; }
    const want = wants(n);
    if (n.size && n.size.width > 0) el.style.width = n.size.width + "px";
    if (n.size && n.size.height > 0) el.style.height = n.size.height + "px";
    if (parentVertical != null) {
      const main = parentVertical ? want.h : want.w;
      const cross = parentVertical ? want.w : want.h;
      el.style.flex = main ? "1 1 0" : "0 1 auto";
      if (cross) el.style.alignSelf = "stretch";
    }
    for (const c of n.children) el.appendChild(renderNode(c, n.vertical));
    return el;
  }

  // minimumScaleFactor: はみ出す文字は指定の割合まで縮める
  function shrinkTexts(root) {
    for (const el of root.querySelectorAll(".wtext")) {
      const base = +el.dataset.size, min = +el.dataset.min;
      if (!(min < 1)) continue;
      let size = base;
      while (el.scrollWidth > el.clientWidth + 0.5 && size > base * min) {
        size = Math.max(base * min, size - 0.25);
        el.style.fontSize = size + "px";
      }
    }
  }

  // OrcaStatus.js を 1 回実行して、できたウィジェットを DOM にする
  async function renderWidget(src, opts) {
    THEME = opts.theme || "light";
    MONO = !!opts.mono;
    let result = null;
    const g = window;
    Object.assign(g, {
      Color, Size, Point, Rect, Font, DateFormatter, DrawContext, Path, ListWidget,
      config: { widgetFamily: opts.family, runsInWidget: true, runsInAccessoryWidget: opts.family.startsWith("accessory") },
      args: { widgetParameter: opts.parameter ?? "demo" },
      Script: { setWidget: (w) => (result = w), complete: () => {} },
      FileManager: { local: () => ({ joinPath: (a, b) => b, documentsDirectory: () => "", fileExists: () => false, writeString() {}, readString: () => "" }) },
      Request: class { async loadJSON() { throw new Error("offline"); } },
    });
    const run = new (Object.getPrototypeOf(async function () {}).constructor)(src);
    await run();
    const w = result;
    const el = renderNode(w, null);
    el.style.width = opts.width + "px";
    el.style.height = opts.height + "px";
    el.style.alignItems = opts.family === "accessoryCircular" ? "center" : "flex-start";
    if (opts.family === "accessoryCircular") el.style.justifyContent = "center";
    if (!opts.family.startsWith("accessory")) {
      el.style.background = css(w.backgroundColor);
      el.style.borderRadius = "22px";
      el.style.overflow = "hidden";
    } else {
      el.style.padding = "0";
      if (w.addAccessoryWidgetBackground) { el.style.background = "rgba(255,255,255,.16)"; el.style.borderRadius = "50%"; }
    }
    return el;
  }

  window.ScriptableEmu = { renderWidget, shrinkTexts };
})();
