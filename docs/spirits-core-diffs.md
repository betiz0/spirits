# Pi コア差分の登録簿

 spirits は Pi のフォーク上に構築する。件名が `[spirits]` で始まるコミットは、この登録簿に 1 行 = 1 コミットで登録する。Pi 上流コア(`packages/spirits/` を除く `packages/` 配下)を変えるコミットに加え、コア実装を変えない `[spirits]` コミットも同じ表に載せる。方針は [`docs/spirits-design.md`](spirits-design.md) §5、取り込み手順は [`docs/spirits-upstream-sync.md`](spirits-upstream-sync.md)。

件名だけで範囲を決めるのは、突き合わせを機械的に実行するためだ。コア差分かどうかの判定を毎回入れると、確認コマンドと行数を一致させられない。`git log -E --grep='^\[spirits\]'` はコミットメッセージにしか依存せず、意図と対象ファイルが復元できない。上流 merge で「消えるべきでない差分が消えた」ことの検知は、この一覧が無いと書けない。

## 規律

- `[spirits]` プレフィックスのコミットを作成したら、**同じ変更で**この登録簿に行を追加する。
- 1 行 = 1 `[spirits]` コミット。コア実装を変えない `[spirits]` コミットも含める。
- 対象ファイルは、そのコミットの実ファイル一覧から、上流追従で中身を確認する必要があるものを書く。複数ファイルにまたがるディレクトリ一式はディレクトリで表す。OpenSpec の変更アーティファクトのディレクトリは書かない(アーカイブで移動し、上流追従で確認する対象ではないため)。
- 導入した変更が OpenSpec の変更アーティファクトを持つ場合はその名前を書き、無い場合は「変更アーティファクト前」と書く。
- 上流の取り込み後は行が消えていないかを確認する。手順は `docs/spirits-upstream-sync.md` §4。

## 確認方法

```sh
# 登録簿に載っていない [spirits] コミットが無いこと、行数が一致すること
git log -E --grep='^\[spirits\]' --oneline
```

## 登録簿

