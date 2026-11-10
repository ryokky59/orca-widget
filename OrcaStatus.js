// Orca 稼働状況ウィジェット（Scriptable 用）
// Mac の server.py に Tailscale 経由でアクセスして表示する。
// ホーム画面（小・中・大）とロック画面（丸・長方形・1行）に対応。

// Mac の Tailscale IP（Mac で ./install.sh を実行すると表示される）。
// ウィジェットの「Parameter」欄に IP を入れれば、ここは空のままでよい。
const MAC_HOST = "";
const PORT = 8765;
const HOST = String((typeof args !== "undefined" && args.widgetParameter) || MAC_HOST).trim();
const URL_STATUS = `http://${HOST}:${PORT}/status`;
const CACHE_FILE = "orca-status-cache.json";
const REFRESH_MIN = 5;
// iPhone の Orca アプリ内での Mac のホスト ID（例: "host-1792051353050"）。
// 空のままならタップで Orca アプリのホームが開く。調べ方は README 参照。
const ORCA_HOST_ID = "";
// 入力待ち・承認待ちがこの分数を超えたら赤で強調する
const LONG_WAIT_MIN = 30;

// 色は [ライト, ダーク] の組で持つ。状態の色はそのまま文字・帯・うすい背景に使う
const PAL = {
  working: ["#2f7df6", "#5aa2ff"],
  attention: ["#f08a00", "#ffa424"],
  error: ["#e5383b", "#ff6259"],
  done: ["#1fa85a", "#3ddc84"],
  idle: ["#8e8e93", "#8e8e93"],
};

function dyn(pair, alpha = 1) {
  return Color.dynamic(new Color(pair[0], alpha), new Color(pair[1], alpha));
}

const C = {
  bg: dyn(["#ffffff", "#141518"]),
  // 要対応があるときの背景（うっすら橙）
  attentionBg: dyn(["#fff6ea", "#221a11"]),
  text: dyn(["#16171a", "#f4f4f6"]),
  sub: dyn(["#70727a", "#9b9da6"]),
  // カードやバーの下地。背景色が変わってもなじむよう半透明にする
  card: Color.dynamic(new Color("#000000", 0.045), new Color("#ffffff", 0.075)),
  track: Color.dynamic(new Color("#000000", 0.09), new Color("#ffffff", 0.14)),
  // 使用量バーの平常時の色（80% を超えるまでは色をつけない）
  meter: dyn(["#5b5d66", "#c6c8d0"]),
};
for (const k in PAL) C[k] = dyn(PAL[k]);

const STATE_LABEL = {
  working: "稼働中",
  waiting: "入力待ち",
  "needs-input": "入力待ち",
  blocked: "承認待ち",
  error: "エラー",
  done: "完了",
  idle: "待機",
};

// 状態 → PAL のキー
function stateKey(s) {
  if (s === "working") return "working";
  if (s === "error") return "error";
  if (["waiting", "blocked", "needs-input"].includes(s)) return "attention";
  if (s === "done") return "done";
  return "idle";
}

function isLongWait(a) {
  return a.attention && a.since && Date.now() - a.since > LONG_WAIT_MIN * 60000;
}

function rowKey(a) {
  return isLongWait(a) ? "error" : stateKey(a.state);
}

// 例: 「承認待ち · Bash · 12分」「稼働中 +2 · 3分」
function stateText(a, withAgo = true) {
  let t = STATE_LABEL[a.state] || a.state;
  if (a.subagentsWorking) t += ` +${a.subagentsWorking}`;
  if (a.state === "done" && a.unread) t += "・未読";
  if (a.attention && a.tool) t += ` · ${a.tool}`;
  if (withAgo && a.since) t += ` · ${ago(a.since)}`;
  return t;
}

function ago(ms) {
  if (!ms) return "";
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (m < 1) return "今";
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間`;
  return `${Math.floor(h / 24)}日`;
}

// タップで Orca iOS アプリのそのワークツリーのチャットを開く URL
function orcaLink(a) {
  if (!ORCA_HOST_ID || !a || !a.worktreeId) return "orca://";
  let url = `orca://h/${encodeURIComponent(ORCA_HOST_ID)}/session/${encodeURIComponent(a.worktreeId)}`;
  if (a.paneKey) url += `?paneKey=${encodeURIComponent(a.paneKey)}`;
  return url;
}

