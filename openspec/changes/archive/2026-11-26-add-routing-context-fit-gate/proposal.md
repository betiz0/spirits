# Proposal

## Why

`spirits/auto` はロールごとに別の物理モデルへ振り分けるので、会話は同じまま、応答するモデルの収容量だけが変わることがある。strong(大きい枠)で積み上げた会話のあとに既定の normal(小さい枠)へ戻る区間が典型で、この区間の最初の入力は、小さい枠では扱い切れない量の会話を背負って始まる。固定版 Pi 1.6.0 は振り分け先の `contextWindow` で送信前に圧縮するが、圧縮後に再判定しない。圧縮が失敗しても、圧縮後も枠を超えていても、そのまま会話リクエストを送る。利用者は provider の context overflow か、途中までしか読めない返答を受け取り、何が起きているか分からない。

## What Changes

- `spirits/auto` を選んでいるセッションでは、次のリクエストの応答モデルの収容量と、入力を受信した時点で積まれている会話(展開前の本文とブランチ射影の推算)を、リクエストを開始する前に比べる。pi の自動 compaction の閾値(収容量から reserve を引いた値)を越えていればそのリクエストの前に compaction を走らせ、圧縮後の会話を同じ基準でもう一度測る。判定には pi が設定から解決する reserve・keep・閾値の式を使い、公称の収容量の内側でも reserve を越えた会話は断る。保証するのは受信時点の会話までで、スキル・テンプレート展開で増える量と実行中のロール切り替えは host の挙動に任せる。
- 圧縮後も収まらない、または圧縮が成立しなかった場合は、**その会話リクエストを送らず**、理由(応答するはずだったモデルとその収容量・閾値、推算、断った根拠)を 1 件出して、入力を取り消さない。ロールのロックと継続中のステップは既存のステップ開始確認と同じ巻き戻しで入力の前の位置へ戻し、その位置がリロード後に読み返されることを契約にする。対話端末では入力欄へ本文を戻す。
- gate が走らせる先行圧縮の要約は、要約対象の span を収容できる直近の成功モデルで走らせる。振り分け先の小さいモデルが、自分では収容できない会話を要約して圧縮に失敗する状態を無くす。gate に属さない `direct` リクエスト(分岐の要約など)は変更しない。
- 自動圧縮が無効のときは spirits は圧縮しない(設定を打ち消さない)。この場合も収まらないリクエストは断り、理由に設定が効いていることを名指す。拒否の閾値は有効時と同一数値で、`enabled` に依存しない。
- gate の対象は対話端末と RPC のモードでモデルリクエストを開始する idle 入力だけにする。実行中の run に合流する入力(steering / follow-up)、モデルリクエストを開始しない入力(拡張コマンド、host コマンド、bash へ逃がす入力)、拡張から送られた入力、print / JSON モードの入力は対象外にする。待ち受け中の後続入力は元の入力の確定の後で処理され、Esc による取り消しは pi の既存の abort 経路に従う。
- 物理モデルを選んでいるセッションでは gate を働かせない。Pi 自身の圧縮に任せる。
- 実行中にロックしたロールへ変わった continuation(小さい枠へ切り替わる continuation)は今回の対象外にする。host に送信直前へ拒否を渡す口が無いため、Pi の閾値圧縮と overflow 復旧を後段の受けとして文書に記録し、要求として `docs/spirits-upstream-issues.md` へ残す。

## Capabilities

### New Capabilities

(なし)

### Modified Capabilities

- `dual-model-routing`: 振り分け先の収容量と会話を比較する gate、越えているときの先行圧縮、圧縮後も収まらないときの送信拒否と理由、先行圧縮の要約先の規則(gate の在職中のみ)、断ったときの入力とロール状態の保存(既存の巻き戻しの復元契約)、gate の適用範囲(どの入力が対象でどれが対象外か、対話端末と RPC の限定)、待ち受け中の順序と取り消し

## Impact

**実装**

- `packages/spirits/src/routing/fit.ts`(新しい module): 共有する測定処理だけ(projection からの推算と閾値判定、span の収容述語)。入力制御とモデル解決は置かない(呼び出し元が 1 か所になったら inline する)
- `packages/spirits/src/routing/register.ts`: idle 入力での gate の配線、先行圧縮の在職フラグ、断ったときの既存巻き戻し(`undoInput`/`undoToken`)と badge の描き直し
- `packages/spirits/src/routing/router.ts`: gate 在職中の `direct` の要約先解決(それ以外の `direct` は不変)
- `packages/spirits/src/constants.ts`: gate の通知文言・語彙・対象入力の判別 prefix などの FILE-LOCAL / PROJECT-GLOBAL 定数
- `packages/spirits/test/`: gate の判断、先行圧縮の要約先、print / JSON の素通し、取り消し、リロード後の復元位置、送信しないことの実測、既存の routing/managed-commands スイートの追随
- `scripts/managed-pi-compat/`: `contextWindow` の異なる物理モデル 2 種の fixture と、「断った区間の会話リクエスト 0 件 + 拡張通知 1 件」「先行圧縮の要約が振り分け先より収容量の大きいモデルで走る」を実観測に加える
- `docs/spirits-managed-pi.md`: gate の振る舞い、対話端末と RPC の限定、Esc での取り消し、run 中のロール変更が対象外である制約
- `docs/spirits-upstream-issues.md`: 圧縮後の再判定と送信拒否を host が拡張に渡していない件

**ホストの公開面への依存(使う exports)**

- `pi.on("input")` と `InputEventResult` の `{ action: "handled" }`(run を開始させずに止める唯一の口。`before_agent_start` は cancel を返せない)
- `ExtensionContext.compact()` と `CompactOptions` の `onComplete` / `onError`(idle 入力では run が無いので待ち合わせできる)、`ExtensionContext.mode` / `hasUI`(print / JSON を素通しする判別)
- `ExtensionUIContext.setEditorText`(断った本文を対話端末へ戻す。RPC では `extension_ui_request` の `set_editor_text` として流れ、復元は host 実装依存)、`ExtensionUIContext.notify`(RPC では `method: "notify"` の拡張通知)
- `pi.registerVirtualModel` の `route(request)` が運ぶ `reason: "direct"` / `messages` / `previous`(先行圧縮の要約リクエストの解決)
- host の compaction 規則の公開 export(`estimateTokens`、`shouldCompact`(テストの drift ガード)、`buildSessionProjection`、`getLatestCompactionEntry`)と `pi.getSettings()` の compaction 設定
- 依存する host の挙動: 仮想モデルの振り分け先 `contextWindow` に対する送信前の閾値圧縮、`reason: "direct"` の要約リクエストの route 経由の解決(いずれも Pi 1.6.0 で実測して design に記録する)

**固定値・配布物への影響**

- `PINNED_PI`(host 版・artifact sha・overlay)は変えない。しきい値は host の `compaction` 設定(reserve / keepRecent)を読み、spirits 側に新しい数値の既定は増やさない。拒否の式は `shouldCompact` と同一で `enabled` の判定だけ除く(drift はテストで検出)
- gate の通知文言と判別 prefix は `src/constants.ts` の 1 か所に置く
- 配布物は extension bundle と manifest の内容のみ。バイナリ・host artifact・installer は不変
