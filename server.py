#!/usr/bin/env python3
"""Orca の稼働状況を JSON で返す小さな HTTP サーバー。

Tailscale の IP にだけ bind するので、tailnet 内の端末（iPhone 等）からしか見えない。
GET /status  -> 要約 JSON
GET /healthz -> "ok"
"""
import json
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ORCA = os.environ.get("ORCA_BIN", "/Applications/Orca.app/Contents/Resources/bin/orca")
def tailscale_ip():
    """この Mac の Tailscale IPv4（100.64.0.0/10 の範囲）。つながっていなければ None。

    Tailscale のコマンドは App Store 版だと launchd から呼べないので、ifconfig から探す。
    """
    try:
        out = subprocess.run(["/sbin/ifconfig"], capture_output=True, text=True, timeout=10).stdout
    except Exception:
        return None
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0] == "inet":
            octets = parts[1].split(".")
            if len(octets) == 4 and octets[0] == "100" and 64 <= int(octets[1]) <= 127:
                return parts[1]
    return None


# 環境変数 BIND_HOST があればそれ、なければ Tailscale の IP を自動で使う
HOST = os.environ.get("BIND_HOST") or None
PORT = int(os.environ.get("PORT", "8765"))
CACHE_SECONDS = 10
DONE_WINDOW_MS = 3 * 60 * 60 * 1000  # 完了はこの時間内に終わったものだけ数える・表示する

ATTENTION = {"waiting", "blocked", "needs-input", "error"}
_lock = threading.Lock()
_cache = {"at": 0.0, "body": None}


def run_json(*args):
    out = subprocess.run([ORCA, *args, "--json"], capture_output=True, text=True, timeout=30)
    data = json.loads(out.stdout)
    if not data.get("ok"):
        raise RuntimeError(data.get("error") or out.stderr.strip() or "orca error")
    return data["result"]


def shorten(text, n=60):
    if not text:
        return None
    text = " ".join(str(text).split())
    return text if len(text) <= n else text[: n - 1] + "…"


def claude_usage():
    """Claude の使用上限（5時間枠・週枠）の使用率。取れなければ None。"""
    try:
        rl = (run_json("account", "list").get("rateLimits") or {}).get("claude") or {}
    except Exception:
        return None
    if rl.get("status") != "ok":
        return None

    def window(w):
        if not w or w.get("usedPercent") is None:
            return None
        return {"usedPercent": w["usedPercent"], "resetsAt": w.get("resetsAt")}

    return {"session": window(rl.get("session")), "weekly": window(rl.get("weekly")),
            "fableWeekly": window(rl.get("fableWeekly")), "updatedAt": rl.get("updatedAt")}


def summarize():
    now_ms = int(time.time() * 1000)
    try:
        st = run_json("status")
        app_running = bool(st.get("app", {}).get("running"))
        runtime_ready = st.get("runtime", {}).get("state") == "ready"
    except Exception:
        app_running, runtime_ready = False, False

    if not runtime_ready:
        return {"ok": True, "generatedAt": now_ms, "appRunning": app_running,
                "runtimeReady": False, "counts": {}, "agents": [], "usage": None}

    ps = run_json("worktree", "ps")
    counts = {"working": 0, "attention": 0, "done": 0, "idle": 0, "subagents": 0,
              "unreadDone": 0, "doneToday": 0}
    lt = time.localtime()
    midnight_ms = int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1)) * 1000)
    agents = []
    for wt in ps.get("worktrees", []):
        if wt.get("isArchived"):
            continue
        for a in wt.get("agents") or []:
            state = a.get("state") or "idle"
            subs = [s for s in (a.get("subagents") or []) if s.get("state") == "working"]
            since = a.get("stateStartedAt") or a.get("updatedAt") or 0
            unread = bool(wt.get("unread"))
            if state == "done":
                if since >= midnight_ms:
                    counts["doneToday"] += 1
                if unread:
                    counts["unreadDone"] += 1  # 終わったのにまだ見ていない
                elif now_ms - since > DONE_WINDOW_MS:
                    counts["idle"] += 1  # 見ていて古い完了は「待機」扱いにして一覧から外す
                    continue
            if state == "working":
                counts["working"] += 1
            elif state in ATTENTION:
                counts["attention"] += 1
            elif state == "done":
                counts["done"] += 1
            else:
                counts["idle"] += 1
            counts["subagents"] += len(subs)
            agents.append({
                "repo": wt.get("repo"),
                "worktreeId": wt.get("worktreeId"),
                "paneKey": a.get("paneKey"),
                "worktree": wt.get("displayName"),
                "title": shorten(a.get("conversationName") or a.get("taskTitle") or a.get("prompt"), 40),
                "state": state,
                "attention": state in ATTENTION,
                "unread": unread,
                "agentType": a.get("agentType"),
                "tool": a.get("toolName"),
                "subagentsWorking": len(subs),
                "message": shorten(a.get("lastAssistantMessage"), 80),
                "since": a.get("stateStartedAt"),
                "updatedAt": a.get("updatedAt"),
                "automation": wt.get("automationName"),
            })

    order = {"attention": 0, "working": 1, "done": 2}
    agents.sort(key=lambda x: (order.get("attention" if x["attention"] else x["state"], 3),
                               -(x["updatedAt"] or 0)))
    return {"ok": True, "generatedAt": now_ms, "appRunning": app_running,
            "runtimeReady": True, "counts": counts, "agents": agents, "usage": claude_usage()}


def get_status():
    with _lock:
        if _cache["body"] is None or time.time() - _cache["at"] > CACHE_SECONDS:
            try:
                body = summarize()
            except Exception as e:  # noqa: BLE001
                body = {"ok": False, "generatedAt": int(time.time() * 1000), "error": str(e)}
            _cache.update(at=time.time(), body=json.dumps(body, ensure_ascii=False).encode())
        return _cache["body"]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/healthz":
            body, ctype = b"ok", "text/plain"
        elif path == "/status":
            body, ctype = get_status(), "application/json; charset=utf-8"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--once":
        print(json.dumps(summarize(), ensure_ascii=False, indent=2))
        sys.exit(0)
    host = HOST or tailscale_ip()
    if not host:
        # launchd が 30 秒後に再起動するので、Tailscale がつながれば自然に起動する
        sys.stderr.write("Tailscale の IP が取れません。Tailscale を起動してログインしてください\n")
        sys.exit(1)
    sys.stderr.write(f"listening on http://{host}:{PORT}/status\n")
    ThreadingHTTPServer((host, PORT), Handler).serve_forever()
