# Proposal

## Why

managed 経路(公式 Pi 1.5.0 + spirits 拡張、Pi パッチ無し)では、fork 経路のコアパッチが担っていた role・`/clear`・`/model` の 9 目的のうち 3 つがギャップとして残っていた(`docs/spirits-managed-pi-design.md` §1 B)。既定経路の切り替え(`switch-default-to-managed`)を検討するには、この 3 ギャップが拡張だけで埋まるのか、埋まらないならどの目的をどのような代替で受け入れるのかを、実測付きで確定させる必要がある。fork 経路と同じ bundle が動く制約のまま、ホスト API の有無で分岐する形に収める。

設定の永続化先として Pi の `settings.json` を選ぶと、`defaultProvider` / `defaultModel` の二重所有を避けられ、`ctx.reload()` だけで反映経路が通る(設計文書 §3、訂正 1)。`/clear` の方式は compaction 乗っ取りが公式 1.5.0 で成立しないことを実験で確認した(design.md 付録 B(a))ため、区切り entry + `context` フィルタ方式を採用する。

## What Changes

- **managed 限定のコマンド surface を追加する**。ホストに `registerModelRoles` が無いときだけ `/spirits-model <ref> [level] [role]`、`/spirits-role [normal|strong]`、`/spirits-clear` を登録する。`registerModelRoles` が有るとき(fork 経路)はこれらを登録せず、既存の `/model`・`/clear`・コアの role 系をそのまま使わせる(fork 経路の挙動を変えない)。
- **`/spirits-model`**: 末尾の語から role、その前を thinking level、残りをモデル検索語として解釈し(fork の `/model` と同じ文法)、`pi.setModel()` / `pi.setThinkingLevel()` でその場に適用し、Pi の global `settings.json` に `defaultProvider` / `defaultModel` / `defaultThinkingLevel`(level 指定時)/ `models.role`(role 指定時)を保存する。解決できない語は変更せず通知する。
- **`/spirits-role`**: モデルを変えずに role をロックし、`models.role` に保存し、session には spirits 独自の custom entry(`spirits_role`)へ記録する。公式コアが所有する `pi.virtual-model-state` には拡張から書き込まない。セッション開始時に spirits の entry が無い場合だけ、fork が書いた `pi.virtual-model-state` の最新の role を読み込む(片方向の引き継ぎ)。
- **role badge**: `ui.setStatus()` の footer 拡張 status 行に出す(モデル名隣の fork バッジは再現しない)。制御文字は除去し、除去後に空なら出さない。
- **`/spirits-clear`**: 区切り用の custom entry(`spirits_clear`)を追加し、`context` イベントでそれより前の messages を LLM 文脈から除く。チャット表示は残す(表示の消去は承認のうえ対象外)。session ID・session ファイル・モデル選択・thinking level・TODO・goal・memory は保持する。自動 compaction が区切りより前を要約しないよう、`session_before_compact` で肩代わりし、消した内容を含まない固定の注記を summary にする。
- **設定書き込み**: Pi の `SettingsManager` と同じ手順(proper-lockfile の `lockSync(path, { realpath: false })`、ELOCKED 再試行、ロック下で読み込み → 変更したフィールドだけをマージ → 書き込み → 解放)で global `settings.json` に書き、`ctx.reload()` で反映する。`withFileMutationQueue` は使わない。書き込み後に command の `pi` / ctx ハンドルを使わない(公式は reload 後に stale にする)。
- **`computeManagedEnv` から `PI_APP_NAME` / `PI_CONFIG_DIR` を削除**し、identity の指定を `package.json` overlay に一本化する(公式では無視される死んだ env を立てない)。
- **互換性マトリクスの 9 目的の定義を見直す**。managed 側の実現方式を `currentMechanism` / `alternative` / `difference` に反映し、代替手段で満たした目的は観測 detail に `alternative` であることを明記する。状態は既存の 5 状態(confirmed / limited / unavailable / not-run / failed、および matrix の 4 状態)のままで、新しい状態は追加しない。ランナーは専用 Pi 上で `/spirits-model` / `/spirits-role` / `/spirits-clear` を実際に駆動して目的を観測する。
- **Pi へのパッチは行わない**。PA(`ExtensionContext.modelRuntime`)と PB(`clearConversation`)は上流 issue の下書きを `docs/` に残すだけにする(投稿しない)。
- 第三者拡張が登録した provider を rlm の子で使えない制約を docs に記載する。公式バイナリが表示する Pi の帰属ヘッダはそのまま受け入れる。

