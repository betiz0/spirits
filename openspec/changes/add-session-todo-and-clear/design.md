# Design

## Context

- pi のセッションは、`id` / `parentId` で親子をつないだ追記専用の木として JSONL に保存される。`SessionManager` は「Entries cannot be modified or deleted」と明記しており(`session-manager.ts:1516-1518`)、`getBranch()` は leaf から `parentId` を辿って経路を作る(`:408-413`)。
- `SessionManager.resetLeaf()`(`:1591`)は leaf を null に戻す。次の追記は新しいルート(`parentId = null`)になる。`navigateTree` が先頭のユーザーメッセージを編集し直すときに既に使っており(`agent-session.ts:4076`)、ルートが複数ある木は既存の形である。
- LLM 文脈は現在のブランチの投影(`buildSessionProjection`)から作られ、`AgentSession.refreshContext()`(`agent-session.ts:1391`)で `agent.state.messages` に反映される。投影に入るのは message、custom_message、compaction、branch_summary で、custom エントリは入らない(`session-manager.ts:439-466`)。コンテキスト使用量は投影から推定され、メッセージが空なら 0 になる(`compaction.ts:196-210`)。
- 拡張 UI の widget は `setWidget(key, content, { placement })` で設定する。`belowEditor` の widget はエディタとフッターの間に描画される(`interactive-mode.ts:981-984`)。セッションの差し替えと `/reload` で消える(`:607-609, 6388`)。
- 拡張が購読できるイベントに `entry_appended` は無い(`core/extensions/types.ts:1545-1612`)。`session_start`(reason: startup / reload / new / resume / fork)と `session_tree` はある。
- spirits は `spirits_goal`、`spirits_memory`、`rlm_usage` をカスタムエントリで記録し、`getBranch()` から解決している(`packages/spirits/src/harness/goal.ts:58`)。
- spirits の設定は環境変数で与え、不正値は既定値に戻す(`packages/spirits/src/config.ts`)。
- 型チェックは pi のローカルミラー `src/types/pi-coding-agent.d.ts` に対して行い、実行時の解決はディレクトリごとの `tsconfig.json` でルート設定を継承して行う(`src/harness/`、`src/rlm/`)。
- docs/spirits-design.md と docs/spirits-m*.md には、本変更に対応する記述が無い(フェーズ外の独立 capability)。

## Goals / Non-Goals

**Goals:**
- TODO をブランチ単位の状態として保存し、`/resume`、`/tree`、fork、`/reload` に追従して表示する
- `/clear` で会話を LLM 文脈から外し、セッションファイル、ID、モデル、思考レベル、拡張の状態記録を保つ
- 以前の会話を削除しない(`/tree` で戻れる)
- Pi core への変更を、既存 API を組み合わせる追加メソッドとコマンド分岐に留める

**Non-Goals:**
- TODO のプロジェクト横断共有
- `/new` の挙動変更
- print / RPC モードでの TODO パネル表示と `/clear` の提供
- 自然言語からの TODO 状態の推論
- `/clear` の拡張への通知と、拡張のメモリ上の状態のリセット(tsrepl の変数は残る)
- TODO の件数とテキスト長の上限(パネルは行数と端末幅で表示を制限する)

## Decisions

### 1. TODO の保存形式: 呼び出しごとの全体スナップショット

**選択肢と理由:**
- **A. カスタムエントリ `spirits_todo` に全体スナップショットを保存(採用)**: データは `{ nextId: number, items: { id: number, text: string, done: boolean }[] }`。現在のブランチ上で最後の有効なスナップショットが現在の状態になる。`spirits_goal` と同じ解決方法で、fork と `/clear` の複製もそのまま正しく動く。形式が不正な記録は無視し、それより前の有効な記録を使う。「形式が不正」には、ID の重複や空白だけのテキストなど、ツールが生成しえない意味的な破損も含める(verify2 W-2)。
- **B. 操作の差分ログを保存(不採用)**: 解決のたびにブランチ全体を再生する必要があり、途中の記録が壊れたときに状態が決まらない。
- **C. 別ファイル `~/.spirits/todos/<session-id>.json`(不採用)**: ブランチと fork に追従できず、セッションファイルとの同期も必要になる。