function hhmm(ms) {
  const df = new DateFormatter();
  df.dateFormat = "HH:mm";
  return df.string(new Date(ms));
}

// Parameter に「demo」と入れると例のデータで表示する（スクリーンショット用）
function demoData() {
  const now = Date.now();
  const m = (n) => now - n * 60000;
  const a = (repo, wt, title, state, min, extra = {}) => ({
    repo, worktree: wt, worktreeId: `demo-${repo}-${wt}`, paneKey: null, title, state,
    attention: ["waiting", "blocked", "needs-input", "error"].includes(state),
    unread: false, agentType: "claude", tool: null, subagentsWorking: 0,
    message: null, since: m(min), updatedAt: m(min), automation: null, ...extra,
  });
  const agents = [
    a("todo-app", "feature/sync", "同期処理のリトライを追加", "blocked", 42,
      { tool: "Bash", message: "npm test を実行してよいですか？" }),
    a("todo-app", "main", "設定画面のダークモード対応", "working", 6,
      { subagentsWorking: 2, message: "色のトークンを置き換えています" }),
    a("blog", "main", "記事一覧のページ送り", "waiting", 3,
      { message: "無限スクロールとページ番号、どちらにしますか？" }),
    a("api-server", "fix/login", "ログインの不具合を調べる", "working", 15,
      { message: "トークンの有効期限の比較を確認しています" }),
    a("api-server", "main", "依存パッケージの更新", "done", 25,
      { unread: true, message: "更新して PR を作りました" }),
  ];
  return {
    ok: true, generatedAt: now, appRunning: true, runtimeReady: true,
    counts: { working: 2, attention: 2, done: 1, idle: 3, subagents: 2, unreadDone: 1, doneToday: 7 },
    agents,
    usage: {
      session: { usedPercent: 64, resetsAt: now + 95 * 60000 },
      weekly: { usedPercent: 38, resetsAt: now + 4 * 86400000 },
      fableWeekly: { usedPercent: 0, resetsAt: now + 4 * 86400000 },
      updatedAt: now,
    },
  };
}

async function load() {
  if (HOST.toLowerCase() === "demo") return { data: demoData(), stale: false };
  if (!HOST) return { data: null, stale: true, error: "no-host" };
  const fm = FileManager.local();
  const path = fm.joinPath(fm.documentsDirectory(), CACHE_FILE);
  try {
    const req = new Request(URL_STATUS);
    req.timeoutInterval = 15;
    const data = await req.loadJSON();
    if (!data.ok) throw new Error(data.error || "server error");
    fm.writeString(path, JSON.stringify(data));
    return { data, stale: false };
  } catch (e) {
    if (fm.fileExists(path)) {
      return { data: JSON.parse(fm.readString(path)), stale: true, error: String(e) };
    }
    return { data: null, stale: true, error: String(e) };
  }
}

// 数字と「Orca」は丸ゴシック系、本文は標準のシステムフォント
const FONT = {
  regular: "systemFont",
  medium: "mediumSystemFont",
  semibold: "semiboldSystemFont",
  bold: "boldSystemFont",
  num: "boldRoundedSystemFont",
  numSemi: "semiboldRoundedSystemFont",
};

function addText(stack, str, size, color, weight = "regular", minScale = 0.8) {
  const t = stack.addText(str);
  const name = FONT[weight];
  t.font = Font[name] ? Font[name](size) : Font.boldSystemFont(size);
  t.textColor = color;
  t.lineLimit = 1;
  t.minimumScaleFactor = minScale;
  return t;
}

// 角の丸い塗り（点・帯・バー）を画像で描く
function shapeImage(w, h, layers) {
  const ctx = new DrawContext();
  ctx.size = new Size(w, h);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const r = Math.min(w, h) / 2;
  for (const [width, color] of layers) {
    if (width <= 0) continue;
    const p = new Path();
    p.addRoundedRect(new Rect(0, 0, Math.max(width, r * 2), h), r, r);
    ctx.addPath(p);
    ctx.setFillColor(color);
    ctx.fillPath();
  }
  return ctx.getImage();
}

