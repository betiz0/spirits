# Proposal

## Why

spirits は公式 Pi `1.5.0` に固定しているが、上流は 2026-11-20 に `1.6.0` を公開しており、公式 Linux x64 配布物・SHA256SUMS・npm の型パッケージが揃って公開後 48 時間の待機門も過ぎている。固定版を上げないと、利用者は spirits 経由では 1.6.0 の修正 (session 置換時の診断の取りこぼし、`/resume` の誤選択、大きな diff のレンダリングクラッシュなど) に届かない。

同時に、この bump が `host-upgrade` 仕様の隙を 3 つ可視化する: 手順書のうち host コマンド語の照合と固定値の文書更新が要件に無い、ホストの TUI component 契約を手写しした箇所が 1 か所あって 1.6.0 の `render()` の戻り値変更を型で検出できない、本仕様の「旧版への戻し方」が廃止済みの fork 経路 (`SPIRITS_ROUTE=fork`) を依然要求している。

## What Changes

- 固定ホストを Pi `1.5.0` から `1.6.0` へ上げる (`packages/spirits` の devDependencies、`PINNED_PI` の版・artifact SHA256・overlay 版・overlay SHA256)。対象版は本変更で `1.6.0` に固定する。実測中に新しい stable が出ても対象を変えず、別の版は別の計画として選定し直す。
- 手順書が実際に要求する実測を、手順順どおりに、実行環境の前提込みで通す: 型の pin と型検査 → 公式 tarball の取得と SHA256SUMS 照合 → `PINNED_PI` (overlay SHA256 は照合済み配布物から生成した実測値) → bundle と manifest 生成 → 公式モードの互換性ランナー (一次) → ビルドした起動役の tmux 対話確認 → 新版 host の `--help` と起動役が予約する語の照合 → `bun run check` と `bun test` → 文書の固定値更新 → 利用者が承認した commit からの正式な再測定。
- **BREAKING**(スピリッツ内部の型): ホストが所有する配列を返す面の契約をホストの公開 export から導く。`packages/spirits/src/branding/header.ts` の `HeaderComponent` は `render(width: number): string[]` を手写ししており、1.6.0 で `render()` が `readonly string[]` を返し、`Container` は子が変わらない限り同じ配列を返すようになったことを型検査が検出できない。`src/types/host.ts` が pi-tui から導出している `Component` に寄せる。
- 手順書が実際に確認している対話観測 (`/spirits-role` の一覧と status 行の badge、TODO パネルと折りたたみキー) を tmux 検証の要件に落とし込む。
- 本仕様の「旧版への戻し方」から fork 経路の要求を外し、直前の spirits release 資産 (実行ファイルと managed 一式を同じリリースから、SHA256 検証付きで戻す) を正とする。フォーク Era の再ビルドは歴史的な最終手段として残す。
- 手順書を「読んだそのままで再実行できる」形に締める: 依存導入の `--ignore-scripts`、overlay SHA256 を **生成された overlay `package.json` 本文の SHA256** として定義しその計測コマンドを書く、作業ディレクトリを移す手順で検証スクリプトを絶対パスで示す、コマンド語の照合で語表を変えた場合と正式再測定での起動役再ビルド、文書の固定値を grep で照合して 0 件で完了とする確認、候補を棄却した場合の記録 (棄却した版・満たさなかった条件・欠けた配布物名)。tmux 検証の回収は host の終了コマンド `/quit`、モデル警告の観測は別 run、ポートの予約と `run` / `check` を同じ隔離 state dir で回すことを証拠として残す (design D10)。
- 戻し方を実害のない形に締める: SHA256 検証が通るまで実行ファイルも一式も配置しない (検証の終了コードで止め、失敗時に次行の `mv` / `rm` へ流さない)、検証済みの manifest / bundle を明示して導入し既定の配信元解決に左右されない、`~/.spirits/managed-pi/agent` の設定・セッションを削除対象に含めない、正本を 1 つに絞る (design D13)。
- 互換性の成功判定を `confirmed` 一本へ同期する: 本仕様の「公式 artifact での互換性実測」は必須観測に `confirmed` を要求し、`limited` / `unavailable` / `not-run` を成功に数えない実装 (`Compatibility met`) と `managed-pi-compatibility` に揃える (design D12)。
- 「最新版」の運用定義を追加する: 更新対象は公式リリースとして公開済みで、SHA256SUMS に Linux x64 の値があり、対応する npm の型パッケージが両方 `bunfig.toml` の `minimumReleaseAge` を過ぎている版に限る。選定した版は変更内で固定する。
- ホストが連れてくる推移依存 (`lovely-mermaid@0.3.3` の追加、`grok-mermaid` の除去、`undici`、`openai`、`@google/genai` など) を対象版の宣言どおり採用し、spirits 側にラッパーや互換層を追加しない。実際の差分・利用者に見える上流の挙動変更・撤回条件を記録する。
- 対象外: spirits のリリース発行 (自己更新の検証は手順書どおり行うが、公開は行わない)、新ホスト API の採用、role / `/clear` / `/model` の限定互換の解消 (1.6.0 にも `registerModelRoles` は無いことをリリースノートで確認済み)。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `host-upgrade`:
  - 「ホスト版の更新手順」に host コマンド語の照合、公式配布物の検証、tmux 検証と自己更新の検証の実行環境の前提、互換性実測の一次 / 正式の二段階、README を含む文書の固定値更新を加える。
  - 「公式型による型検査」で、型ミラー禁止を `src/types/` の外の手書き component 契約にも及ぼし、返り値の配列の所有権の変更を型が止めることを test で継続検証する (cast は代入可能性を証明しないため、用例は host 由来の型で直接受け取る)。
  - 「tmux 検証」の確認対象に、spirits がホストの TUI に登録する描画面、一式の版の確認、検証後の回収を加える。
  - 「旧版への戻し方」を直前の spirits release 資産への戻しに更新し、fork 経路の案内を禁止し、一式の作り直しでは版を戻せないことを明示する。さらに検証が失敗したら配置しないこと、検証済みの組を明示して導入すること、managed agent root 配下の agent dir を消さないことを要求に加える。
  - 「公式 artifact での互換性実測」の必須観測を `confirmed` に揃える (D12)。
  - 「ホスト版の更新手順」に手順のそのままの再実行可能性 (計測コマンド、絶対パス、ライフサイクルスクリプトを実行しない導入、記録値の照合コマンド) と、コミット後の失敗とコミット前の中止の区別を加える。
  - 「tmux 検証」に終了コマンド・別 run・ポートを予約した回収の確認を加える。
  - 「ホスト版の候補選定」を新設する。
  - 「ホストの推移依存の採用」を新設する。