| コミット | 対象ファイル | 意図 | 導入した変更 |
|---|---|---|---|
| `e4ed6a5e7` | `packages/coding-agent/src/config.ts`、`packages/coding-agent/docs/environment-variables.md`、`packages/coding-agent/test/app-identity.test.ts` | `PI_APP_NAME` / `PI_CONFIG_DIR` を env 優先で解決する。コンパイル済み配布には兄弟 `package.json` が無く `piConfig` で改名できないため | 変更アーティファクト前 |
| `99b278d2d` | `packages/coding-agent/src/cli/args.ts`、`packages/coding-agent/src/config.ts`、`packages/coding-agent/src/core/provider-attribution.ts`、`packages/coding-agent/src/extensions/mcp/cli.ts`、`packages/coding-agent/src/modes/interactive/components/config-selector.ts`、`packages/coding-agent/src/modes/interactive/interactive-mode.ts`、`packages/coding-agent/src/package-manager-cli.ts`、`packages/coding-agent/test/args.test.ts`、`packages/coding-agent/test/config.test.ts`、`packages/coding-agent/test/format-resume-command.test.ts`、`packages/coding-agent/test/sdk-openrouter-attribution.test.ts` | 非 pi の identity を CLI 表示に反映し、pi 帰属の provider ヘッダを telemetry 明示時のみに限定する | 変更アーティファクト前 |
| `8cd1823f1` | `packages/coding-agent/src/config.ts`、`packages/coding-agent/src/package-manager-cli.ts`、`packages/coding-agent/test/package-command-fork-update.test.ts` | 非 pi の bun バイナリに対して、pi のリリース URL でなく spirits のインストーラを案内する | 変更アーティファクト前 |
| `a26fec8ee` | `packages/coding-agent/src/cli/auth-command.ts`、`packages/coding-agent/test/args.test.ts` | auth ヘルプのアプリ名を identity に従わせる | 変更アーティファクト前 |
| `c14ea65cf` | `packages/coding-agent/src/modes/interactive/interactive-mode.ts` | 非 pi 配布では built-in ヘッダを遅延適用し、spirits のヘッダで置き換える余地を残す | 変更アーティファクト前 |
| `9aa13a844` | `packages/coding-agent/src/core/agent-session-runtime.ts`、`packages/coding-agent/src/core/sdk.ts`、`packages/coding-agent/src/core/slash-commands.ts`、`packages/coding-agent/src/main.ts`、`packages/coding-agent/src/modes/interactive/interactive-mode.ts`、`packages/coding-agent/test/interactive-mode-clear-command.test.ts`、`packages/coding-agent/test/suite/agent-session-runtime-clear.test.ts` | `/clear` で会話コンテキストだけをリセットする。セッションファイル、モデル、thinking level、拡張 entry は残す | 変更アーティファクト前 |
| `0769d73dd` | `packages/coding-agent/docs/models.md`、`packages/coding-agent/docs/usage.md`、`packages/coding-agent/src/core/slash-commands.ts`、`packages/coding-agent/src/modes/interactive/components/custom-editor.ts`、`packages/coding-agent/src/modes/interactive/interactive-mode.ts`、`packages/coding-agent/src/modes/interactive/model-command-args.ts`、`packages/coding-agent/test/custom-editor-submit-shortcut.test.ts`、`packages/coding-agent/test/interactive-mode-model-command.test.ts`、`packages/coding-agent/test/model-command-args.test.ts` | `/model <provider/model> <level>` でモデルと thinking level を同時に設定し、`app.models.save` / `app.thinking.save` で既定として保存する | 変更アーティファクト前 |
| `69300e206` | `packages/ai/scripts/generate-models.ts`、`packages/ai/test/supports-xhigh.test.ts` | Claude 5.5 系を手書きメタデータでなく models.dev のデータで生成する | 変更アーティファクト前 |
| `9edd6311c` | `.github/workflows/spirits-ci.yml`、`docs/architecture/convention-registry.md`、`packages/spirits/test/architecture/`、`packages/spirits/test/architecture-conventions*.test.ts`、`openspec/config.yaml` | 依存方向を規約正本と検査で強制する。Pi コアの実装ファイルは変更しないが、`[spirits]` コミットとして登録する | `add-architecture-conventions` |
| `80d9bbeaf` | `packages/spirits/src/harness/bundled-skills/`、`README.md`、`README.ja.md`、`README.de-CH.md`、`README.zh.md`、`docs/spirits-design.md` | `sprt-opsx-review-change` と `sprt-opsx-verify-deep` を bundled skill に追加し、`sprt-architecture-guards` へ改名する。Pi コアの実装ファイルは変更しないが、`[spirits]` コミットとして登録する | `add-sprt-bundled-skills` |
| `c3f92bdcd` | `packages/coding-agent/src/core/virtual-models.ts`、`packages/coding-agent/docs/virtual-models.md` | `ModelRoute` と `VirtualModelStateData` に任意の `role` ラベルを追加する。コアは値を解釈しない opaque な文字列で、ルーティングの語彙は spirits 側だけが持つ | `add-dual-model-routing` |
| `f98e1df53` | `packages/coding-agent/src/core/model-runtime.ts`、`packages/coding-agent/src/core/agent-session.ts`、`packages/coding-agent/test/virtual-models.test.ts` | `resolveModel` が `route.role` を透過し、`AgentSession` が role を `pi.virtual-model-state` entry に保存し、分岐から role を読み出せるようにする | `add-dual-model-routing` |
| `d2d60fbcb` | `packages/coding-agent/src/modes/interactive/components/footer.ts`、`packages/coding-agent/test/footer-width.test.ts` | footer 右側表示の先頭に `[<role>]` バッジを前置する。provider 前置の縮退と末尾切り詰めは既存の経路のまま | `add-dual-model-routing` |
| `d8a526dac` | `packages/coding-agent/src/core/agent-session.ts`、`packages/coding-agent/src/core/virtual-models.ts`、`packages/coding-agent/docs/virtual-models.md`、`packages/coding-agent/test/virtual-models.test.ts` | `AgentSession.routedRole` を `routedModel` と独立に追加し、成功レスポンスが無くても分岐の role を返す。保存された role が文字列でなければロール未決定として扱い、描画が止まるのを防ぐ | `add-dual-model-routing` |
| `7cb50de89` | `packages/coding-agent/src/modes/interactive/components/footer.ts`、`packages/coding-agent/test/footer-width.test.ts` | バッジ専用の除去処理(C0 制御文字と DEL を空白に、空ならバッジを出さない)を追加し、role を `routedRole` から読む。拡張ステータスの `sanitizeStatusText` は変えない | `add-dual-model-routing` |
| `a59d23dd0` | `packages/coding-agent/src/core/extensions/`、`packages/coding-agent/src/index.ts`、`packages/coding-agent/src/core/settings-manager.ts`、`packages/coding-agent/src/core/slash-commands.ts`、`packages/coding-agent/src/modes/interactive/interactive-mode.ts`、`packages/coding-agent/src/modes/interactive/model-command-args.ts`、`packages/coding-agent/docs/extensions.md`、`packages/coding-agent/test/model-roles.test.ts`、`packages/coding-agent/test/model-command-args.test.ts`、`packages/coding-agent/test/settings-manager.test.ts`、`packages/coding-agent/test/interactive-mode-model-command.test.ts`、`packages/coding-agent/test/interactive-mode-status.test.ts`、`packages/coding-agent/test/custom-editor-submit-shortcut.test.ts` | `pi.registerModelRoles()` で拡張が `/model` のロール語彙を登録できるようにする。pi はロールを opaque な文字列として扱い、語彙・保存先 settingsKey・`onSelect` を 1 件の登録として保持し(再登録は置換)、`/model` は末尾から role、thinking level の順に剥ぎ、保存キーでは未知 field の入れ子 1 キーだけを書く `setExtensionNestedSetting` を使う | `add-model-role-setting` |