function addShape(stack, w, h, color) {
  const img = stack.addImage(shapeImage(w, h, [[w, color]]));
  img.imageSize = new Size(w, h);
  return img;
}

function header(w, res, family) {
  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  const d = res.data;
  let key = "done";
  if (!d || res.stale) key = "error";
  else if (!d.runtimeReady) key = "idle";
  addShape(row, 7, 7, C[key]);
  row.addSpacer(6);
  addText(row, "Orca", 13.5, C.text, "numSemi");
  row.addSpacer();
  let right;
  if (!d) right = res.error === "no-host" ? "IP 未設定" : "接続できません";
  else if (res.stale) right = `${hhmm(d.generatedAt)} 時点（${ago(d.generatedAt)}前）`;
  else if (!d.runtimeReady) right = d.appRunning ? "起動処理中" : "Orca 停止中";
  else right = `${hhmm(d.generatedAt)} 更新`;
  // 小は幅がないので短くする
  if (family === "small" && d && res.stale) right = `${ago(d.generatedAt)}前時点`;
  else if (family === "small" && d && d.runtimeReady) right = hhmm(d.generatedAt);
  addText(row, right, 10, res.stale ? C.error : C.sub, res.stale ? "medium" : "regular");
}

// ---- 件数 ----
function statList(d) {
  const c = d.counts || {};
  const longWait = (d.agents || []).some(isLongWait);
  return [
    { id: "working", label: "稼働", hero: "稼働中", tile: "稼働", n: c.working || 0, key: "working" },
    { id: "attention", label: "要対応", hero: "要対応", tile: "要対応", n: c.attention || 0, key: longWait ? "error" : "attention" },
    { id: "unread", label: "未読", hero: "未読の完了", tile: "未読の完了", n: c.unreadDone || 0, key: "done" },
    // 今日終わった数（Orca に残っているエージェントだけ数える）
    { id: "today", label: "今日完了", tile: "今日の完了", n: c.doneToday || 0, key: null },
  ];
}

function statColor(s) {
  if (!s.n) return C.sub;
  return s.key ? C[s.key] : C.text;
}

// 「● 未読 1」
function miniStat(stack, s) {
  const row = stack.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  addShape(row, 6, 6, s.n ? (s.key ? C[s.key] : C.meter) : C.track);
  row.addSpacer(5);
  addText(row, s.label, 10, C.sub);
  row.addSpacer(4);
  addText(row, String(s.n), 10.5, s.n ? C.text : C.sub, "numSemi");
  return row;
}

// 小・中: いちばん大事な数字を大きく出し、残りは小さく添える。
// 大きく出すのは 要対応 → 稼働 → 未読の完了 の順で、最初に 1 件以上あるもの
function heroBlock(stack, d, family) {
  const stats = statList(d);
  const byId = (id) => stats.find((s) => s.id === id);
  const hero = ["attention", "working", "unread"].map(byId).find((s) => s.n > 0) || byId("working");
  const top = stack.addStack();
  top.layoutHorizontally();
  top.bottomAlignContent();
  addText(top, String(hero.n), 32, statColor(hero), "num");
  top.addSpacer(5);
  const lab = top.addStack();
  lab.setPadding(0, 0, 6, 0); // 数字のベースラインにそろえる
  addText(lab, hero.hero, 12, statColor(hero), "semibold");
  top.addSpacer();
  stack.addSpacer(2);
  const rest = stats.filter((s) => s !== hero && (family !== "small" || s.id !== "today"));
  if (family === "small") {
    const row = stack.addStack();
    row.layoutHorizontally();
    rest.forEach((s, i) => {
      if (i > 0) row.addSpacer(10);
      miniStat(row, s);
    });
    row.addSpacer();
  } else {
    rest.forEach((s, i) => {
      if (i > 0) stack.addSpacer(3);
      miniStat(stack, s).addSpacer();
    });
  }
}