## Capabilities

### New Capabilities

- `managed-commands`: managed 経路だけで有効になる spirits コマンド面(`/spirits-model`、`/spirits-role`、`/spirits-clear`)、Pi の settings へのロック付き書き込み、role の spirits 独自 entry への永続化と fork からの片方向の引き継ぎ、拡張 status 行の role badge。

### Modified Capabilities

- `managed-pi`: 継承環境の sanitize から `PI_APP_NAME` / `PI_CONFIG_DIR` の固定を外し、identity を overlay の `package.json` だけで決める。
- `managed-pi-compatibility`: role / clear / model のマトリクスを、managed 側の実現方式と代替の明示を含む定義に変更し、専用 Pi 上での `/spirits-*` の駆動を観測として要求する。

## Impact

- **Pi 上流コアへの差分: なし。** `packages/coding-agent`、`packages/ai`、`packages/tui` は変更しない。fork 側 の role 系コアパッチ(`c3f92bdcd` / `f98e1df53` / `d2d60fbcb` / `d8a526dac` / `7cb50de89`)にも触れない。
- 製品コード:
  - `packages/spirits/src/commands/`(新層): `settings-store.ts`(ロック付き設定書き込み)、`model.ts`(`/spirits-model` の引数解釈と適用)、`role.ts`(`/spirits-role`、role の永続化と引き継ぎ、badge)、`clear.ts`(`spirits_clear` 境界、`context` フィルタ、compaction 肩代わり)、`register.ts`(host 能力による登録の可否)。
  - `packages/spirits/src/index.ts`: 合成のみ。`routing` の位相と `commands` を結ぶ。
  - `packages/spirits/src/constants.ts`: 新 entry 種別・設定キー・コマンド名・status key。
  - `packages/spirits/src/types/pi-coding-agent.d.ts`: `registerCommand` / `ExtensionCommandContext.reload` / `ui.setStatus` / `context`・`session_before_compact` イベント / `buildSessionProjection` の型ミラー。
  - `packages/spirits/src/managed-pi/environment.ts`: `PI_APP_NAME` / `PI_CONFIG_DIR` の設定を削除。
- 依存: `proper-lockfile@4.1.2`(Pi と同一版にピン留め)と `@types/proper-lockfile@4.1.4` を `packages/spirits` に追加(`packages/spirits/bun.lock` 更新)。bundle に inline される。
- アーキテクチャ: `docs/architecture/convention-registry.md` の `registry:layers` / 所属表に `spirits:commands` 層を追加(許可先は `spirits:shared`、`spirits:routing`、`packages/coding-agent`。`entry` の許可先に `spirits:commands` を追加)。
- テスト: `packages/spirits/test/managed-commands-*.test.ts`(新規: 引数解釈、role の永続化と引き継ぎ、設定書き込みと Pi との交互・2 プロセス並行、`/spirits-clear` の各条件、badge)、`managed-pi-env.test.ts`(削除した env)、`managed-pi-compat-matrix.test.ts`。
- ハーネス: `scripts/managed-pi-compat/matrix.ts`(目的定義)、`run.ts`(`/spirits-*` の駆動と観測)、`fixtures/probe-extension.ts`(専用 Pi 側の記録)、`evidence.ts`(証拠文)。
- docs: `docs/spirits-managed-pi.md`(コマンド一覧とマトリクスの読み方)、新規 `docs/spirits-upstream-issues.md`(PA / PB の issue 下書き)、`docs/spirits-m3-rlm.md` の第三者 provider 制約の追記確認。
- 非範囲: 既定経路の切り替え、managed のガードの変更、fork の削除、bundled-skills の整理、Pi のパッチ(P-SOURCE)、上流への issue 投稿、子への `modelRuntime` の受け渡し、`/spirits-clear` でのチャット表示の消去。
