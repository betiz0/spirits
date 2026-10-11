# Design

## Context

一次根拠は `docs/spirits-design.md`(フォーク運用 §5、配布 §4.5)と `docs/spirits-m2-distribution.md`(env-defaults とバージョン埋め込みの決定)にある。本変更は proposal の Why のとおり、M5 の前後で製品 identity を揃えるためのもの。

現状の制約:

- コンパイルバイナリでは `getPackageDir()` が実行ファイルのディレクトリ(`~/.spirits/bin`)を返すため、`piConfig` を読む `package.json` が存在しない。`APP_NAME` / `CONFIG_DIR_NAME` はフォールバック(`pi` / `.pi`)になる。
- `ENV_AGENT_DIR` は `APP_NAME` から派生する。`APP_NAME` を変えると agent dir の override 環境変数名も変わる。
- TUI ヘッダのロゴと文言、CLI バナー、散在する案内文は `piConfig` に追従しないハードコードを含む。
- provider attribution ヘッダ(OpenRouter / NVIDIA / Cloudflare 系)はテレメトリ設定で抑止できるが、opencode 向けの `x-opencode-client: "pi"` は `getSessionHeaders` からテレメトリ設定に関係なく付与される。
- `packages/spirits` は pi の型をローカルミラー(`src/types/pi-coding-agent.d.ts`)で解決し、pi ソースを型検査に持ち込まない。

## Goals / Non-Goals

**Goals:**

- ソース実行(`bun packages/spirits/bin/spirits.ts`)とコンパイルバイナリで同一の identity を得る。配布は単一バイナリのまま。
- TUI ヘッダ、CLI 表示、agent dir の env、テレメトリ名義を spirits に揃える。
- 通常の pi 実行と上流テストの既定挙動を変えない(env 未設定時に従来どおり)。

**Non-Goals:**

- `CONFIG_DIR_NAME` の変更(project 設定は `.pi` のまま)。
- モデル向けツール構成・システムプロンプトの変更(別変更)。
- 専用ロゴのデザインと固定ブランド色(ワードマーク + テーマトークンで開始)。
- `PI_CODING_AGENT_DIR` の後方互換シム。
- spirits 独自の利用計測の導入(spirits はテレメトリを収集しない)。

## Decisions

### Decision 1: identity は `config.ts` の環境変数 override で渡す

`piConfigName` と `CONFIG_DIR_NAME` の解決前に `PI_APP_NAME` / `PI_CONFIG_DIR` を読む。既定は現状のまま(env → package.json → フォールバック)。`bin/bootstrap.ts` が pi を import する前に `PI_APP_NAME=spirits` を設定する。

- 代替案 A: `packages/coding-agent/package.json` の `piConfig` を書き換える。ソース実行は直るが、`.pi` 前提の上流テストが壊れ、リポジトリ内の通常 pi 実行まで spirits 化する。却下。
- 代替案 B: installer が実行ファイル隣に `package.json` を置く。上流の documented な手口だが、単一ファイル配布でなくなり uninstall と README の変更面が増える。却下。
- 代替案 C: `scripts/build-binaries.ts` でソースを書き換える。バイナリだけ直り、ソース実行と identity がずれる。却下。
- 理由: ソースとバイナリで同じ経路を使い、配布物を増やさず、env 未設定時の pi 挙動を変えない。`PI_CONFIG_DIR` も対称性と上流提案のために追加するが、spirits は設定しない。

### Decision 2: project 設定ディレクトリは `.pi` を維持する

`CONFIG_DIR_NAME` は変えない。したがって project 設定・skills・prompts・extensions は `.pi` から読む。

- 代替案: `.spirits` へ変更。製品としては一貫するが、このリポジトリの `.pi/skills`(AGENTS.md と opsx が参照)と上流の `.pi/extensions` が spirits 実行から見えなくなり、上流マージのたびに二重管理が生じる。却下。
- 理由: pi エコシステム互換を優先し、`~/.spirits/agent` は agent dir 側で確保する。`~/${CONFIG_DIR_NAME}/agent` を表示する箇所は custom agent dir でも誤りなので、Decision 6 で解決済み agent dir を使う形に修正する。

### Decision 3: TUI ヘッダは extension が `ctx.ui.setHeader` で差し替える

`session_start` で `ctx.mode === "tui"` のとき spirits ヘッダを設定し、`setExpanded` を実装して起動ヘルプ展開に同期する。`plain` 系モードでは何もしない。

