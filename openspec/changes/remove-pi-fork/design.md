# Design

## Context

起動役は現在 `packages/spirits/bin/spirits.ts` で、Pi の CLI を in-process で起動し、spirits 拡張を builtin として登録する。既定経路は既に managed で、`packages/spirits/src/managed-pi/` が公式 Pi の固定 artifact を `~/.spirits/managed-pi` に展開し、`current/pi/pi -e current/spirits-extension.js` を spawn する。フォーク経路は `SPIRITS_ROUTE=fork` と未コンパイル実行のための戻し先として残っている。

フォーク経路が依存しているのは、起動役の in-process 起動 (`bin/spirits.ts`)、ビルド時の Pi ソース (`scripts/build-binaries.ts` の theme / config / worker / tsconfig paths)、型検査 (root の `paths` と型ミラー) と pin テスト (`test/pi-runtime/`)、アーキテクチャ検査の解決先 (`packages/coding-agent` / `packages/tui`)、互換性ランナーの fork ホスト (`packages/coding-agent/src/cli.ts`)、リリースワークフローの model data hydrate と旧版バイナリのビルドである。

設計の一次根拠は `docs/spirits-design.md`、`docs/spirits-managed-pi-design.md`、`docs/spirits-managed-pi.md`、および `docs/agent-data-compat/summary.md` の実測。特に `docs/spirits-managed-pi-design.md` §1 は、16 件のコア差分のうち 13 件が公式 Pi 1.5.0 の拡張 API と `piConfig.name` overlay で不要になることを示している。

## Goals / Non-Goals

**Goals:**

- 起動役をホストのソース・パッケージを内包しない薄い実行ファイルにする。
- フォーク経路と `SPIRITS_ROUTE=fork` を廃止し、単一の managed 経路にする。
- リポジトリから Pi のソースツリーと pi-monorepo 構成を削除し、spirits 単独の構成にする。
- ホスト固有の仮定を 1 か所のモジュール境界へ集め、Pi-Bolt の差し替え点を用意する。
- Pi の版更新を、ホスト artifact の差し替えと検証に置き換える。

**Non-Goals:**

- Pi-Bolt の導入・取得・選択 UI・実装。
- 新機能の追加、リリース操作、対象プラットフォームの追加。
- Pi へのソースパッチ (0 件を維持)。
- 既存コミットハッシュの無効化 (履歴の書き換えはしない)。
- 人間が行う GitHub 設定 (fork network からの離脱、Issues 有効化、ブランチ削除、タグ付け)。

## Decisions

### D1. 起動役は in-process 起動をやめ、managed ホストを spawn する

**選択肢**: (a) 起動役を薄くし、`current/pi/pi -e bundle` を spawn する。(b) 起動役にホストの実行ファイルを同梱する。(c) フォーク経路を残す。

**理由**: (a) が唯一ホストのソースパッチ 0 件を満たす。(b) は再ビルド可能なホストが必要で、固定 artifact の sha256 検証と矛盾する。(c) は 2 系統の並存と上流追従コストを残す。起動役は `bin/bootstrap.ts` (env 既定、bun gate、version、update、managed-pi の分類) と `bin/spirits.ts` (ホスト spawn) だけが残り、ホストを import しない。

**代替案**: 起動役で `Bun.spawn(["bun", "packages/coding-agent/src/cli.ts", ...])` してソースツリーを直接起動する案。ビルド成果物がソースツリーに依存し、配布バイナリで動かないため却下。

### D2. ホスト固有の仮定を `managed-pi/host.ts` の記述子に集める

**選択肢**: (a) `HostDescriptor` を 1 か所に置き、起動役と managed-pi がそれを読む。(b) 既存の `spawnManagedSet` / `overlay` / `environment` に散らしたままにする。(c) Pi-Bolt の change まで境界を作らない。

**理由**: (a) は Pi-Bolt の差し替え点を 1 ファイルに閉じ込め、今回の薄い起動役をその境界に沿って書ける。(b) は Pi-Bolt のときに全モジュールを触る必要がある。(c) は「起動役を境界に沿って書く」という要件を満たせない。

記述子が持つもの:

- `id` / `packageName` (`@earendil-works/pi-coding-agent`)
- `executablePath` (`pi`) と tarball の `packageDirName` (`pi`)
- `extensionArgs(bundlePath)` (`["-e", bundlePath]`)
- `identity` (`piConfig.name` overlay を行うか)
- 環境変数名 (`agentDir`, `sessionDir`, `packageDir`, `skipVersionCheck`, `telemetry`)
- manifest の host 種別 (`schemaVersion: 1` では `pi`)

`spawnManagedSet`、`install.ts`、`verify.ts`、`overlay.ts`、`environment.ts` はこの記述子を読む。固定値は `constants.ts` の `PINNED_PI` に置く。

**代替案**: ホストを `manifest.json` の `host` オブジェクトだけから導出する案。manifest の形式を今変えることになり、自己更新経路とリリース資産の互換性を壊すため却下。manifest は `schemaVersion: 1` のまま、記述子はコード側に置く。

### D3. 型ミラーを廃止し、固定した公式パッケージを devDependency にして tsc に実型で検査させる

**選択肢**: (a) `packages/spirits/src/types/*.d.ts` を残し、`scripts/check-pi-type-mirror.ts` で固定 artifact の `.d.ts` と照合する。(b) 型ミラーを削除し、`@earendil-works/pi-coding-agent@1.5.0` / `@earendil-works/pi-tui@1.5.0` を `packages/spirits` の devDependency として完全固定し、tsc とテストの実行時の両方で実型・実体を使う。(c) 型ミラーを削除して型検査をやめる。

**理由**: 実測で (a) の前提が崩れた。固定した公式 1.5.0 を `packages/spirits` に導入した状態で型検査を通したところ、`@types/bun` とホストの Node 向け型の衝突は 0 件だった (`ReadableStream` / `path.PlatformPath` の衝突は再現しなかった)。ホストを import する箇所は bin が 0 件、src が 38 件 / 14 ファイル、test が 314 件 / 54 ファイルで、型ミラーを手で保守する規模に対して実型はそのまま使える。公式パッケージの公開面は `@earendil-works/pi-coding-agent` が `.` と `./rpc-entry` の 2 つだけで、`pi-tui` は `main` / `types` のみである。したがって「公開面だけを import する」境界は (b) でも検査でき、deep import は tsc とアーキテクチャ検査の両方で失敗させられる。

(b) は型ミラーという二重の宣言を無くし、ホストの `.d.ts` を唯一の正にする。版更新時の照合は `tsc --noEmit` と `bun test` が担い、`scripts/check-pi-type-mirror.ts` は不要になる。devDependency は `packages/spirits/package.json` に完全一致で固定し、root の workspace 経由で fork のソースへ解決されないことを `import.meta.resolve` で確認する。(c) は型安全を失う。