### 2. TODO の ID: システムが採番し、再利用しない

**選択肢と理由:**
- **A. スナップショットの `nextId` から連番を振る(採用)**: 1 から始め、追加ごとに 1 増やす。削除しても `nextId` は戻さない。古い ID への操作が別の項目に当たることがない。ID は短く、LLM が書き写しやすい。ブランチごとに `nextId` を持つので、別ブランチで同じ番号が別の項目を指すことはあるが、ブランチをまたいで状態を参照することはないので問題にならない。
- **B. LLM が任意の文字列 ID を指定(不採用)**: 重複 ID の扱いを定義する必要がある。
- **C. UUID(不採用)**: 長く、LLM が書き写すときに誤りやすい。

### 3. ツール: 単一の `manage_todos`、一括操作、全か無か

**選択肢と理由:**
- **A. 単一ツールで `updates` 配列を受け付ける(採用)**: 複数の更新を 1 回の呼び出しで行える。
- **B. 操作ごとに別ツール(不採用)**: 複数項目の更新に呼び出しが複数回必要になる。

パラメータ(TypeBox、`op` で判別する union):

```typescript
{
  updates: [
    { op: "add", text: "Fix bug" },
    { op: "update", id: 1, done: true },        // text と done の少なくとも一方
    { op: "update", id: 2, text: "Fix login bug" },
    { op: "delete", id: 3 }
  ]
}
```

- 適用: 現在のスナップショットの複製に対して先頭から順に適用する。同じ呼び出しの前の操作の結果は、後の操作から見える。すべて成功したときだけ、新しいスナップショットを 1 件追記する。
- 検証: 存在しない ID(同じ呼び出しで削除済みのものを含む)、空または空白だけの text、text も done も無い update、空の `updates` は不正とする。1 件でも不正があれば何も追記せず、`isError: true` で不正な操作の位置(`updates[i]`、0 始まり)と理由を返す。
- 結果: 成功時は全項目(ID、完了状態、テキスト)をテキストで返し、`details` にスナップショットを入れる。
- 公開: `exposure: "direct"`。全モードで登録する。
- 実行: `executionMode: "sequential"`。同じターンの並列呼び出しが同じスナップショットを基に追記し、後の追記が前の更新を上書きするのを防ぐ。
- LLM への案内: `promptSnippet` と `promptGuidelines` で、TODO の使い方と ID の扱いを示す。

### 4. LLM への案内の注入先: ツールの `promptGuidelines`

**選択肢と理由:**
- **A. `manage_todos` の `promptSnippet` / `promptGuidelines`(採用)**: pi の標準機構で、ツールが有効なときだけ system prompt に入る。
- **B. spirits harness の `spirits` セクションに追記(不採用)**: このセクションは利用者が `spirits_prompt_set` で置き換えられるため、案内が消えることがある。ツールが無効でも入ってしまう。

### 5. TODO パネル: `belowEditor` widget、TUI だけで描画

**選択肢と理由:**
- **A. 拡張 widget(採用)**: `ctx.ui.setWidget("spirits_todo", factory, { placement: "belowEditor" })` で描画する。Pi core の変更は不要。
- **B. Footer の置き換え(不採用)**: 既存のトークン統計表示と競合する。
- **C. InteractiveMode に専用コンテナを追加(不採用)**: core の差分が増え、upstream への追従コストが上がる。

更新の契機:
- `manage_todos` の execute 内で、成功後に `ctx.ui.setWidget` を呼ぶ。
- `session_start`(全 reason)と `session_tree` のハンドラで、`getBranch()` から状態を解決し直して描画する。差し替えと `/reload` で widget が消えた後の再表示もこれで行う。
- いずれも `ctx.mode === "tui"` のときだけ描画する(`branding/header.ts:121` と同じ判定)。