- 代替案: コアのヘッダを `piConfigName` で分岐して brand-aware にする。ビルトインの展開・イースターエッグを維持できるが、コア差分が増え、spirits 固有の文言・色・バージョンを表現できない。却下。
- 理由: コア差分ゼロで表示の自由度が最大。`keyHint` / `keyText` / `rawKeyHint` は `@earendil-works/pi-coding-agent` から export 済みで、ヒント行をそのまま再利用できる。代償として pi ロゴの 3D イースターエッグは失われ、ヘッダ内容は spirits 側で保守する。

### Decision 4: ヘッダのバージョンは `SPIRITS_VERSION` を `src/` から共用する

バージョン解決(`resolveSpiritsVersion` / `formatVersionLine`)を `bin/version.ts` から `src/version.ts` へ移し、`bin` は再エクスポートする。ヘッダは `resolveSpiritsVersion()` を使う。未コンパイル時は `0.0.0-dev`。

- 代替案: コア `VERSION`(ビルド時に pi の `package.json` 版へ置換)をヘッダに使う。ラベルが spirits でも値が pi 版になり、`spirits --version` と不一致。却下。
- 理由: `spirits --version` とヘッダを単一の値に揃え、コア `VERSION` の用途(telemetry、MCP client 名、crash report)を変更しない。

### Decision 5: ヘッダの色はテーマトークンを使う

`theme.fg("accent", ...)` をワードマーク、`dim` / `muted` をバージョンとヒントに使う。

- 代替案: pi ロゴと同じ固定 RGB(`foregroundAnsi` / `rgbColor`)。ブランド性は高いが pi-tui の import と型ミラー/依存の追加が必要。却下(専用ロゴを作る時に再検討)。
- 理由: ユーザーテーマに追従し、依存と型ミラーを増やさない。

### Decision 6: コアの表示修正は `APP_NAME !== "pi"` で分岐して入れる

help のバナー説明文、`~/${CONFIG_DIR_NAME}/agent` を表示する 5 箇所、散在する pi 文言、`getSelfUpdateUnavailableInstruction` の bun-binary 文言、help の update 行(`Update pi, extensions, or model catalogs` と `[source|self|pi]`)を修正する。agent dir 表示は `getAgentDir()` の解決値を使う。非 pi の update 案内は「このディストリビューションの installer を再実行する」という spirits 中立な文言にし、特定 URL をコアに埋め込まない。

- 代替案: `spirits` 固定文言をコアへ直接書く。テストと通常 pi 実行に影響し、上流へ戻しにくい。却下。
- 理由: env 未設定の pi 実行と既存テストの期待値を変えずに spirits の表示を成立させる。1 変更 = 1 コミットに分離し、`[spirits]` を付ける。

### Decision 7: install テレメトリは既定オフ

`env-defaults` に `PI_TELEMETRY=0` を加える。`PI_TELEMETRY=1` の明示指定は従来どおり有効。pi の settings 既定は `enableInstallTelemetry` が真(opt-out)のため、これは実質的な既定変更である。settings.json での opt-in は env の既定設定に上書きされて効かず、有効化の手段は `PI_TELEMETRY=1` に限る。

- 代替案: 既定 on のまま、VERSION だけ spirits にする。pi.dev に fork の install が届き、provider attribution も pi 名義のまま残る。却下。
- 理由: fork から上流の計測へ寄与しない。opt-in の手段は残し、settings での opt-in が効かないことは README に明記する。

### Decision 8: `x-opencode-client` ヘッダは非 pi ディストリビューションでテレメトリゲートする

コア `core/provider-attribution.ts` の `getSessionHeaders` は、opencode 系モデル向けに `x-opencode-client: "pi"` をテレメトリ設定に関係なく付与する。非 pi ディストリビューションでは、このヘッダの付与を `isInstallTelemetryEnabled` と同じ条件(明示的有効化時のみ)に合わせる。pi 実行時の挙動と既存テストの期待値は変えない(`APP_NAME !== "pi"` 分岐、Decision 6 と同じ原則)。`x-opencode-session` は pi 名義ではなく session 識別のため維持する。

- 代替案 A: 仕様の対象をテレメトリゲート済みの attribution ヘッダに狭め、`x-opencode-client` を許容する。コア差分は不要だが、opencode 利用時に pi 名義ヘッダの送信が残る。却下。
- 代替案 B: 値を `APP_NAME` 派生の名義に変更する。pi 名義は消えるが、provider へ新たなクライアント名義を送ることになり、pi の既存挙動との対応も失われる。却下。
- 理由: pi 上流の挙動を変えずに、spirits から pi 名義のヘッダを出さない。

### Decision 9: 型ミラーとモジュール配置

