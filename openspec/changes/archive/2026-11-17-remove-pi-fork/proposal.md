# Proposal

## Why

spirits は Pi (earendil-works/pi) のフォークで、コアへ 16 件の `[spirits]` 差分を当て、Pi のソースツリー (`packages/*`) をリポジトリ内に持ち、起動役の実行ファイルに Pi を内包している。この構成は上流追従のたびに 63 箇所以上の突き合わせと登録簿の存在確認を要求し、フォーク経路と managed 経路の 2 系統を並存させている。既定経路は既に managed へ切り替わっており、フォーク経路は「戻し先」として残っているだけである。

Pi の版を更新する本当のコストはソースの merge ではなく、ホストの固定 artifact の差し替えである。フォークを外し、公式 Pi の artifact をホストとして起動する薄い起動役にすれば、Pi への差分は 0 件になり、版更新は `packages/spirits` の固定 devDependency の更新と `tsc` による型検査、manifest の `pi.version` と sha256 の更新、公式 artifact での互換性実測に置き換えられる。

## What Changes

- **BREAKING**: 起動役を Pi を内包しない薄い実行ファイルにする。`packages/spirits/bin/` はホストを import せず、`spirits update` / `spirits managed-pi` / 既定の managed 起動だけを行う。
- **BREAKING**: フォーク経路と `SPIRITS_ROUTE=fork` を廃止する。`SPIRITS_ROUTE=fork` が設定されたままホストを起動しようとした場合は、黙って無視せず、理由と戻し方を表示して非ゼロで終了する。`update`、`managed-pi`、`--version`、`--help` は通常どおり動く。
- **BREAKING**: 未コンパイル (ソース) 実行も managed を起動する。一式が未導入なら取得せず、`spirits managed-pi install` または `SPIRITS_MANAGED_PI_MANIFEST_URL` による導入方法を表示して終了する。コンパイル済みは従来どおり同じリリースから自動取得する。
- **BREAKING**: `spirits update` は自己更新形 (`update`、`self`、`pi`、`--self`、`--force` など) だけを受け付ける。`--extensions`、`--models`、`--all`、未知の引数は、`spirits managed-pi update` と `spirits -- update <引数>` を案内して非ゼロで終了する。
- **BREAKING**: 起動役、インストーラ、自己更新はテーマ資産を取得・配置しない。旧版の自己更新が失敗しないよう、リリースには `dark.json` / `light.json` と `.sha256` を互換用として添付し続ける。
- **BREAKING**: フォーク経路だけにあった `/model` の role 語彙と保存キー、footer の `[role]` バッジ、フォークの `/clear` を削除する。代替は `/spirits-role`、拡張の status 行のバッジ、`/spirits-clear`。
- **BREAKING**: provider 帰属ヘッダの抑制をやめ、ホストの既定のヘッダをそのまま受け入れる。
- 型ミラー (`packages/spirits/src/types/pi-coding-agent.d.ts` / `pi-tui.d.ts`) と `scripts/check-pi-type-mirror.ts` を廃止し、固定した公式パッケージを `packages/spirits` の devDependency として完全固定で入れ、tsc に実型で検査させる。`src/types/` にホスト型の再宣言を置かない。
- 失敗時の表示からフォークへの案内 (`SPIRITS_ROUTE=fork spirits`) を外し、修復コマンド `spirits managed-pi repair` と旧版への戻し方 (タグからの再ビルド、`~/.spirits/bin` の退避) に置き換える。
- `packages/` 配下の Pi のソースツリー (spirits 以外の 14 パッケージ、1829 ファイル) と、ルートの pi-monorepo 構成 (package.json、lockfile、tsconfig、biome、vitest、nix、husky、pi-test.*、test.sh) を削除し、ルートを spirits 単独の構成にする。
- Pi の版更新手順を `docs/spirits-host-upgrade.md` として定める。`docs/spirits-upstream-sync.md` と `docs/spirits-core-diffs.md` を置き換え、`docs/spirits-design.md` §5 を書き換える。
- `openspec/config.yaml` の context と rules からフォーク前提の記述を改める。
- `LICENSE` の Pi 著作権表示を、残存する流用実装の有無に基づいて整理する。
- Pi-Bolt への差し替え点 (ホストの実行ファイル名、overlay、環境変数名、manifest の `pi.*`、host package) を 1 か所のモジュール境界へ集める。Pi-Bolt 自体は実装しない。
- 互換性ランナーをホストを差し替えて測れる受け入れ試験として維持する (`--host` か `--mode official` を既定にする)。

## Capabilities

### New Capabilities

- `host-upgrade`: 固定した公式 Pi ホスト artifact の版と sha256 を更新し、`packages/spirits` の固定 devDependency と `tsc` の型検査、公式 artifact での互換性実測と tmux 検証を通す手順。上流 merge に代わる版更新の契約。

### Modified Capabilities