// 大: 同じ幅のカードを 4 枚並べる
function tiles(w, d) {
  const row = w.addStack();
  row.layoutHorizontally();
  statList(d).forEach((s, i) => {
    if (i > 0) row.addSpacer(6);
    const t = row.addStack();
    t.layoutHorizontally();
    t.setPadding(7, 10, 7, 4);
    t.cornerRadius = 11;
    t.backgroundColor = s.id === "attention" && s.n > 0 ? dyn(PAL[s.key], 0.16) : C.card;
    const col = t.addStack();
    col.layoutVertically();
    addText(col, String(s.n), 22, statColor(s), "num");
    addText(col, s.tile, 9.5, C.sub, "medium");
    t.addSpacer(); // 中に伸びる余白を入れると 4 枚が同じ幅になる
  });
}

// ---- Claude の使用上限 ----
function usageKey(p) {
  if (p >= 95) return "error";
  if (p >= 80) return "attention";
  return null;
}

// 24時間以内なら「1:00」、それ以降は「土 3:00」
function resetText(ms) {
  if (!ms) return "";
  const df = new DateFormatter();
  df.dateFormat = ms - Date.now() < 24 * 3600000 ? "H:mm" : "E H:mm";
  df.locale = "ja_JP";
  return df.string(new Date(ms));
}

const BAR_H = 5;

function barImage(pct, width) {
  const key = usageKey(pct);
  const used = Math.max(0, Math.min(100, pct)) / 100 * width;
  return shapeImage(width, BAR_H, [[width, C.track], [used, key ? C[key] : C.meter]]);
}

// 「5h ▬▬▬▬ 18%」。opts.table を付けると列をそろえてリセット時刻を右端に出す（大サイズ用）
function usageRow(stack, label, win, barWidth, opts = {}) {
  const row = stack.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  const key = usageKey(win.usedPercent);
  if (opts.table) {
    const l = row.addStack();
    l.size = new Size(58, 0);
    addText(l, label, 10, C.sub);
    l.addSpacer();
  } else {
    addText(row, label, 10, C.sub);
    row.addSpacer(5);
  }
  const img = row.addImage(barImage(win.usedPercent, barWidth));
  img.imageSize = new Size(barWidth, BAR_H);
  row.addSpacer(6);
  addText(row, `${win.usedPercent}%`, 10.5, key ? C[key] : C.text, key ? "num" : "numSemi");
  if (opts.table) {
    row.addSpacer();
    if (win.resetsAt) addText(row, `${resetText(win.resetsAt)} リセット`, 9.5, C.sub);
  }
  return row;
}

function usageRowsLarge(u) {
  const rows = [["Claude 5h", u.session]];
  if (u.weekly) rows.push(["Claude 週", u.weekly]);
  if (u.fableWeekly && u.fableWeekly.usedPercent > 0) rows.push(["Fable 週", u.fableWeekly]);
  return rows;
}

// ロック画面の丸型: 5h の使用率をリングで、件数を中央に描く
function ringImage(pct, centerText, label) {
  const S = 60, lw = 5;
  const ctx = new DrawContext();
  ctx.size = new Size(S, S);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const inset = lw / 2 + 1;
  ctx.setLineWidth(lw);
  ctx.setStrokeColor(new Color("#ffffff", 0.25));
  ctx.strokeEllipse(new Rect(inset, inset, S - inset * 2, S - inset * 2));
  if (pct != null && pct > 0) {
    const r = S / 2 - inset;
    const pts = [];
    const end = Math.max(0, Math.min(100, pct)) / 100 * 2 * Math.PI;
    for (let a = 0; a <= end + 1e-6; a += Math.PI / 60) {
      pts.push(new Point(S / 2 + r * Math.sin(a), S / 2 - r * Math.cos(a)));
    }
    if (pts.length > 1) {
      const path = new Path();
      path.addLines(pts);
      ctx.addPath(path);
      ctx.setStrokeColor(Color.white());
      ctx.strokePath();
    }
  }
  ctx.setTextAlignedCenter();
  ctx.setTextColor(Color.white());
  ctx.setFont(Font.boldSystemFont(20));
  ctx.drawTextInRect(centerText, new Rect(0, 13, S, 24));
  ctx.setFont(Font.systemFont(9));
  ctx.drawTextInRect(label, new Rect(0, 36, S, 12));
  return ctx.getImage();
}