`src/types/pi-coding-agent.d.ts` に `session_start`、`ctx.mode`、`ctx.ui.setHeader`、`Theme`(`fg` の範囲)、`Component`、`pi.getSettings`、`keyHint` / `keyText` / `rawKeyHint` の value 宣言を追加する。ヘッダ実装は `packages/spirits/src/harness/` ではなく `src/branding/` など UI 専用モジュールへ置き、`src/index.ts` から配線する。

- 代替案: pi の型を直接読む。M1 の理由(`@types/bun` とのグローバル衝突)で却下。
- 理由: 既存のミラー運用を維持し、harness(セッション横断メモリ)と UI 表示の責務を分ける。

### Decision 10: `openspec/config.yaml` の Roadmap/rules を更新する

フェーズ外の変更として `product-identity` を扱えるよう Roadmap と rules を更新し、あわせて古い参照(`docs/design.md`、`docs/phases/`)を実在の `docs/spirits-design.md` / `docs/spirits-m*.md` に直す。

- 代替案: `binary-distribution` に折り込む。仕様は書けるが、配布と表示が混ざり capability の範囲が曖昧になる。却下。
- 理由: 表示・runtime identity・テレメトリは独立して観測できる。

## Risks / Trade-offs

- [Risk] ユーザーが pi コアを直接起動した場合(`cli.ts -e packages/spirits/src/index.ts`)は identity が pi のまま残る。→ Mitigation: 開発の既定は `bin/spirits.ts` とし、README に両経路の違いを明記する。拡張の機能は identity に依存させない。
- [Risk] `PI_APP_NAME` により agent dir の override 環境変数が変わり、`PI_CODING_AGENT_DIR` を明示設定していた利用者が無視される。→ Mitigation: proposal に **BREAKING** として記載し、README の環境変数名を更新する。既定パスは変わらないためデータは保持される。
- [Risk] extension ヘッダがビルトインのヒント文言を複製し、上流の変更に追従しない。→ Mitigation: 文言は spirits の判断で更新し、`keyHint` などは export を使う。上流マージ時にヘッダのヒント一覧を確認する。
- [Risk] pi ロゴのクリックイースターエッグが失われる。→ Mitigation: 仕様上不要とし、必要になれば spirit 用の演出を別途設計する。
- [Risk] `quietStartup` の取得タイミングによってはヘッダが一瞬表示される。→ Mitigation: `session_start` で `pi.getSettings()` を読み、非表示設定時は `setHeader` を呼ばない。取得不能時はビルトインにフォールバックする。
- [Risk] テレメトリ既定変更で、以前 opt-in していた利用者の計測が止まる。→ Mitigation: `PI_TELEMETRY=1` で再開できることを README に記載する。
- [Risk] コアの `[spirits]` パッチが上流マージで衝突する。→ Mitigation: `APP_NAME !== "pi"` の分岐に閉じ込め、1 変更 = 1 コミットで分離する。
- [Risk] バージョン解決の移動が既存テスト(`bun-gate` / `version`)を壊す。→ Mitigation: `bin/version.ts` は薄い再エクスポートとして残し、`packages/spirits` の `bun test` と `bun run check` で検証する。

## Migration Plan

- データ移行は不要。`~/.spirits/agent/` の既定は変わらない。
- `README.*` と `packages/spirits/README.md` の環境変数名を `SPIRITS_CODING_AGENT_DIR` に更新し、BREAKING をリリースノートに書く。
- ロールバックは env 設定の削除で可能(identity が pi に戻るだけでデータは保持)。

## Open Questions

- `install` / `config` / `auth` など他のコマンド表示を非 pi ディストリビューションでどう扱うか。本変更の仕様には含めず、必要になった時点で別変更とする。
  - verify2 指摘(C-3): product-identity spec の「CLI のバナー、usage、コマンド例 … で実行中のアプリ名を表示する」は usage を含むため、`spirits auth --help` の `pi auth` 固定表示(`packages/coding-agent/src/cli/auth-command.ts:39-43`)は spec 違反と解釈できる。タスク 3.7 で修正するか、spec を狭めてこの Open Question どおり別変更に回すかを判断する。
- verify2 指摘(S-1): binary-distribution spec の「`spirits update` は install.sh の再実行を案内」と design Decision 6 の「spirits 中立な文言」が矛盾していた。3.4 の修正時に spec を「そのディストリビューションの installer の再実行の案内」に緩和し、コアは Decision 6 どおり特定 URL を持たない中立文言のままとした(更新手段としての install.sh は README と installer が示す)。