`src/types/pi-subpaths.d.ts` は `bin/spirits.ts` の deep import (`@earendil-works/pi-coding-agent/cli/setup`) 専用のミラーで、起動役がホストを import しなくなると参照が無くなる。deep import を禁止する規約とも合わないので削除する (3.1 で削除済み)。

**代替案**: 型ミラーを `dist/index.d.ts` の symlink にする案。ホストの型をそのまま取り込むことになり、mirror の実体が残るため (a) と同じ保守を要し、実測した衝突 0 件の利点を得られないため却下。

### D4. pin テストは公開 API だけを残し、深い内部の pin は公式モードの互換性ランナーへ移す

**選択肢**: (a) `test/pi-runtime/` の公開 API テストだけを残し、`branding-art-colors` / `child-model-source-pin` / `system-prompt-defaults` を公式モードの互換性ランナーへ移す。`model-roles-api` / `routing-record-pin` は削除する。(b) すべて削除する。(c) すべて残す。

**理由**: (a) はホストの公開 API しか使わないテストを単体で残し、ホスト内部の `.d.ts` や theme ファイルの場所に依存する pin を、固定 artifact を展開する公式モードへ寄せる。(b) は API ドリフトの検出を失う。(c) はホストの内部構造に依存し続け、ホストを差し替えられなくなる。

ファイルごとの判断: `branding-art-colors` / `child-model-source-pin` / `system-prompt-defaults` は公開面に対応する API が無いため、`test/pi-runtime/` では削除し、確認内容を互換性ランナーの公式モードの観測項目として実装する。`routing-record-pin` は spirits がホストの状態 entry を書かなくなるため、代替なしで削除する (`model-roles-api` は 6.1 で削除済み)。`test/pi-runtime/pi-deep-imports.d.ts` は 4 件の読み手が無くなるため削除する。

移した 3 件は、互換性ランナーの公式モードの観測項目として実装し、`test/pi-runtime/` からは削除する。

**代替案**: `test/pi-runtime/` に固定 artifact の展開を前提にしたテストを置く案。単体テストがネットワークと tarball 展開に依存し、`bun test` が重くなるため却下。

### D5. アーキテクチャ検査はホストを公開パッケージの解決で判定する

**選択肢**: (a) `resolveInternalSpecifier` を拡張し、`@earendil-works/*` を `packages/spirits` から Node/Bun 解決 (固定ホスト公開パッケージ) し、root `paths` は相対 specifier にだけ使う。(b) root `tsconfig.json` の `paths` に `node_modules` の実型を書く。(c) ホスト import を検査対象から外す。

**理由**: (a) は「公開パッケージの `exports` に載る subpath への import」という境界を正しく検査でき、root `paths` を再配置で壊さない。ambient module で非公開 subpath を再宣言する経路も違反として報告する。(b) は bun の node_modules 配置 (hoist / nested) に依存して脆い。(c) は境界の検査を失う。

`test/fixtures/architecture/resolve` の期待値は `packages/coding-agent` から固定ホスト公開パッケージの解決結果へ更新する。他の fixture は自己完結した合成ツリーなので、そのまま使える。

### D6. 失敗表示は修復コマンドと旧版への戻し方に置き換える

**選択肢**: (a) `managedRepairHint` を `修復: spirits managed-pi repair` + `旧版へ戻す: <手順>` にする。(b) 修復コマンドだけを出す。(c) フォークの戻し先を残す。

**理由**: (a) はネットワークが使えない利用者に行き先を残す。(b) は同じコマンドが失敗する場面で行き先を失う。(c) は廃止した経路を案内し続ける。

旧版への戻し方は `docs/spirits-host-upgrade.md` に書き、`~/.spirits/bin` の退避と fork 最終タグからの再ビルドを両方含める。失敗表示は長い手順ではなく、その文書への参照と最小の 2 行を出す。

### D7. `SPIRITS_ROUTE=fork` は黙って無視せず、理由と戻し方を出して非ゼロで終了する

**選択肢**: (a) 明示エラー。(b) 警告して managed を起動。(c) 黙って無視。

**理由**: (a) は「設定が効いていない」ことを隠さず、戻し方も同時に伝えられる。(b) は設定を無視したまま成功に見える。(c) は仕様の禁止に反する。エラー文には `SPIRITS_ROUTE` の廃止理由、`unset` で managed になること、旧版への戻し方を出す。

拒否するのはホストを起動する経路だけにする。`update`、`managed-pi`、`--version` / `-v`、`--help` / `-h` は `SPIRITS_ROUTE=fork` があっても通常どおり処理する。代替案の「すべての入口で拒否」は、env を消す前に `spirits update` や `spirits managed-pi repair` で修復する経路まで塞ぐため採らない。検出のために `constants.ts` の `ENV_ROUTE` / `ROUTE_FORK_VALUE` は残し、参照は拒否の判定 1 か所に限る。

### D8. 起動役・インストーラ・自己更新はテーマ資産を使わず、リリースは互換用に添付を続ける

**選択肢**: (a) 新しい起動役・インストーラ・自己更新はテーマ資産を使わず、リリースには `dark.json` / `light.json` と `.sha256` を互換用として添付し続ける。(b) テーマ資産をリリースから外し、旧版の `spirits update` が失敗することを受け入れる。(c) テーマ取得を任意にする中間リリースを先に出す。

**理由**: v0.7.2 以前の自己更新 (`src/update/run.ts`) は、実行ファイルを置換する前に `dark.json` / `light.json` とその `.sha256` を取得し、失敗すると `Update failed` で終了 1 を返す。(b) では既存の全利用者の `spirits update` が失敗し、「自己更新経路の検証」を満たせない。(c) はリリース操作を範囲外とするこの change の外にある。(a) は既存利用者の更新経路を保ち、新しいコードからはテーマを外せる。

テーマ資産の出力元は Pi のソースツリー削除後も必要になる。fork 最終コミットの `packages/coding-agent/src/modes/interactive/theme/{dark,light}.json` を `scripts/compat-theme/` にコピーして固定し、`build-binaries.ts` はそこから `dist/theme/` と `.sha256` を出す。代替案の「固定ホスト artifact からテーマを取り出す」は、artifact 内のテーマの配置が未確認で、リリース時に artifact の取得と展開が必要になるため採らない。旧版は置換後に新しい起動役へ切り替わるので、互換用テーマの中身は JSON として妥当であればよい。

自己更新とインストーラは theme の取得・修復を行わない。既存の `~/.spirits/bin/theme/` は削除せず、残置物として無害に保つ。互換用の添付をやめる時期は後続 change で決める。

### D9. ルートは spirits 単独の bun workspace にする

**選択肢**: (a) root `package.json` の workspaces を `["packages/spirits"]` にし、`packages/spirits/bun.lock` を root `bun.lock` に統合する。(b) `packages/spirits` をリポジトリ直下へ移動する。(c) root をやめて `packages/spirits` をリポジトリルートにする。