// 同じプロジェクト（リポジトリ）をまとめる。並びは優先度順のまま、最初に出てきた順
function groupByRepo(agents) {
  const groups = [];
  const byRepo = {};
  for (const a of agents) {
    const key = a.repo || a.worktree || "?";
    if (!byRepo[key]) groups.push((byRepo[key] = { repo: key, agents: [] }));
    byRepo[key].agents.push(a);
  }
  return groups;
}

// 大サイズのプロジェクト見出し: 左に「orca-widget」、右に「要対応 1 · 稼働 2」
function groupHeader(w, g) {
  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  addText(row, g.repo, 10.5, C.sub, "semibold");
  row.addSpacer();
  const n = (f) => g.agents.filter(f).length;
  const parts = [];
  if (n((a) => a.attention)) parts.push(`要対応 ${n((a) => a.attention)}`);
  if (n((a) => a.state === "working")) parts.push(`稼働 ${n((a) => a.state === "working")}`);
  if (n((a) => a.state === "done")) parts.push(`完了 ${n((a) => a.state === "done")}`);
  addText(row, parts.join(" · "), 9.5, C.sub);
}

// 左に状態の色の帯、右に 2 行（タイトル / 状態など）。
// opts.hideRepo: リポジトリ名を省く / opts.more: 同じプロジェクトの残り件数
// opts.message: 2 行目に使える幅。指定すると状態の右に最後のメッセージを続ける / opts.noAgo: 経過時間を省く
function agentRow(w, a, opts = {}) {
  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.url = orcaLink(a); // 中・大サイズでは行ごとにタップ先を分けられる
  const key = rowKey(a);
  addShape(row, 3, 24, C[key]);
  row.addSpacer(8);
  const body = row.addStack();
  body.layoutVertically();
  const repo = a.repo || a.worktree || "?";
  // 1 行目: セッションのタイトル
  addText(body, a.title || repo, 12.5, C.text, "semibold", 0.9);
  // 2 行目: リポジトリ · 状態 · 時間（大はそのあとに最後のメッセージ）
  const meta = body.addStack();
  meta.layoutHorizontally();
  if (!opts.hideRepo) addText(meta, `${repo} · `, 10, C.sub);
  const strong = isLongWait(a) || (a.state === "done" && a.unread);
  addText(meta, stateText(a, !opts.noAgo), 10, C[key], strong ? "bold" : "medium");
  if (opts.more) addText(meta, ` · 他${opts.more}`, 10, C.sub);
  if (opts.message && a.message) {
    // 状態の文字が押しつぶされないよう、メッセージは残りの幅に収まる長さに切ってから出す
    const state = stateText(a, !opts.noAgo);
    const msg = fitText(a.message, opts.message - textWidth(state, 10.5) - 7, 10);
    if (msg) {
      meta.addSpacer(7);
      addText(meta, msg, 10, C.sub, "regular", 1);
    }
  }
  meta.addSpacer();
}

// 文字幅のおおよその見積もり（全角は 1 文字ぶん、半角は 0.6 文字ぶん）
function textWidth(str, size) {
  let w = 0;
  for (const ch of str) w += ch.codePointAt(0) > 0x2e7f ? size : size * 0.6;
  return w;
}

// 幅に収まる長さで切って「…」を付ける
function fitText(str, width, size) {
  if (textWidth(str, size) <= width) return str;
  let out = "";
  for (const ch of str) {
    if (textWidth(out + ch, size) > width - size) break;
    out += ch;
  }
  return out ? out.trimEnd() + "…" : "";
}

function emptyNote(stack) {
  addText(stack, "動いているエージェントはありません", 10.5, C.sub);
}

// ---- サイズごとの組み立て ----
function buildSmall(w, d, active, groups, usage) {
  w.addSpacer(8);
  heroBlock(w, d, "small");
  if (groups.length) {
    // 小サイズは行ごとのタップ先を持てないので、先頭の 1 件を開く
    w.url = orcaLink(active[0]);
    w.addSpacer(9);
    const a = groups[0].agents[0];
    // 幅が狭いので、要対応のときはリポジトリ名を、それ以外は経過時間を省く
    agentRow(w, a, { more: groups[0].agents.length - 1, hideRepo: a.attention, noAgo: !a.attention });
  }
  w.addSpacer();
  if (usage) usageRow(w, "5h", usage.session, 62);
}