描画規則(N は `SPIRITS_TODO_MAX_LINES`、既定 5):
- 0 件: `setWidget(key, undefined)` で消す。
- 全件完了: `✓ all done` の 1 行だけを出す。
- それ以外: 未完了を ID の昇順に最大 N 行(`○ #<id> <text>`)。続けて、隠れた未完了の件数と完了件数を 1 行で出す(例 `+2 more · 2 done`)。どちらも 0 ならこの行は出さない。
- 各行は `truncateToWidth`(`@earendil-works/pi-tui`)で描画幅に切り詰める。文字列配列ではなく factory の Component にする。文字列配列には pi の 10 行上限(`MAX_WIDGET_LINES`)と端末幅を考慮しない描画があるため。

型と実行時の解決:
- 型ミラーに `setWidget`、`WidgetPlacement`、`session_tree` イベントを追加する。
- `@earendil-works/pi-tui` の `truncateToWidth` だけを宣言する型ミラー `src/types/pi-tui.d.ts` と `paths` を追加する。
- `src/todo/tsconfig.json` でルート設定を継承し、実行時に pi-tui のソースを解決する。

### 6. `/clear`: `resetLeaf()` で新しいルートを作り、状態を複製する

**選択肢と理由:**
- **A. `AgentSessionRuntime` に追加メソッドを置き、`resetLeaf()` と既存の追記 API で新しいルートを作る(採用)**: 以前の会話はファイルに残り、`/tree` で戻れる。ファイルの書き換えが無いので、親子関係も compaction の参照も壊れない。
- **B. message エントリを除去してファイルを書き換える(不採用)**: 次の 4 つの問題がある。
  - 親が message のカスタムエントリが親を失い、`getBranch()` から外れる。
  - compaction、branch_summary、custom_message が LLM 文脈に残る。
  - label などの参照先が消える。
  - 削除が不可逆である。
- **C. 拡張だけで実装し、`ctx.newSession({ setup })` で状態を新セッションへ複製する(不採用)**: Core 変更は不要だが、セッション ID とファイルが変わる。

**手順**(`AgentSessionRuntime.clearConversation(): { cleared: boolean; reason?: "streaming" | "compacting" }`):
1. `session.isStreaming` なら `{ cleared: false, reason: "streaming" }`、`session.isCompacting` なら `"compacting"` を返し、何も変えない。
2. `sessionManager.getBranch()` から `type === "custom"` のエントリを順に集める。
3. `sessionManager.resetLeaf()` を呼ぶ。
4. 現在の `session.model` があれば `appendModelChange(provider, id)` を追記する。続けて `appendThinkingLevelChange(session.thinkingLevel)` を追記する。最後の model_change エントリではなく実行時の値を使う。古いセッションでは model が assistant メッセージから決まり、model_change が無いことがあるため(`session-manager.ts:427-428`、`sdk.ts:425-428`)。
5. 集めたカスタムエントリを、`appendCustomEntry(customType, data)` で元の順に追記する。最新だけでなく全件を複製するので、ログ型(`spirits_memory`、`rlm_usage`)も含めて意味が変わらない。
6. `session.refreshContext()` で `agent.state.messages` を新しいブランチの投影(空)に置き換える。

**再開時の復元**: `sdk.ts` と `main.ts` の scoped model 選択は「セッションに既存データがあるか」を `buildSessionContext().messages.length > 0` で判定している。`/clear` 後のブランチは message を持たないため、この判定では新規セッション扱いになり、保存された `model_change` / `thinking_level_change` が無視される。`sdk.ts` に `hasExistingSessionData(sessionManager)`(messages が空でも `model_change` / `thinking_level_change` があれば既存とみなす)を追加し、`sdk.ts` と `main.ts` の両方で使う。`session-manager.ts` の投影規則は変更しない。

Runtime に置く理由: `/new`、`/resume`、fork と同じく、interactive からは `runtimeHost` 経由で呼ぶ。必要な `AgentSession` のメンバーはすべて公開されているので、`agent-session.ts` は変更しない。再開時の復元ゲートだけは上記のとおり `sdk.ts` と `main.ts` の追加変更が必要になる。

**永続化**: 追記は既存の `_appendEntry` → `_persist` を通る。会話がまだ一度も書き出されていないセッションでは、最初のユーザーメッセージまでメモリ上に留まる(既存の挙動)。ファイルの書き換えは行わない。