**理由**: (a) は既存の `packages/spirits` パスと CI の `cd packages/spirits` を保ち、変更を最小化する。(b) は全パスとドキュメントを書き換える必要があり、今回の目的に対して大きすぎる。(c) は `openspec/` と `docs/` の位置を変える。

root の `package.json` は `private: true`、`workspaces: ["packages/spirits"]`、`scripts` は `check` / `test` を `packages/spirits` へ委譲する。`package-lock.json` は削除し、`bun.lock` を再生成する。`packages/spirits/bun.lock` は削除する。

**代替案**: root を `packages/spirits` の中身だけにする案。`openspec/` と `docs/` を `packages/spirits` 配下へ動かす必要があり、既存の OpenSpec ルートとドキュメント参照が壊れるため却下。

### D10. LICENSE は spirits の著作権を追加し、Pi の表示を残す

**選択肢**: (a) `LICENSE` に spirits の著作権行を追加し、Pi の著作権表示を「portions derived from Pi」として残す。(b) Pi の表示を削除し、README の謝辞だけにする。(c) 現状の Pi のみの表示を維持する。

**理由**: リポジトリには Pi の設定保存手順を踏襲した `commands/settings-store.ts` など、Pi 由来の派生物が残る。型ミラーは D3 で廃止するため、派生物の根拠には数えない。(a) は派生物の帰属を保ちつつ spirits の著作権を明示する。(b) は派生物が残る限り帰属を弱める。(c) は spirits の著作権が不明のままになる。

**代替案**: 派生物をすべて書き直して (b) を取る案。設定保存手順など Pi 由来の実装が残るため、帰属を弱めるとして却下。

### D11. `spirits update` は自己更新形だけを受け付ける

**選択肢**: (a) 自己更新形 (`update`、`update self`、`update pi`、`update --self` と `--force`、`-a` / `--approve`、`-na` / `--no-approve`) だけを受け付け、その他は案内して非ゼロで終了する。(b) 自己更新形以外をホストの `update` へ渡す。(c) 引数を一切受け付けない。

**理由**: (a) は起動役が Pi の `update` 文法を知らずに済み、黙って無視しないという D7 の方針と一致する。(b) は起動役がホストの文法の境界を知る必要がある。(c) は `--force` などの既存の自己更新形まで壊す。案内は「ホストと拡張 bundle は `spirits managed-pi update`、host の installed package と model catalog は導入済みの host 実行ファイルの `update`」とする (14.7 の実測で、`spirits -- update <引数>` は host に届くと分かったため、元の案だった `spirits -- update <引数>` は案内しない。起動役が `-e <bundle>` を先に渡すので、host は `update` を第一引数の dispatch に使えない)。`-a` / `--approve` / `-na` / `--no-approve` は既存の呼び出しを壊さないよう受け付けるが、挙動は変えない。

`src/update/classify.ts` は Pi の文法による分類をやめ、自己更新形かどうかだけを判定する。`src/update/run.ts` の `runExtensionUpdate` と `all` 対象、`src/update/theme.ts` とテーマの取得・修復を削除する。

### D12. 一式が未導入のとき、コンパイル済みは自動取得し、未コンパイルは案内して終了する

**選択肢**: (a) コンパイル済みは起動役と同じリリースから取得して起動し、未コンパイルは取得せず導入方法を表示して非ゼロで終了する。(b) 常に案内して終了する。(c) 常に自動取得する。

**理由**: (a) はコンパイル済みの現行の挙動を保つ。未コンパイルには取得元のリリースタグが決まらないので、取得せず `spirits managed-pi install` または `SPIRITS_MANAGED_PI_MANIFEST_URL` を案内する。(b) はコンパイル済みの利用者に新たな非互換を生む。(c) は未コンパイルの取得元を別に決める必要がある。

## Risks / Trade-offs

- [Risk] lockfile を root に統合した再解決で、固定していない依存の版が動く。 → 実測 (2026-11-15): `graceful-fs` が 4.2.11 → 4.2.12 へ動いた (公開日 2026-11-12)。`proper-lockfile@4.1.2` が `^4.2.4` を要求することによる再解決で、公開から 2 日を経ているため age gate も通る。 → Mitigation: ピン留めも override もせず受け入れる。host 固定版 (`@earendil-works/pi-coding-agent` / `pi-tui` / `pi-ai` の 1.5.0 と `typebox` の 1.3.27) が動いていないことを lock 比較で確認する。
- [Risk] 起動役からホストを import しないことで、開発時のソース実行がホスト一式の導入を前提になる。 → Mitigation: `spirits managed-pi install` と `SPIRITS_MANAGED_PI_MANIFEST_URL` を起動時メッセージと `docs/spirits-default-launch.md` に明記し、tmux 検証で未導入→導入→起動を通す。
- [Risk] 固定した devDependency の版と src の型がずれ、古い型のままコンパイルが通る。 → Mitigation: `host-upgrade` で devDependency の版更新と `tsc --noEmit` / `bun test` を必須にし、失敗時は更新を止める。
- [Risk] fork 側 `packages/*` と `packages/spirits` の devDependency で `@earendil-works/*` の版が二重管理になり、§12.1 の削除まで解消が混ざる。 → Mitigation: §12.1 まで `packages/spirits` の解決が root workspace の symlink ではなく固定 devDependency の実体であることを `import.meta.resolve` と lockfile で確認する。`packages/spirits/tsconfig.json` は root を継承せず、sub-tsconfig も `packages/spirits/tsconfig.json` を継承する。二重管理の間に root 側の `paths` と fork パッケージを消さない (fork パッケージの削除は §12.1、root の `paths` の削除は §12.4)。
- [Risk] アーキテクチャ検査の解決先を公開パッケージへ変えると、bun の node_modules 配置に依存する。 → Mitigation: `packages/spirits` から `import.meta.resolve` で解決し、解決できない場合は失敗として理由を出す。
- [Risk] 既存の `~/.spirits/agent` の `pi.virtual-model-state` を読み取り専用で残すと、将来のホストが同じ entry を書き換える可能性がある。 → Mitigation: 読み取りは role の文字列だけを見て、書き戻しを禁止する。ホストの entry を変更しないことを互換性ランナーの観測項目にする。
- [Risk] 自己更新経路が旧版バイナリ (v0.7.2) から新形式へ上がらない。旧版の自己更新は置換前にテーマ資産を取得し、無ければ失敗する。 → Mitigation: リリースに互換用テーマ資産を添付し続け (D8)、`host-upgrade` の「自己更新経路の検証」で、一つ前のリリースのバイナリから `spirits update` を実行し、終了コード 0 と managed 一式の導入を確認する。
- [Risk] 旧版で `spirits update --all` を実行すると、旧版は置換後に新しいバイナリで `update --extensions` を実行し、新しい起動役はそれを案内して非ゼロで返す (D11)。置換は成功しているのに終了コードが非ゼロになる。 → Mitigation: `docs/spirits-host-upgrade.md` と README の移行の注意に、旧版では `spirits update` (対象 self) を使うよう記載する。置換自体は終わっているので、データは失われない。
- [Risk] `spirits -- update <引数>` がホストの `update` サブコマンドとして解釈されるか未確認である (起動役は `-e <bundle>` を前置して spawn する)。 → 実測 (2026-11-15、14.7): 解釈されない。固定ホスト Pi 1.5.0 で `spirits -- update --extensions` は `Error: Unknown option: --extensions` (終了 1)、`spirits -- update` は positional message として model に渡り、実際の session と tool call が残った (host は `update` を argv[0] のときだけ dispatch し、`update --help` は `spirits update [source|self|pi] [--self|--extensions|--models|--all] …` を出す)。 → Mitigation: 案内文を host 実行ファイルの `update` (実測で `Updated packages` になる `<managed root>/current/pi/pi update --extensions`) に直し、`spirits -- update ...` が prompt になる旨を warning として常に表示した。位置引数で model が走ることを起動役が塞ぐかは別判断 (起動役が host の文法を知ることに戻る) として Follow-up に残す。
- [Risk] 人間の作業 1 (タグ付け) の前に実装を始めると、戻し先のタグが打てない。 → Mitigation: tasks の §1 を実装の前提条件として固定し、エージェントはタグ付けを実行しない。fork network 離脱などの残りの人間の作業は実装後に行う。
- [Risk] Pi の帰属ヘッダを抑制できない。 → Mitigation: ホストの既定を受け入れることを仕様に書き、README に移す。
- [Risk] `--help` を起動役が奪うことで、ホストの help が見えにくくなる。 → Mitigation: `spirits -- --help` を文書化し、起動役の help にその導線を出す。