function buildMedium(w, d, active, groups, usage) {
  w.addSpacer(8);
  const body = w.addStack();
  body.layoutHorizontally();
  body.topAlignContent();
  const left = body.addStack();
  left.layoutVertically();
  left.size = new Size(88, 0);
  heroBlock(left, d, "medium");
  body.addSpacer(12);
  const right = body.addStack();
  right.layoutVertically();
  // 1 プロジェクト 1 行。一番急ぎのものを出して残りは「他N」
  let shown = 0;
  groups.slice(0, 2).forEach((g, i) => {
    if (i > 0) right.addSpacer(7);
    agentRow(right, g.agents[0], { more: g.agents.length - 1 });
    shown += g.agents.length;
  });
  if (!groups.length) {
    right.addSpacer(3);
    emptyNote(right);
  }
  // Claude の使用量は一番下に固定
  w.addSpacer();
  const foot = w.addStack();
  foot.layoutHorizontally();
  foot.centerAlignContent();
  if (usage) {
    usageRow(foot, "Claude 5h", usage.session, 46);
    if (usage.weekly) {
      foot.addSpacer(12);
      usageRow(foot, "週", usage.weekly, 46);
    }
  }
  foot.addSpacer();
  if (active.length - shown > 0) addText(foot, `ほか ${active.length - shown} 件`, 10, C.sub);
}

// 大サイズで一覧に何件出すかを、残りの高さから決める。
// 目安の高さ: 見出し 17 / 行 27 / 同じプロジェクトの行間 6 / プロジェクト間 9
function pickForLarge(groups, budget) {
  const out = [];
  let h = 0;
  for (const g of groups) {
    const first = (out.length ? 9 : 0) + 17 + 27;
    if (h + first > budget) break;
    h += first;
    const picked = { group: g, agents: [g.agents[0]] };
    for (const a of g.agents.slice(1)) {
      if (h + 33 > budget) break;
      h += 33;
      picked.agents.push(a);
    }
    out.push(picked);
    if (picked.agents.length < g.agents.length) break;
  }
  return out;
}

// 大サイズの行の 2 行目に使える幅の目安（ウィジェット幅 338pt から余白と色の帯を引いたもの）
const LARGE_ROW_WIDTH = 290;

function buildLarge(w, d, active, groups, usage) {
  w.addSpacer(10);
  tiles(w, d);
  w.addSpacer(12);
  const urows = usage ? usageRowsLarge(usage) : [];
  // 一覧に使える高さ（大ウィジェットの高さ 354pt を基準にした目安）
  const budget = 226 - (urows.length ? urows.length * 18 + 5 : 0);
  const total = active.length;
  const count = (p) => p.reduce((n, x) => n + x.agents.length, 0);
  let picked = pickForLarge(groups, budget);
  // 出し切れないときは「ほか N 件」の 1 行ぶんを空ける
  if (count(picked) < total) picked = pickForLarge(groups, budget - 18);
  picked.forEach((p, gi) => {
    if (gi > 0) w.addSpacer(9);
    groupHeader(w, p.group);
    w.addSpacer(4);
    p.agents.forEach((a, i) => {
      if (i > 0) w.addSpacer(6);
      agentRow(w, a, { hideRepo: true, message: LARGE_ROW_WIDTH });
    });
  });
  if (!groups.length) emptyNote(w);
  const rest = total - count(picked);
  if (rest > 0) {
    w.addSpacer(6);
    addText(w, `ほか ${rest} 件`, 10, C.sub);
  }
  // Claude の使用量は一番下に固定
  w.addSpacer();
  urows.forEach(([label, win], i) => {
    if (i > 0) w.addSpacer(5);
    usageRow(w, label, win, 120, { table: true });
  });
}