- `binary-distribution`: 起動役の分岐を単一の managed 経路に変更する。フォーク経路を外し、インストーラはテーマ資産を扱わなくする (リリースは互換用に添付を続ける)。リリース成果物とインストーラの失敗表示を更新する。
- `managed-pi`: 既定経路と隔離経路の二経路をやめ、単一の managed 起動にする。未コンパイル実行の未導入時の挙動を定め、失敗表示からフォークの戻し先を外す。
- `self-update`: 自己更新を実行ファイルの置換だけにし、Pi の `update` 文法の解釈とテーマ資産の取得を外す。managed 一式の導入失敗表示からフォークの戻し先を外し、修復と旧版への戻し方を出す。
- `managed-commands`: role 登録 API の有無による分岐を外し、専用コマンドを常に登録する。fork が書いた role 記録の読み取りだけを旧データ互換として残す。
- `dual-model-routing`: `/model` の role 語彙によるロック要件と fork 経路の step 記録分岐を外し、managed のロックと記録だけを残す。
- `product-identity`: ホスト identity を overlay (`piConfig.name`) と起動役の help で実現する。プロバイダ帰属ヘッダの抑制要件を外し、テレメトリ既定は `PI_TELEMETRY=0` を維持する。
- `architecture-conventions`: spirits とホストの境界を、リポジトリ内パッケージではなく公開パッケージ `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` の `exports` に載る specifier への import として強制する。
- `managed-pi-compatibility`: 互換性ランナーをホスト差し替え可能な受け入れ試験にし、fork ホストを外して公式 artifact 実行を必須観測にする。

### Removed Capabilities

- `upstream-tracking`: 上流 merge、コア差分の分離、`docs/spirits-core-diffs.md` 登録簿を前提とする一連の要件。`host-upgrade` が置き換える。
- `model-role-badge`: フォークの footer に `[role]` バッジを前置するコア差分。managed の拡張 status line 表示は `managed-commands` が既に規定する。
- `model-commands`: フォークの `/model` への role 語彙・thinking レベル引数・保存キー・補完の追加。ホストの `/model` / `/thinking` と `/spirits-role` が代替する。
- `session-clear`: フォークの `/clear` コア差分。`managed-commands` の `/spirits-clear` が代替する。

## Impact

- **Pi 上流コアへの差分**: リポジトリから Pi のソースが無くなる。`packages/` の spirits 以外 (1829 ファイル) を削除し、`[spirits]` コア差分 16 件と `docs/spirits-core-diffs.md` 登録簿を廃止する。以後の差分は 0 件で、許されるのは展開後 `package.json` への `piConfig.name` 付与だけである。
- **コード**: `packages/spirits/bin/` (起動役)、`packages/spirits/src/managed-pi/` (ホスト境界)、`packages/spirits/src/update/` (自己更新の引数分類とテーマ取得の削除)、`src/routing/` / `src/commands/` / `src/index.ts` のフォーク分岐を書き換える。`packages/spirits/src/index.ts` はホストを external にした拡張 bundle のまま維持する。
- **ビルド**: `scripts/build-binaries.ts` は起動役だけをビルドする。worker・config の VERSION 置換・Pi の `tsconfig` paths への依存を外し、互換用テーマ資産はリポジトリに固定したコピーから出力する。`scripts/build-managed-pi-inputs.ts` は拡張 bundle と manifest をビルドする。
- **CI / リリース**: `spirits-ci.yml` と `spirits-release.yml` を書き換える。「Hydrate model data」を外し、`bun install` を単一の lockfile に寄せる。自己更新 smoke 用の旧版バイナリのビルドと、互換用テーマ資産の添付は残す。
- **削除**: Pi 用の 13 workflow、`.github/APPROVED_CONTRIBUTORS`、`.github/ISSUE_TEMPLATE/`、Pi 用の `scripts/*` (66 ファイル)、`.pi/extensions` / `.pi/git` / `.pi/npm`、`docs/spikes/` を削除する。
- **ドキュメント**: README と言語版、`CONTRIBUTING.md`、`SECURITY.md`、`AGENTS.md`、`LICENSE`、`docs/spirits-design.md`、`docs/spirits-default-launch.md`、`docs/spirits-managed-pi.md`、`docs/architecture/convention-registry.md` を書き換え、`docs/spirits-host-upgrade.md` を追加する。`docs/agent-data-compat/` と `docs/spirits-managed-pi-design.md` は歴史的資料の注記を付けて残す。
- **依存関係**: `packages/spirits` にホスト公開パッケージ `@earendil-works/pi-coding-agent@1.5.0` と `@earendil-works/pi-tui@1.5.0` を devDependency として追加する (型検査と実行時のホスト解決の両方に使う。完全ピン留め)。型ミラー `src/types/*.d.ts` は廃止する。
- **保存データ**: `~/.spirits/agent` と `~/.spirits/managed-pi` の形式・パスは変えない。既存セッションの `pi.virtual-model-state` は読み取り専用で引き継ぐ。
- **範囲外**: Pi-Bolt の導入・選択 UI、新機能、リリース操作、対象プラットフォームの追加、Pi へのソースパッチ。