## Migration Plan

### 人間が行う作業 (エージェントは実行しない)

実装開始の前提 (tasks §1):

1. fork 最終コミット (`origin/main` = `4243f3d87`。`spirits-v0.7.2` と同じ commit) にタグを打つ。推奨名: `spirits-fork-final`。`spirits-v*` でも `v*` でもないので、release workflow と `build-binaries.yml` を起動しない。annotated tag にし、メッセージに「last commit before removing the Pi fork」を残す。ローカルの `main` は `origin/main` より遅れているので、タグは `origin/main` の commit を指定して打つ。

実装の完了後 (tasks の Workflow follow-up):

2. リリース資産を手元に退避してから、GitHub の Settings で「Leave fork network」を実行し、Issues を有効にする。退避するのは、作業中の `~/.spirits/bin/spirits` と、必要なら `spirits-v0.7.2` のリリース資産。
3. spirits で使わないワークフローの無効化状態を確認する。実装後は `spirits-ci.yml` と `spirits-release.yml` だけが残るので、他が `disabled_manually` や削除済みであることを確認する。
4. 役目を終えたブランチ (`feat/add-managed-pi-route`、`feat/add-bundled-skills`、`spirits-m2-verify`) を削除する。3 本とも `origin/main` に含まれている。`feat/add-managed-pi-route` はこの change の作成時に checkout していたブランチなので、実装は別ブランチで行い、削除はその後にする。

### 実装順序 (人間の作業 1 の完了後に始める)

1. ホスト記述子 (`managed-pi/host.ts`) と固定値 (`PINNED_PI`) を導入し、既存の `spawnManagedSet` / `install` / `verify` / `overlay` / `environment` を記述子経由にする。挙動は変えない。
2. 起動役を薄くする。`bin/spirits.ts` からホスト import を外し、`bin/bootstrap.ts` / `startup.ts` のフォーク分岐を外す。`SPIRITS_ROUTE=fork` はホスト起動の経路でだけ拒否する (D7)。`--help` / `-h` を起動役が処理する。未導入時の扱いを D12 に合わせる。
3. 失敗表示を修復コマンド + 旧版への戻し方に置き換える。
4. 自己更新を書き換える。引数分類を自己更新形だけにし (D11)、テーマ資産の取得・修復と拡張更新の連携を外す (D8)。
5. 拡張側のフォーク専用経路を外す。`registerModelRoles` の分岐、`ROUTING_STATE_ENTRY_TYPE` の書き込み、fork 経路の step 記録、`index.ts` の条件付き managed コマンド登録を削除する。`forkRoleRecord` は読み取り専用で残す。
6. 4 種の食い違い (getSettings の `BrandingSettings`、コマンドハンドラの `Promise<void>`、`ToolDefinition` のジェネリクス、`KeyId`) を、型の表記だけの差か managed 上の実行時の挙動差かを実測で分類する。挙動差があるものは修正タスクを起こす。
7. テスト用 fake の共通ヘルパーを、公式の型に合わせた部分 mock として先に作る。
8. src を公式型へ張り替える。`packages/spirits` に公式パッケージを完全一致で devDependency として追加し、`tsconfig` の `paths` を外して実型で検査する。この区切りで src の型検査を通す。
9. test を手直しする。fake を helper に寄せ、非公開 subpath を import するテストを公開面だけで検証する形へ書き換えるか削除する。この区切りの終わりで `tsc` と `bun test` を通す (src の張り替えと test の手直しは連続した 1 区切りとして扱い、7.5 の完了確認で両方を要求する)。
10. 型ミラーと `scripts/check-pi-type-mirror.ts` / そのテストを削除する。
11. アーキテクチャ検査と fixture をホスト公開パッケージの解決へ更新する。
12. 互換性ランナーをホスト差し替え可能にし、fork ホストを外す。
13. ビルドとリリースを書き換える (`build-binaries.ts` は起動役と互換用テーマ資産だけ、`spirits-ci.yml` / `spirits-release.yml` は hydrate を外す)。
14. Pi のソースツリーとルート構成を削除し、root を spirits 単独の workspace にする。
15. ドキュメントと `openspec/config.yaml` を書き換える。
16. 検証 (型検査、bun test、ビルド、互換性公式モード、tmux、自己更新 smoke) を通す。

### Rollback

- `~/.spirits/bin` を退避した旧版バイナリに戻す (`mv ~/.spirits/bin/spirits ~/.spirits/bin/spirits.new` → 退避した旧版を `~/.spirits/bin/spirits` へ戻す)。`spirits-v0.7.2` のリリース資産 `spirits-linux-x64` もそのまま使える。
- fork 最終タグ `spirits-fork-final` から旧版バイナリを再ビルドする: `git worktree add /tmp/spirits-fork spirits-fork-final` → `cd /tmp/spirits-fork` → `bun install --frozen-lockfile` → `bun packages/ai/scripts/generate-models.ts --strict --data-only` (リリースの「Hydrate model data」と同じ) → `bun scripts/build-binaries.ts --version <old>`。
- 旧版バイナリも既定では managed を起動する。内包した fork を使うには `SPIRITS_ROUTE=fork spirits` で起動する。`~/.spirits/agent` は形式が変わらないため、そのまま使える。
- `docs/spirits-host-upgrade.md` に同じ手順を残す。