// ロック画面用。色は iOS が単色に置き換えるので、文字の太さと記号で差をつける
function buildAccessory(res, family) {
  const w = new ListWidget();
  w.url = "orca://";
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MIN * 60000);
  const d = res.data;
  const ok = d && d.runtimeReady;
  const c = (ok && d.counts) || {};
  const active = ok ? (d.agents || []).filter((a) => a.state !== "idle") : [];
  const longWait = active.some(isLongWait);
  const stale = res.stale ? " (古)" : "";
  const u = ok && d.usage && d.usage.session ? d.usage : null;
  if (active.length) w.url = orcaLink(active[0]);

  if (family === "accessoryInline") {
    let t;
    if (!d) t = res.error === "no-host" ? "Orca IP 未設定" : "Orca 接続できません";
    else if (!ok) t = "Orca 停止中";
    else if (c.attention) t = `Orca ${longWait ? "⚠" : ""}要対応${c.attention} 稼働${c.working || 0}`;
    else t = `Orca 稼働${c.working || 0}`;
    if (u) t += ` 5h${u.session.usedPercent}%`;
    w.addText(t + stale);
    return w;
  }

  if (family === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    const n = c.attention ? c.attention : c.working || 0;
    const label = !ok ? "Orca" : c.attention ? (longWait ? "⚠待ち" : "要対応") : "稼働";
    // リング = Claude 5h の使用率、中央 = 要対応（なければ稼働）の件数
    w.addImage(ringImage(u ? u.session.usedPercent : null, ok ? String(n) : "—", label));
    return w;
  }

  // accessoryRectangular
  const head = w.addText(
    !d ? (res.error === "no-host" ? "Orca IP 未設定" : "Orca 接続できません") : !ok ? "Orca 停止中"
      : `Orca ${c.attention ? `${longWait ? "⚠" : ""}要対応 ${c.attention} · ` : ""}稼働 ${c.working || 0}${stale}`
  );
  head.font = Font.boldSystemFont(13);
  head.lineLimit = 1;
  head.minimumScaleFactor = 0.7;
  active.slice(0, u ? 1 : 2).forEach((a) => {
    const t = w.addText(`${isLongWait(a) ? "⚠ " : a.attention ? "● " : ""}${a.repo || a.worktree} ${stateText(a)}`);
    t.font = isLongWait(a) ? Font.boldSystemFont(11) : Font.systemFont(11);
    t.lineLimit = 1;
    t.minimumScaleFactor = 0.7;
  });
  if (u) {
    const p = u.session.usedPercent;
    let line = `Claude 5h ${p}%${p >= 80 ? "⚠" : ""} (${resetText(u.session.resetsAt)})`;
    if (u.weekly) line += ` · 週 ${u.weekly.usedPercent}%`;
    const t = w.addText(line);
    t.font = p >= 80 ? Font.boldSystemFont(11) : Font.systemFont(11);
    t.lineLimit = 1;
    t.minimumScaleFactor = 0.7;
  }
  return w;
}

async function build() {
  const res = await load();
  const family = config.widgetFamily || "large";
  if (family.startsWith("accessory")) return buildAccessory(res, family);
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.url = "orca://"; // 行以外をタップしたらアプリを開くだけ
  const pad = family === "large" ? 16 : 14;
  w.setPadding(pad, pad, pad, pad);
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MIN * 60000);

  header(w, res, family);

  const d = res.data;
  if (!d || !d.runtimeReady) {
    w.addSpacer(10);
    const msg = res.error === "no-host"
      ? "Mac の IP が未設定です。ウィジェットの Parameter か、スクリプト冒頭の MAC_HOST に入れてください"
      : !d ? "Tailscale が接続されているか確認してください" : "Orca のランタイムが動いていません";
    addText(w, msg, 11, C.sub).lineLimit = 4;
    w.addSpacer();
    return w;
  }

  if ((d.counts || {}).attention) w.backgroundColor = C.attentionBg;
  const active = (d.agents || []).filter((a) => a.state !== "idle");
  const groups = groupByRepo(active);
  const usage = d.usage && d.usage.session ? d.usage : null;
  if (family === "small") buildSmall(w, d, active, groups, usage);
  else if (family === "medium") buildMedium(w, d, active, groups, usage);
  else buildLarge(w, d, active, groups, usage);
  return w;
}

const widget = await build();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentLarge();
}
Script.complete();
