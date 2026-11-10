# Orca 稼働状況ウィジェット

Mac で動いている [Orca](https://github.com/stablyai/orca) のエージェントの状態を、iPhone のホーム画面・ロック画面のウィジェット（Scriptable）で見る。

```
iPhone (Scriptable) --Tailscale--> Mac の server.py :8765/status --> orca worktree ps / account list
```

## 必要なもの

- Mac: Orca（`/Applications/Orca.app`）、Tailscale（ログイン済み）、python3（なければ `xcode-select --install`）
- iPhone: Tailscale（Mac と同じアカウント）、Scriptable

## Mac 側

```sh
git clone <このリポジトリ> orca-widget
cd orca-widget
./install.sh
```

- ログイン時に自動で起動し、落ちたら 30 秒後に再起動する（launchd の `local.orca-widget`）
- 最後に表示される **Tailscale の IP** を iPhone 側で使う
- サーバーは Tailscale の IP にだけ待ち受ける（同じ Wi-Fi の他の端末や localhost からは見えない）。同じ tailnet の端末からは誰でも見られるので、tailnet を他人と共有している場合は注意
- ログ: `~/Library/Logs/orca-widget.log`／手元で確認: `python3 server.py --once`
- 設定を変えて入れ直す: `PORT=8800 ./install.sh`（もう一度実行すると入れ直して再起動）
- 止めて登録を消す: `./uninstall.sh`

## iPhone 側

1. App Store で **Tailscale** を入れ、Mac と同じアカウントでログインして接続。設定で「オンデマンド接続（VPN On Demand）」をオンにすると切れにくい。
2. Safari で `http://<MacのIP>:8765/status` を開き、JSON が出ることを確認。
3. App Store で **Scriptable** を入れ、新規スクリプトに `OrcaStatus.js` の中身を貼って名前を「Orca」にする。
4. ホーム画面長押し → 「＋」→ Scriptable → 好きなサイズを追加 → ウィジェットを長押しして「ウィジェットを編集」→ Script に「Orca」、**Parameter に Mac の IP**（例 `100.101.102.103`）を入れる。
   - ロック画面にも置ける: ロック画面長押し → カスタマイズ → ロック画面 → ウィジェット欄 → Scriptable（丸・長方形）を追加 → タップして Script に「Orca」、Parameter に IP。日付の上の 1 行欄にも置ける。
   - ウィジェットごとに Parameter を入れるのが面倒なら、`OrcaStatus.js` 冒頭の `MAC_HOST` に IP を書いてもよい（Parameter が優先）。
5. Scriptable でスクリプトを ▶ 実行するとプレビューが出る（このときは `MAC_HOST` が使われる）。
6. タップで Orca アプリのチャットを開くには、`OrcaStatus.js` 冒頭の `ORCA_HOST_ID` に iPhone の Orca アプリでの Mac のホスト ID を入れる（下記。今は調べる手段がない）。

## タップ動作

- 中・大: 各行をタップすると、Orca iOS アプリでそのワークツリーのチャット（そのエージェントのタブ）が開く
- 小: 先頭の 1 件のチャットが開く。行以外の余白をタップするとアプリのホームが開く
- リンク形式: `orca://h/<ホストID>/session/<worktreeId>?paneKey=<paneKey>`（Orca モバイルの Expo Router のルート）
- ホスト ID は iPhone の Orca アプリがペアリング時に作る `host-<ミリ秒時刻>` で、Mac からは分からない。`ORCA_HOST_ID` が空のときはアプリのホームを開くだけ

## 表示

- 稼働（青）/ 要対応（橙: 入力待ち・承認待ち・エラー）/ 未読の完了（緑: 終わったのにまだ Orca で見ていないもの）の件数。中・大は「今日の完了」（今日終わった数。Orca に残っているエージェントだけ数える）も出す
- 件数の出し方はサイズで違う。大: 同じ幅のカード 4 枚。小・中: いちばん大事な数字 1 つを大きく出し、残りは小さく添える。大きく出すのは 要対応 → 稼働 → 未読の完了 の順で、最初に 1 件以上あるもの
- 各行の左の色の帯がそのエージェントの状態（青: 稼働 / 橙: 要対応 / 赤: 30 分超えの待ち・エラー / 緑: 完了）
- 一覧に出す完了は、未読のものと直近 3 時間に終わったものだけ（`server.py` の `DONE_WINDOW_MS`）。未読の完了は「完了・未読」と太字
- 要対応が 1 件でもあると背景がうっすら橙になる
- 要対応の行には承認を求めているツール名を出す（例「承認待ち · Bash · 12分」）
- 入力待ち・承認待ちが 30 分を超えると赤字・太字で強調（`OrcaStatus.js` の `LONG_WAIT_MIN`）
- Claude の使用上限（`orca account list` の rateLimits）: 5 時間枠・週枠の使用率をバーで表示。ふだんは無彩色で、80% 以上で橙、95% 以上で赤。大はリセット時刻つき、中は横並び、小は 5h のみ。Fable の週枠は使っているときだけ大に出る
- ロック画面: 1 行「Orca ⚠要対応2 稼働3」（末尾に Claude 5h の %）/ 丸: 中央に要対応の件数（なければ稼働数）、周りのリングが Claude 5h の使用率 / 長方形: 件数・上位 1 件・Claude の使用率。⚠ は 30 分超えの待ちあり、「(古)」は Mac に届かず前回の内容
- 同じプロジェクト（リポジトリ）はまとめて表示。大: プロジェクト名の見出しの下に、エージェントごとに「タイトル（太字）/ 状態 · 時間 最後のメッセージ」の 2 行（高さに入るだけ。目安 4〜5 件で、残りは「ほか N 件」）。中・小: 1 プロジェクト 1 行で、一番急ぎのエージェントの「タイトル / リポジトリ · 状態 · 他N」（中は 2 プロジェクト、小は 1 プロジェクト。小は幅がないので、要対応のときはリポジトリ名を、それ以外は経過時間を省く）
- 要対応が先頭に来る。`+N` は稼働中のサブエージェント数
- Mac に届かないときは最後に取れた内容を「HH:mm 時点（◯分前）」と赤字で表示（小は「◯分前時点」）
- ライト / ダークの両方に対応（iPhone の外観に合わせて切り替わる）
- 更新間隔は iOS 任せ（目安 5〜15 分）。Scriptable でスクリプトを開けば即時に最新を見られる