## Pi-Bolt 準備

### ホストが公式 Pi であることに依存している箇所

| 箇所 | 依存 |
|---|---|
| `managed-pi/launch.ts` の `spawnManagedSet` | `current/pi` の実行ファイル名、`current/pi/package.json`、`-e` の拡張ロード引数 |
| `managed-pi/install.ts` | tarball の `pi/pi` / `pi/package.json` の配置、`chmod` の対象 |
| `managed-pi/verify.ts` / `layout.ts` | `managedPiExecutable` = `<set>/pi/pi`、`managedPiDir` = `<set>/pi` |
| `managed-pi/overlay.ts` | `package.json` の `piConfig.name` と `name` / `version` |
| `managed-pi/environment.ts` | `SPIRITS_CODING_AGENT_DIR` / `SPIRITS_CODING_AGENT_SESSION_DIR` / `PI_PACKAGE_DIR` / `PI_SKIP_VERSION_CHECK` / `PI_TELEMETRY` |
| `managed-pi/manifest.ts` | `schemaVersion: 1`、`pi.version`、`pi.artifact`、`platform` |
| `scripts/build-managed-pi-inputs.ts` | host externals `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` / `typebox` |
| `bin/version.ts` の host 起動引き継ぎ | `-e <bundle>` を前置する argv 転送 (`SPIRITS_LAUNCH_ARGS`) |
| `update/release-info.ts` | 自己更新が取得するリリース資産名 (`spirits-<target>`、`install.sh`) |
| `src/index.ts` と host 型 | 公式 `ExtensionAPI` / `ExtensionMode` などの型を pinned devDependency の実型で読む (§7) |
| `src/index.ts` と各層 | host の `registerTool` / `registerCommand` / `registerVirtualModel` / `setStatus` / `setHeader` / `appendEntry` / `createAgentSession` |

### 1 か所のモジュール境界

`packages/spirits/src/managed-pi/host.ts` に `HostDescriptor` を置き、起動役と managed-pi はそれだけを読む。固定値は `constants.ts` の `PINNED_PI` に置く。Pi-Bolt は同じインターフェースの別インスタンスを追加し、manifest の host 種別で選ぶ。

### manifest の `schemaVersion` の上げ方

- 今回 `schemaVersion` は `1` のまま。`pi.*` は公式 Pi の記述として残す。
- 2 つ目のホストを追加するとき、`schemaVersion: 2` にして、任意の `host: { kind: "pi" | "bolt", ... }` を追加する。`pi.*` は `kind: "pi"` の互換用に残す。
- parser は `1` と `2` を受け、`1` を `kind: "pi"` に正規化する。`2` で未知の `kind` は拒否する。
- 起動役は manifest の `host.kind` (無ければ `pi`) で記述子を選ぶ。リリース資産名とチェックサムの形式は変えない。

### 後続 change の未解決事項 (推測で設計を確定しない)

- Pi-Bolt の agent dir の向け直し (環境変数名、既定パス)。
- Pi-Bolt で overlay (`package.json` の `piConfig.name`) が適用できるか。
- JIT 無しで tsrepl が実用速度で動くか。
- Pi-Bolt の RPC モードが公式 Pi と同じプロトコルか。
- Pi-Bolt の拡張 API が `registerVirtualModel` / `registerCommand` / `setStatus` / `setHeader` / `appendEntry` / `createAgentSession` を提供するか。
- Pi-Bolt の CLI の identity・help・theme の扱い。

## ファイル分類

### 集計

| 領域 | 総数 | 残す | 書き換え | 削除 |
|---|---|---|---|---|
| `packages/` (spirits 以外) | 1829 | 0 | 0 | 1829 |
| `packages/spirits/` | 639 | 大半 | 下の「内部の書き換え」を参照 | 下の「内部の書き換え」と「依存と判断」を参照 (theme.ts、型ミラー、fork 専用の pin テストなど) |
| `openspec/` | 265 | 264 | 1 | 0 |
| `scripts/` | 95 (+2 追加) | 4 | 25 | 66 |
| `docs/` | 79 | 61 | 12 | 6 |
| `.github/` | 20 | 0 | 2 | 18 |
| `.pi/` | 39 | 33 | 0 | 6 |
| `nix/` | 2 | 0 | 0 | 2 |
| root | 25 | 1 | 16 | 8 |
| **合計** | **2993** | - | - | - |

### `packages/` (spirits 以外) — 全削除

| パッケージ | ファイル数 | 判断 |
|---|---|---|
| `packages/coding-agent` | 874 | 削除 |
| `packages/ai` | 387 | 削除 |
| `packages/durable` | 167 | 削除 |
| `packages/tui` | 123 | 削除 |
| `packages/chord` | 64 | 削除 |
| `packages/env` | 36 | 削除 |
| `packages/mcp` | 32 | 削除 |
| `packages/evals` | 30 | 削除 |
| `packages/server` | 29 | 削除 |
| `packages/agent` | 20 | 削除 |
| `packages/client` | 19 | 削除 |
| `packages/codemode` | 19 | 削除 |
| `packages/protocol` | 17 | 削除 |
| `packages/telemetry` | 12 | 削除 |

### root — 残す / 書き換え / 削除

| ファイル | 判断 | 理由 |
|---|---|---|
| `.gitattributes` | 書き換え | `packages/agent/docs/**/*.diff` の行を削除 |
| `.gitignore` | 書き換え | Pi パッケージ固有の ignore を削除 |
| `.husky/pre-commit` | 書き換え | lockfile ゲートと spirits の `bun run check` (書き換えない側) の 2 本。整形は `bun run fix` を手で使う |
| `.npmrc` | 書き換え | `save-exact=true` を残し、bun が読まない `min-release-age` を削除 (実測で確認) |
| `bunfig.toml` | 追加 | `[install] minimumReleaseAge` (秒)。公開からの経過日数の門を bun 側で効かせる |
| `AGENTS.md` | 書き換え | 単一パッケージのコマンドとルールに更新 |
| `CONTRIBUTING.md` | 書き換え | Pi の contribution gate を外し、spirits の CONTRIBUTING にする |
| `LICENSE` | 書き換え | spirits の著作権を追加し、Pi の表示を派生物向けに残す (D10) |
| `README.md` / `.ja` / `.zh` / `.de-CH` | 書き換え | 「fork of Pi」を「公式 Pi の固定 artifact をホストにする」に更新 |
| `SECURITY.md` | 書き換え | Pi のセキュリティ文書の前提を spirits の配布形態に更新 |
| `biome.json` | 書き換え | Pi の plugin / include を削除し、`scripts/**` のみに pin した。`packages/spirits` を含めるか (実測 465 ファイル中 335 diagnostic) はフォーク削除とは別の判断として Follow-up に残す |
| `bun.lock` | 書き換え | root workspace の lockfile を再生成 |
| `package.json` | 書き換え | `pi-monorepo` をやめ、workspaces を `packages/spirits` だけにする。`check` は書き換えない検査にし、書き換えは `fix` に切り出す。呼出は `bun` に揃える。`engines` は bun を主、node は実際に使う toolchain の下限にしたがえる |
| `tsconfig.json` | 書き換え | Pi の `paths` を削除し、repo 全体の view にする。host に読み込まれる拡張 fixture は除外するが、型検査は pinned host 型の `tsconfig.scripts.json` で受け続ける |
| `tsconfig.base.json` | 書き換え | Node 向けの `types` を Bun 向けに調整 |
| `vitest.base.ts` | 削除 | vitest を使わない |
| `flake.nix` / `flake.lock` | 削除 | Pi の nix 配布用で、spirits は対象外 |
| `nix/` | 削除 | 同上 |
| `package-lock.json` | 削除 | npm の lockfile。bun の `bun.lock` に一本化 |
| `pi-test.sh` / `pi-test.bat` / `pi-test.ps1` | 削除 | Pi のテスト起動スクリプト |
| `test.sh` | 削除 | Pi monorepo の非 e2e テストランナー。`bun test` に置き換え |