**interactive-mode.ts**:
- 入力分岐に `text === "/clear"` を追加し、新しいハンドラ `handleClearContextCommand()` を呼ぶ。
- 既存の `handleClearCommand()`(`:6874`)は `/new` の実装なので名前も中身も変えない。
- 拒否されたときは `/reload` と同じ文言の形式で `showWarning` を出す(`:6378-6386`)。
- 成功時は `chatContainer.clear()` の後に完了メッセージを追加し、`ui.requestRender()` を呼ぶ。フッターは再描画時に `getContextUsage()` を読むので 0 が表示される。
- `slash-commands.ts` の `BUILTIN_SLASH_COMMANDS` に `{ name: "clear", description: "Clear the conversation context (keeps model, thinking level, and extension state)" }` を追加する。

**拡張への通知**: 行わない。`session_start` は発火しないので、tsrepl の変数や TODO パネルはそのまま残る。spirits の `goal()` は、明示ゴールがあれば複製されたエントリから同じ値を返す。明示ゴールが無ければ、`/clear` 後の最初のユーザーメッセージを返す(既存の解決規則どおり)。

### 7. `/clear` の確認: 確認ダイアログを出さない

**選択肢と理由:**
- **A. 確認なしで即時実行(採用)**: 以前の会話は削除されず `/tree` で戻れるので、誤操作から回復できる。
- **B. `ctx.ui.confirm()` で確認(不採用)**: 回復できる操作に摩擦を足すだけになる。

## Risks / Trade-offs

- [Risk] `AgentSession` に、`agent.state.messages` 以外にも以前のブランチから作ったキャッシュがあり、`/clear` 後の要求に以前の会話が混ざる → Mitigation: suite テストで、faux provider が受け取った次の要求のメッセージが新しいユーザーメッセージ 1 件だけであることを確認する。
- [Risk] `/clear` のたびにカスタムエントリが複製され、セッションファイルが大きくなる → Mitigation: 複製するのは現在のブランチ上のものだけで、`/clear` 1 回あたりの増加はその件数に比例する。カスタムエントリは LLM 文脈に入らないので、トークンは増えない。
- [Risk] LLM が `manage_todos` を呼ばず、自然言語で進捗を報告する → Mitigation: `promptGuidelines` で使い方を示す。ツールの使用は強制しない。
- [Risk] LLM が同じ呼び出しで追加した項目の ID を推測して誤る → Mitigation: 全か無かで失敗し、エラーに位置と理由が出るので、LLM は結果の ID を見て出し直せる。
- [Risk] 端末幅の変更でパネルの表示が崩れる → Mitigation: Component の `render(width)` で毎回切り詰める。
- [Risk] `/clear` 後も tsrepl の変数が残り、LLM がその存在を知らない → Mitigation: 利用者の決定として受け入れる。tsrepl のツール説明にある `reset` で利用者や LLM が消せる。
- [Risk] `interactive-mode.ts`、`agent-session-runtime.ts`、`sdk.ts`、`main.ts`、`slash-commands.ts` の upstream 変更と衝突する → Mitigation: 追加だけの小さな差分にし、`[spirits]` プレフィックス付きコミットに分離する。

## Migration Plan

- 既存のセッションファイルは変更しない。`/clear` は追記だけを行い、生成される木(複数ルート)は既存の pi が読める形である。
- ロールバック: `[spirits]` コミットと spirits 側の変更を revert する。`/clear` 済みのセッションは、revert 後も通常のセッションとして読める。leaf は最後のエントリなので、`/clear` 後のブランチが開く。`spirits_todo` エントリは、spirits を revert した後は読まれない記録として残るだけになる。

## Open Questions

- `/clear` 実行中に bash が走っていると、完了時の `BashExecutionMessage` がクリア後の新しいルートに追記され、コマンド本文のない実行結果だけが新しい文脈に現れる(verify2 G-1)。`/new` も同じ既存挙動。`clearConversation()` の拒否条件に `isBashRunning` を加えるか、現状を許容として仕様に明記するかを決める。
