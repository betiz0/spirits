# 上流 issue 下書き(pi へ送る前提、未投稿)

 managed 経路は公式 Pi の artifact をそのまま使い、Pi の JS ソースに手を入れない(P-SOURCE 0)。よって拡張 API の欠落は上流へ上げるしかない。以下は投稿用に書いた下書きで、**この変更では投稿しない**。投稿する場合は対象版を最新のリリースに合わせ直す。

背景の測定値は [spirits-managed-pi.md](spirits-managed-pi.md) と [add-managed-spirits-commands の design](../openspec/changes/archive/2026-11-10-add-managed-spirits-commands/design.md) にある。どちらも公式 Pi 1.5.0 で実測した。

## PA: `ExtensionContext` に `modelRuntime` を露出する

### 問題

拡張はモデルを選べない。`ctx.modelRegistry` は一覧と認証状態を読むだけで、プロバイダへリクエストを投げる `ModelRuntime` に届かない。そのため、プロバイダをプログラム登録する拡張(`registerProvider()`)がいると、その provider はその拡張の中での可視になる。

spirits では次の 2 つが起きる。

1. `rlm` の子セッションは拡張を読まない。子は自分の `ModelRuntime` を `agentDir` の `auth.json` / `models.json` と環境変数から作る。亲が `registerProvider()` で生やした provider を選んでいると、子は `No API key found for <provider>` で落ちる。親の側で解決しても認証の可否は親から判定できない。
2. 拡張内のモデル選択が `pi.setModel()` / `pi.getAvailableModels()` に限定される。独自の解決(仮想モデル route)を拡張内で完結させると、その route が通った後、pi が同じ解決をもう一度行う。

### 再現手順

公式 Pi 1.5.0 で、`registerProvider()` を呼ぶ拡張 A と、`rlm` で子を作る拡張 B を同時にロードする。A の provider を選んで子を作ると、子のリクエストは作られる前に認証解決で失敗する。

```sh
# 子だけ拡張を読まない(親と同じプロセス内で作られる)
pi --mode rpc -e ./provider-extension.ts -e ./rlm-extension.ts
# -> 子の要求: "No API key found for <provider>"
```

### 提案

`ExtensionContext` に `modelRuntime: ModelRuntime` を足す。`ModelRuntime` は既に `packages/coding-agent` の公開型で、`createAgentSession()` は同じ型を引数に取っている。つまりランタイムには既に存在し、セッションを作る側は既に受け取っており、拡張の context 에만出ていない。

対称性の根拠として、`ExtensionContext` は `modelRegistry`(読み取り専用ビュー)を出すのに、書き込みと実行の入口である `ModelRuntime` を出さない。拡張から実行経路に届く道が無いのは、あのフィールドの欠落と説明できる。

### 規模と影響

`core/extensions/types.ts` に宣言 1 行、`core/extensions/runner.ts` の context 構築に 3 行、`docs/extensions.md` に 10 行程度。既存の呼び出しは変えないので後方互換。懸念があるとすれば、拡張が runtime 越しにセッションの外側から状態を書けることなので、読み取り専用のメソッドに絞った `ExtensionModelRuntime` ビューにする案も置いておく。

### 現状の回避

spirits は親の側で子の物理モデルを決め、そのモデル id を子に渡す。親が `spirits/auto` を選んでいても、子の起動前に route を解いて物理 id に落とす。拡張登録 provider はそのまま受け入れる(managed 経路の既知の制約として docs に記載)。

## PB: 会話だけを消してセッションを保つ `clearConversation` を拡張 API にする

### 問題

「会話を消すが、session ID・履歴・セッションに紐づいた状態は残す」操作が拡張から作れない。拡張 API にあるのは `ctx.compact()` と `ctx.newSession()` だけで、前者は要約であり、後者は新しい session ID を作ってしまい、ID・履歴・ファイル名の継続を前提とする状態を失う。

spirits は skill のフェーズ切替などで「これまでの会話を文脈から外す」必要がある。`/spirits-clear` として拡張側で代替を実装したが、表示が消えない(下表)ため、既定経路(fork)の `/clear` とは見え方が違う。

### 実測(forwarded に影響しない項目のみ確認)

公式 Pi 1.5.0 で拡張から `compact()` を呼ぶ道と、custom entry + `context` フィルタの道を比較した。

| 確認 | 結果 |
|---|---|
| 会話 1 往復の短いセッションで `compact()` | `Nothing to compact (session too small)` で失敗。`session_before_compact` は 0 回(フックの前に preparation のチェックが来る) |
| 直前の entry が compaction のとき | `Already compacted` で失敗 |
| 連続実行 | 上記 2 つが組み合わさって 2 回目が失敗する |
| 拡張が `session_before_compact` で要約を差し替えた場合 | 差し替え自体は成功するが、要約という新しい内容が文脈に残る |
| `newSession()` | 成功するが session ID が変わり、同一 ID を前提とする状態が失われる |

### 提案

`ctx.clearConversation()` を追加する。意味は「現在の branch の会話を文脈から外す境界を 1 個追記する」。既存の `buildSessionProjection()` に境界を表す entry を 1 種追加すれば、LLM 側は自動的に境界より前を読まなくなり、チャット表示はそのまま残せる。表示まで消すかは製品の判断なので、切り分けて次の 2 案にしておく。

- PB-1(表示を変えない): 境界 entry + `buildSessionProjection()` の_FILTER_。LLM 文脈からだけ消える。`context` イベントを拡張側で-filter している実装は不要になるので、pi 側の 1 箇所で済む。
- PB-2(表示も消す): PB-1 に加え、UI へ「会話を消した」ことを伝えるイベントを生やす。`interactive-mode` の transcript を区切る必要があるので、PB-1 より範囲が広い。

### 規模と影響

PB-1 は `core/session-manager.ts` の projection に境界を 1 種足して `core/extensions/types.ts` / `runner.ts` にメソッドを 1 つ、`core/agent-session-runtime.ts` に既存の `clearConversation` 相当を移す形で 40 行程度。PB-2 は `interactive-mode.ts` に 10 行と新しいイベント 1 個で、合計 100〜130 行。`compact()` と同じく「セッションを書き換えるが会話を増やさない」操作なので、compaction と同じ hooks(`session_before_*`)の対象にするかを決める必要がある。

### 現状の回避

`/spirits-clear` は custom entry(`spirits_clear`)を境界として追記し、`context` イベントで境界より前の投影メッセージを落とす。自動 compaction が境界より前を要約しに来たら `session_before_compact` を引き受けて、消した会話を summary に戻さない。チャット表示は残る。session ID、TODO、goal、memory はそのまま。