### `scripts/` — 残す / 削除

残す (29 ファイル) と追加 (2 ファイル):

| ファイル | 判断 | 理由 |
|---|---|---|
| `build-binaries.ts` | 書き換え | 起動役と互換用テーマ資産だけをビルド。config / worker / Pi の tsconfig 参照を外し、テーマの出力元を `scripts/compat-theme/` に変える (D8) |
| `compat-theme/dark.json` / `compat-theme/light.json` | 追加 | fork 最終コミットの Pi 組み込みテーマのコピー。旧版の自己更新用の互換資産 (D8) |
| `build-managed-pi-inputs.ts` | 書き換え | 拡張 bundle と manifest をビルド。host externals を記述子から読む。typeCheck の tsconfig は `packages/spirits/tsconfig.json` (root には host を fork のソースへ写す paths があった) |
| `check-managed-pi-bundle-version.ts` | 残す | リリースの bundle 版と manifest の一致を確認 |
| `install.sh` | 書き換え | fork の案内と theme を外し、managed 一式の導入と旧版の戻し方を出す |
| `install.test.sh` | 書き換え | 新しい install.sh に合わせる |
| `self-update-smoke.sh` | 書き換え | 旧版→新版の自己更新と managed 一式の導入を確認 |
| `tmux-verify.sh` / `tmux-verify.test.sh` | 残す | 対話検証ランナー |
| `test-dotenv-smoke.sh` | 残す | `.env` 非読込の回帰 |
| `managed-pi-compat/` (20 ファイル) | 書き換え | fork ホストを外し、ホスト差し替え可能な受け入れ試験にする |

削除 (66 ファイル): `replace-pi-version.ts`、`agent-data-compat/`、`model-catalog-protocol.*`、`release*.mjs`、`publish*.mjs`、`package-*.mjs`、spirits が使わない `check-*.mjs` (`check-browser-smoke.mjs`、`check-synthetic-readme-perf.mjs`。`.husky/pre-commit` が呼ぶ `check-lockfile-commit.mjs` は残す)、`coding-agent-smoke.*`、`profile-coding-agent-node.mjs`、`stats.ts`、`cost.ts`、`tool-stats.ts`、`session-*.ts`、`edit-tool-stats.mjs`、`build-coding-agent-bundle.mjs`、`browser-smoke-entry.ts`、`durable-browser-smoke-entry.ts`、`agent-treeshake-smoke-entry.ts`、`smoke-test-codemode-binary.mjs`、`generate-*.mjs`、`sync-versions.*`、`local-*.mjs`、`use-local-packages.mjs`、`npm-*.mjs`、`auto-pi.sh`、`build-binaries.sh`、`create-source-archive.sh`、`update-source-imports-to-ts.sh`、`repro-5893-wsl-bash.mjs`、`scripts/biome/`。

### `.github/` — 残す / 書き換え / 削除

| ファイル | 判断 | 理由 |
|---|---|---|
| `workflows/spirits-ci.yml` | 書き換え | paths を `packages/spirits` / `scripts` / root 構成にし、hydrate を外す |
| `workflows/spirits-release.yml` | 書き換え | hydrate を外す。manifest / bundle と互換用テーマ資産の添付は残す (D8) |
| 他の 13 workflow | 削除 | Pi の CI / リリース / issue gate など、spirits で使わない |
| `APPROVED_CONTRIBUTORS` / `ISSUE_TEMPLATE/` (4 ファイル) | 削除 | Pi の contribution gate / issue テンプレート |

### `docs/` — 残す / 書き換え / 削除

| ファイル | 判断 | 理由 |
|---|---|---|
| `spirits-design.md` | 書き換え | §1 / §2 / §3 / §5 / §9 / §10 をホスト artifact 前提に更新 |
| `spirits-default-launch.md` | 書き換え | 単一 managed 経路とホスト未導入時の案内に更新 |
| `spirits-managed-pi.md` | 書き換え | fork 比較を外し、単一経路の機能差と既知の制約に更新 |
| `spirits-managed-pi-design.md` | 残す | 設計の一次根拠。冒頭に「この文書の fork 比較は歴史的資料」と追記 |
| `spirits-upstream-sync.md` | 削除 | `spirits-host-upgrade.md` に置き換え |
| `spirits-core-diffs.md` | 削除 | コア差分 0 件に伴い廃止 |
| `spirits-upstream-issues.md` | 残す | 上流 issue の記録。歴史的資料として維持 |
| `spirits-m1..m5` | 残す | フェーズ設計書。fork 固有の記述は `spirits-design.md` 参照に置き換え |
| `architecture/convention-registry.md` | 書き換え | ホスト境界と root 構成に更新 |
| `agent-data-compat/` (61 ファイル) | 残す | 旧 fork との実測記録。冒頭に「fork 側の記録は歴史的資料」と追記 |
| `spikes/` (4 ファイル) | 削除 | Pi 内部の調査スパイク |

### `.pi/` — 残す / 削除

| パス | 判断 | 理由 |
|---|---|---|
| `.pi/prompts/` (18 ファイル) | 残す | OpenSpec ワークフローのプロンプト。spirits の開発リソース |
| `.pi/skills/` (15 ファイル) | 残す | OpenSpec / release / interactive-testing などのスキル |
| `.pi/extensions/` (4 ファイル) | 削除 | Pi の開発用拡張 (import-repro / prompt-url-widget / redraws / tps) |
| `.pi/git/` / `.pi/npm/` | 削除 | Pi の worktree / npm 用ディレクトリ |

### `packages/spirits/` — 内部の書き換え