`managed-pi-compatibility` は変更しない。1.6.0 の `render()` の所有権の変更は RPC 経路から観測できないため、互換性マトリクスに新観測を足さず、型検査と tmux 検証で担保する (design の D4)。

## Impact

**ホストの公開面への依存 (使う exports)**

- `@earendil-works/pi-coding-agent` (`.` と `./rpc-entry`) と `@earendil-works/pi-tui` の exports map は 1.6.0 でも変わらない (1.5.0 と 1.6.0 の公開 `package.json` を実測して一致を確認)。`keyHint` / `keyText` / `rawKeyHint`、`ExtensionAPI`、`ExtensionContext`、`ToolDefinition`、`Theme` などの公開シンボルに対する `tsc --noEmit` が 1.6.0 の型で通ることを手順 3 で確認する。
- 共有する schema ライブラリ `typebox` は 1.6.0 も `1.3.27` で、spirits の依存と同一。extension externals (`pi-coding-agent`、`pi-tui`、`typebox`) は変更しない。
- `@earendil-works/pi-mcp`、`@earendil-works/pi-codemode`、`@earendil-works/pi-agent-core` は 1.5.0 の `bun.lock` に既にあり、1.6.0 で「増える」依存ではない。1.6.0 で実際に移るのは host 直下から `grok-mermaid@0.2.3` を除き `lovely-mermaid@0.3.3` を足す移動、`undici` 8.12.3 → 8.12.4、`pi-ai` 配下の `openai` 7.19.0 → 7.59.0 と `@google/genai` 2.21.0 → 2.32.0 で、`openai@7.59.0` は `google-auth-library` の optional peer を追加する。spirits は deep import せず、これらのラッパーも増やさない (design の D8)。
- 上流の挙動変更のうち利用者に見えるもの: find tool のパスパターンが検索ディレクトリ基準になる (#12066)、`openai` / `azure` / `openai-codex` の既定モデルが `gpt-6.2-sol` になる、`enabledModels` / `--models` の警告が起動時の 1 回になる (#11264)。find の glob は spirits の skill・拡張の呼び出し経由で効くため、手順書の記録と実測で挙動を確認する。

**固定値・配布物への影響**

- `packages/spirits/src/constants.ts` の `PINNED_PI` (版、`pi-linux-x64.tar.gz` の SHA256、overlay 版 `1.6.0-spirits.1`、overlay SHA256)。1.6.0 の `pi-linux-x64.tar.gz` は 58,977,130 バイト、SHA256 `ef77dbe4379b3bdeb425a1e1b862fa3c915c255000dfe4965c98eee96a5765d1` (公式リリースの SHA256SUMS を 2026-11-25 に実測)。overlay SHA256 は照合済み tarball を展開した `package.json` から生成決定的に決まる値なので、配布物の取得と照合の後で実測して埋める (design の D6)。
- `packages/spirits/package.json` の devDependencies `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` と、それに伴う `bun.lock` の解決 (`bun install --ignore-scripts`、`PI_ALLOW_LOCKFILE_CHANGE=1` でのコミット、ホストピン以外の移動が無いことを `scripts/check-lockfile-commit.mjs` で確認)。
- 生成物: `spirits-managed-pi-manifest.json` の `pi.version` / `pi.artifact.sha256` / `overlay.version` / `overlay.sha256`。manifest を読む検証・インストール・互換性ランナーの `host version` 観測は同じ `PINNED_PI` を参照するので、追加のコード変更は要らない。

**影響するコードとテスト**

- `packages/spirits/src/branding/header.ts` (component 契約の導出)、`packages/spirits/src/managed-pi/host.ts` (コマンド語の照合結果による増減)、`packages/spirits/src/managed-pi/manifest.ts` と `src/commands/role-panel.ts` の版を名指しするコメント。
- 版と固定 SHA256 を独立した期待値として持つテスト (`test/managed-pi-fixtures.ts`、`managed-pi-host`、`managed-pi-overlay`、`managed-pi-manifest`、`managed-pi-release-assets`、`managed-pi-repair`、`managed-pi-cli`、`managed-pi-compat-env`、`managed-pi-compat-host-version`、`managed-pi-compat-data`、`managed-pi-compat-runner`、`managed-pi-integration`、`update-routing`)。値の期待は独立リテラルとして保ち、`PINNED_PI` への伝播を検査する既存ケースと役割を分ける (design の D5)。アーキテクチャ検査の fixture が持つ版リテラルは検査の証拠ではないため変更しない。
- 文書: `docs/spirits-host-upgrade.md` (手順そのものと実測記録)、`docs/spirits-design.md` (固定版の記述)、`docs/spirits-managed-pi.md` (対応表)、`docs/spirits-default-launch.md` (初回起動と戻し方の節)、README 4 言語版 (`README.md`、`README.ja.md`、`README.zh.md`、`README.de-CH.md`) が持つ 1.5.0 の tarball サイズと導入後の容量。`docs/agent-data-compat/` と `docs/spirits-managed-pi-design.md` と `docs/spirits-upstream-issues.md` は 1.5.0 の実測記録として残す。
- Rollback の手順書は文書変更だが、隔離 HOME で「検証失敗時に何も配置されない」「一式を差し替えても `managed-pi/agent` の設定・セッションが残る」の 2 ケースを実測してから書く (design D13)。実装コードは変えない。
- CI は `bun run check`・`bun test`・起動役のビルド・インストーラのテストのみで、互換性ランナーは公式 tarball を要するため手元実行のまま。`scripts/install.test.sh` と `scripts/self-update-smoke.sh` と `scripts/tmux-verify.test.sh` の一部は検証用配信元に `python3 -m http.server` を使い、検証機側の python3 自体は欠けていないが、本変更を進めるセッションは python3 を実行できない。そのため当該手順は利用者または許可された環境での実行結果の受領を完了条件にする (design の D7)。