| パス | 判断 | 理由 |
|---|---|---|
| `bin/spirits.ts` | 書き換え | ホスト import を外し、managed ホストを spawn |
| `bin/bootstrap.ts` | 書き換え | fork 分岐と `SPIRITS_ROUTE` を外す |
| `bin/startup.ts` | 書き換え | fork の戻し先の文言を外す |
| `bin/env-defaults.ts` / `bin/version.ts` | 残す | 起動役とヘッダの共有再 export |
| `bin/bun-gate.ts` | 残す | ソース実行の Bun バージョンゲート |
| `bin/tsconfig.json` | 書き換え | `packages/spirits/tsconfig.json` 継承に変更 |
| `src/managed-pi/*` | 書き換え | ホスト記述子を導入し、fork の文言と定数を外す |
| `src/routing/register.ts` | 書き換え | `registerModelRoles` 分岐と `ROUTING_STATE_ENTRY_TYPE` 書き込みを外す |
| `src/index.ts` | 書き換え | managed コマンドを常に登録 |
| `src/commands/role.ts` | 書き換え | `forkRoleRecord` を読み取り専用の旧データ互換に改名 |
| `src/commands/register.ts` / `settings-store.ts` | 書き換え | fork の文言と分岐を外す |
| `src/constants.ts` | 書き換え | `MANAGED_PI_FORK_ROUTE_HINT` を削除。`ENV_ROUTE` / `ROUTE_FORK_VALUE` は `SPIRITS_ROUTE=fork` の拒否のために残す (D7) |
| `src/update/classify.ts` | 書き換え | Pi の `update` 文法の分類をやめ、自己更新形かどうかだけを判定 (D11) |
| `src/update/run.ts` | 書き換え | テーマ資産の取得・修復と `runExtensionUpdate` を外す (D8・D11) |
| `src/update/theme.ts` | 削除 | テーマ資産を扱わない (D8) |
| `src/types/pi-subpaths.d.ts` | 削除 | `bin/spirits.ts` の deep import 専用で、参照が無くなる (D3) |
| `src/types/pi-coding-agent.d.ts` / `pi-tui.d.ts` | 削除 | 型ミラーを廃止し、公式パッケージの実型で検査する (D3) |
| `package.json` / `tsconfig.json` / `src/*/tsconfig.json` / `bin/tsconfig.json` | 書き換え | 公式パッケージを完全一致で devDependency にし、`paths` を外し、sub-tsconfig は `packages/spirits/tsconfig.json` を継承する (D3) |
| `src/rlm/tsconfig.json` / `src/routing/tsconfig.json` / `src/harness/tsconfig.json` | 書き換え | 新しい `packages/spirits` 継承に変更し、host を node_modules から解決 |
| `test/pi-runtime/*` | 書き換え | 公開 API だけ残し、深い pin は公式モードへ |
| `test/architecture/*` / `test/fixtures/architecture/*` | 書き換え | ホスト公開パッケージの解決に更新。`registry:bin-deep-imports` を削除 |
| `test/managed-pi-compat-guard.test.ts` | 書き換え | fork ホストを外し、fixture と公式ホストを比較 |
| `test/update-*.test.ts` | 書き換え | 自己更新形の分類、テーマ非取得、拡張更新の案内に合わせる。`update-theme.test.ts` は削除 |

## フォークのソースツリーへの依存と判断

| 箇所 | 依存 | 判断 | 理由 |
|---|---|---|---|
| `scripts/build-binaries.ts` | `packages/coding-agent/src/config.ts`、`package.json`、theme、worker、`tsconfig.json` の paths | 書き換え | 起動役はホストを内包しない。worker / config VERSION 置換は不要。互換用テーマは `scripts/compat-theme/` から出力する |
| `scripts/replace-pi-version.ts` | Pi の `VERSION` 置換 | 削除 | 起動役のビルドで使わない |
| `packages/spirits/bin/spirits.ts` | `@earendil-works/pi-coding-agent` の `bun/*`、`main`、`cli/setup` | 書き換え | 起動役はホストを import しない |
| `packages/spirits/bin/tsconfig.json` | root の Pi paths | 書き換え | `packages/spirits/tsconfig.json` を継承 |
| `packages/spirits/src/rlm/tsconfig.json` / `routing` / `harness` | root の Pi paths | 書き換え | host を node_modules から解決 |
| `packages/spirits/src/types/*.d.ts` | ホスト API の型 | 削除 | 型ミラーを廃止し、公式パッケージの実型で検査する (D3) |
| `spirits-release.yml` のテーマ資産の検証と添付 | `dist/theme/*.json` | 残す | 旧版の自己更新用の互換資産 (D8) |
| `packages/spirits/test/pi-runtime/branding-art-colors.test.ts` | `packages/coding-agent/src/modes/interactive/theme` の実ファイル | 公式モードへ移動 | ホストの theme の場所に依存しない |
| `packages/spirits/test/pi-runtime/child-model-source-pin.test.ts` | `@earendil-works/pi-coding-agent/core/virtual-models` | 公式モードへ移動 | ホスト内部の deep import |
| `packages/spirits/test/pi-runtime/system-prompt-defaults.test.ts` | `@earendil-works/pi-coding-agent/core/system-prompt` | 公式モードへ移動 | ホスト内部の deep import |
| `packages/spirits/test/pi-runtime/model-roles-api.test.ts` | fork の `/model` role 語彙 | 削除 | ホストに role API が無い |
| `packages/spirits/test/pi-runtime/routing-record-pin.test.ts` | fork の `pi.virtual-model-state` role | 削除 | ホストの entry に role を書かない |
| `packages/spirits/test/pi-runtime/virtual-model-api.test.ts` / `virtual-model-reload` / `settings-unknown-key` / `frontmatter` / `harness-skills-yaml` / `bundled-skills` | host の公開 API | 残す | 固定ホスト公開パッケージに対して実行 |
| `packages/spirits/test/architecture/*` | root `paths` の `packages/coding-agent` / `packages/tui` | 書き換え | ホスト公開パッケージの解決に更新 |
| `packages/spirits/test/managed-pi-compat-guard.test.ts` | `packages/coding-agent/src/cli.ts` (fork ホスト) | 書き換え | fork ホストを外す |
| `scripts/managed-pi-compat/*` | fork ホスト、固定 artifact モード | 書き換え | ホスト差し替え可能な受け入れ試験にする |
| `scripts/agent-data-compat/` | fork バイナリ (`--fork`) | 削除 | fork が無く実行できない |
| `docs/agent-data-compat/` | fork との実測 | 残す | 既存データ互換の証拠。歴史的資料として維持 |
| `spirits-release.yml` の「Hydrate model data」 | `packages/ai/scripts/generate-models.ts` | 削除 | `packages/ai` が無い |
| `spirits-release.yml` の旧版バイナリのビルド | `build-binaries.ts --version 0.0.0-0` | 残す | 自己更新 smoke 用。起動役のビルドになる |
| `scripts/install.sh` | fork の戻し先、theme | 書き換え | managed 一式の導入と旧版の戻し方 |
| `scripts/self-update-smoke.sh` | 旧版/新版バイナリ | 書き換え | managed 一式の導入まで確認 |

## フォーク専用コード経路と削除後の挙動

| 経路 | 削除後の挙動 |
|---|---|
| `routing/register.ts` の `getRegisterModelRoles` / `registerModelRoles` | 削除。role API を持たないホストで managed コマンドが常に使われる |
| `routing/register.ts` の `pi.appendEntry(ROUTING_STATE_ENTRY_TYPE, ...)` | 削除。role は `spirits_role` entry だけに記録する |
| `routing/register.ts` の `onStepChange` の `if (registerModelRoles) return` | 削除。step は常に `spirits_step` に記録する |
| `routing/register.ts` の `if (!registerModelRoles)` の `session_tree` ハンドラ | 常時登録 |
| `index.ts` の `if (!routing.roleApi)` | 常時 `registerManagedCommands` |
| `commands/role.ts` の `forkRoleRecord` | 読み取り専用で残す。旧 fork が書いた role の引き継ぎ |
| `managed-pi/default-route.ts` の `StartupRoute` / `selectStartupRoute` | 削除。常に managed |
| `managed-pi/verify.ts` の `managedRepairHint` | 修復コマンド + 旧版の戻し方に変更 |
| `managed-pi/environment.ts` の `ENV_OLD_APP_NAME` / `ENV_OLD_CONFIG_DIR` | 残す。fork 期の残置 env を子環境から除く |
| `constants.ts` の `MANAGED_PI_FORK_ROUTE_HINT` | 削除 |
| `constants.ts` の `ENV_ROUTE` / `ROUTE_FORK_VALUE` | 残す。ホスト起動の経路で `SPIRITS_ROUTE=fork` を拒否する判定だけが参照する (D7) |
| `bin/bootstrap.ts` の `isCompiledRun()` の fork 分岐 | 削除。未コンパイルも managed。未導入時は案内して終了 (D12) |
| `update/classify.ts` の Pi `update` 文法の分類 | 自己更新形だけを判定し、他は案内して非ゼロ (D11) |
| `update/run.ts` の `runExtensionUpdate` と `all` 対象 | 削除 (D11) |
| `update/run.ts` / `update/theme.ts` のテーマ資産の取得・修復 | 削除 (D8) |
| `bin/spirits.ts` の in-process 起動 | 削除。managed ホストを spawn |
| `bin/startup.ts` の fork の戻し先 | 旧版の戻し方に変更 |
| `commands/settings-store.ts` の fork の文言 | 「別の spirits プロセス」に更新 |

## fork 経路だけに意味がある仕様の扱い

| capability | 扱い |
|---|---|
| `session-clear` | 全 8 要件を削除。`managed-commands` の `/spirits-clear` が代替 |
| `model-role-badge` | 全 4 要件を削除。`managed-commands` の拡張 status 行が代替 |
| `model-commands` | 全 9 要件を削除。ホストの `/model` / `/thinking` と `/spirits-role` が代替 |
| `upstream-tracking` | 全 8 要件を削除。`host-upgrade` が代替 |
| `binary-distribution` | 10 要件を変更 (起動、分岐、リリース成果物、インストーラの配置関連など)、3 要件 (theme の配置、チェックサム検証、再実行の判定) を削除、2 要件 (実行ファイルのチェックサム検証、再実行時の版の判定) を追加 |
| `managed-pi` | 5 要件を変更、2 要件を削除、2 要件を追加 |
| `self-update` | 3 要件を変更、4 要件 (取得と検証 / theme / pi update / extension 併用) を削除、1 要件を追加 |
| `managed-commands` | 3 要件を変更、1 要件を削除、1 要件を追加 |
| `dual-model-routing` | 1 要件を変更、2 要件 (`/model` role、分岐間の移動) を削除、1 要件 (分岐の移動) を追加 |
| `product-identity` | 1 要件を変更、1 要件を削除、1 要件を追加 |
| `architecture-conventions` | 4 要件を削除、4 要件を追加 |

この OpenSpec は、MODIFIED で現行のシナリオを落とす変更を拒否する。fork やテーマを名前に含むシナリオを外す要件は、REMOVED と別名の ADDED に分けている (binary-distribution のチェックサム検証・再実行の判定、dual-model-routing の分岐間の移動、architecture-conventions の層の許可表)。
| `managed-pi-compatibility` | 1 要件を変更、1 要件を追加 |
| `colorful-startup-mark` | 変更なし (拡張ヘッダはホストで動く) |
| `verification-harness` | 変更なし (tmux 検証はホスト版更新で使う) |
| `tsrepl` / `rlm` / `continual-harness` / `bundled-skills` / `session-todo` / `action-surface-guard` / `architecture-guards` / `sprt-*` | 変更なし |

## Pi の版更新手順

`docs/spirits-host-upgrade.md` に次の順で書く。

1. 対象の公式 Pi の版を決める。
2. `packages/spirits/package.json` の devDependency `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` を対象の版へ完全一致で更新し、`packages/spirits` で `bun install` する。root の workspace 経由で fork のソースへ解決されないことを `import.meta.resolve` で確認する。
3. `packages/spirits` で `bun run check` (`tsc --noEmit`) を通す。ホストの公開型が変わった箇所は src / test を実型に合わせて直す。
4. `packages/spirits/src/constants.ts` の `PINNED_PI` (版、artifact 名、sha256、overlay 版) を同じ版に更新する。
5. `bun scripts/build-managed-pi-inputs.ts --version <spirits 版> --out dist` で拡張 bundle と manifest を再生成する。
6. `bun scripts/managed-pi-compat/run.ts --mode official --artifact-root <展開先> --bundle dist/spirits-managed-pi-extension.js --out <出力>` で公式 artifact の互換性実測を通す。
7. `scripts/tmux-verify.sh run` でビルドした起動役と managed 一式を対話起動し、ヘッダ・`/spirits-clear`・`tsrepl` を確認する。
8. `bun test` と `bun run check` を通す。
9. `docs/spirits-host-upgrade.md` と `docs/spirits-design.md` の固定値を更新する。

手順 2〜8 のいずれかが失敗した場合は更新を中止し、固定値の変更をコミットしない。手順書には旧版への戻し方 (Rollback) と、旧版の利用者は `spirits update --all` ではなく `spirits update` を使う注意も載せる。`scripts/check-pi-type-mirror.ts` は置かず、型検査は `tsc` に一本化する。

`docs/spirits-upstream-sync.md` と `docs/spirits-core-diffs.md` は削除し、`docs/spirits-design.md` §5 は「ホスト版更新方針」に置き換える。

## Open Questions

- Pi-Bolt の agent dir の向け直し、overlay の適用可否、JIT 無しでの tsrepl の速度、RPC モード、拡張 API の差は、後続 change で実測して決める。この change では未解決事項として列挙するだけにする。