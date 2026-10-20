# Design

## Context

pi は Bun バイナリのとき、組み込みテーマを `<実行ファイルの隣>/theme/{dark,light}.json` から読む。spirits の配布はこのディレクトリを持たないため、`/settings` の `getAvailableThemes()` が ENOENT で落ちる。起動と `tsrepl` が無事なのは、既定の system テーマがコード生成で、`initTheme` が失敗を system へフォールバックするため。

M2 の設計は `docs/spirits-design.md` §4.5 と `docs/spirits-m2-distribution.md` §5・§6・§8・§9 にあり、Decision 9 で theme / assets / export-html / native prebuilds を非同梱とし、テーマは system へ劣化するとしていた。本変更はそのうち theme だけを配布対象へ戻す。他の assets は非同梱のまま。

制約:

- install.sh は POSIX sh で、依存は `curl` と `sha256sum`。自己更新は Bun だけで動く。
- 既存の `spirits-linux-x64` と `.sha256` は旧版 updater が使う。旧版からの更新を壊さない。
- Pi 上流コアは変更しない。テーマ JSON は既存のソースをビルド時にコピーする。
- 更新は実行ファイルの原子的置換を保つ。成功時は `<install>/.spirits-tmp-<pid>/` を使い、終了時に消す。

## Goals / Non-Goals

**Goals:**

- リリース、インストール、自己更新の 3 経路で `<install>/theme/{dark,light}.json` を揃える。
- 旧版 updater がバイナリだけを置いた後でも、新しい `spirits update` または install.sh の再実行でテーマを修復できる。
- 欠落・改変されたテーマ資産で実行ファイルを壊さない。検証は配置前、テーマはファイル単位で原子的に置く。
- install.sh の依存と自己更新の実行時依存を増やさない。

**Non-Goals:**

- export-html / assets / photon wasm / native prebuilds の同梱。
- テーマ JSON のバイナリ埋め込みや pi コアへの変更。
- 起動時の自動ダウンロード・バックグラウンド更新。
- テーマの内容・デザインの変更、macOS / Windows 対応。

## Decisions

### 1. 成果物はテーマ JSON を個別ファイル + 個別 `.sha256` で配る

**選択**: リリースに `dark.json`、`dark.json.sha256`、`light.json`、`light.json.sha256` を追加する。既存のバイナリ資産はそのまま残す。

**理由**: install.sh は `sha256sum -c` だけで検証でき、依存が増えない。自己更新は既存の「1 成果物 + `<url>.sha256`」の取得・検証をそのまま再利用できる。旧版 updater は新しい資産を無視するので互換性が保たれる。

**代替案**: 単一の `spirits-theme.tar.gz` にまとめる案は、install.sh に `tar` を要求し、自己更新にも展開処理が必要になるため却下。複数行の `spirits-theme.sha256` にまとめる案は、複数ファイル検証の新しい実装が必要で、個別 `.sha256` の再利用価値を失うため却下。バイナリへ埋め込む案は Pi コア差分になるため Non-Goal。

**撤回条件**: テーマ資産が 2 ファイルを超えて増えるか、成果物ごとの取得往復が転送量に対して負担になると確認できた場合、単一 manifest / tar 案へ寄せる判断をやり直す。

### 2. 配置先は `<install dir>/theme/` に固定する

**選択**: `~/.spirits/bin/theme/dark.json` と `light.json` に置く。pi の `getThemesDir()` が Bun バイナリで返す場所と一致させる。

**理由**: Pi コアを変更せずに `getBuiltinThemes()` を満たせる。利用者のカスタムテーマ `~/.spirits/agent/themes/` は従来どおり別に扱われる。

**代替案**: `~/.spirits/agent/themes/` に置く案は、`getBuiltinThemes()` が依然として `<exe>/theme` を読み、`/settings` の例外が残るため却下。`PI_PACKAGE_DIR` をエージェント配下へ向ける案は、README / docs / export-html / package.json の解決まで巻き込むため却下。

**撤回条件**: 上流 pi が `getThemesDir()` の Bun バイナリ時の解決先を変えた場合、配置先は上流に追随させ、本判断は撤回する。

### 3. 検証をすべて終えてから、テーマ → バイナリの順に置く

**選択**: バイナリとテーマを `<install>/.spirits-tmp-<pid>/` に取得して全チェックサムを検証する。`<install>/theme/` を作成し、各テーマを rename してから、最後にバイナリを rename する。バイナリは 0755、テーマは 0644。

**理由**: 失敗時に旧実行ファイルを残す既存の不変条件を保てる。テーマは独立したデータで、ファイル単位の rename は原子的なので途中で切れた JSON が残らない。テーマ配置に失敗してもバイナリは置換前のまま。

**代替案**: バイナリを先に置く案は、テーマ失敗時に「更新失敗」と表示しながら実行ファイルだけ新しくなり、既存の失敗時の約束を破るため却下。テーマディレクトリを丸ごと rename する案は、非空ディレクトリの置換が移植可能でなく、削除と rename の間でテーマが消えるため却下。旧テーマをバックアップして失敗時に戻す案は、状態が増えるわりに得るものがファイル単位の原子性と変わらないため却下。

### 4. 同版ではテーマの欠落だけを修復する

**選択**: `VERSION` を指定しない install.sh と `spirits update` は、同版のときテーマの 2 ファイルが揃っていれば従来どおり何も取得しない。欠けていればテーマ資産だけを取得・検証・配置し、実行ファイルは置換しない。

**理由**: 旧版 updater が新しいバイナリだけを置いた移行直後の状態を、次の通常コマンドで直せる。毎回のダウンロードは発生させない。「同版では実行ファイルを置換しない」という既存の契約も保てる。

**代替案**: `--force` や install.sh の再実行を必須にする案は、利用者が気づかず `/settings` が壊れたままになるため却下。起動時に自動修復する案は、起動へネットワークを入れ、自動更新しない方針に反するため却下。常にテーマを再取得する案は、無駄な通信と失敗面を増やすため却下。

### 5. テーマの存在判定は 2 ファイルの存在だけにする

**選択**: `theme/dark.json` と `light.json` が通常ファイルとして存在するかを修復トリガーにする。内容の正しさは、取得時のチェックサムで担保する。

**理由**: 今回の故障はファイル欠落であり、存在確認で十分。JSON の解析やバージョン記録を加えると、install.sh と自己更新の双方に新しい契約が増える。

**代替案**: JSON を解析して有効性を確認する案は、POSIX sh にパーサが必要で、内容の版までは保証できないため却下。版マーカーを別ファイルに置く案は、成果物と状態が増え、移行時の欠落判定が複雑になるため却下。

**実装記録**: 存在判定と配置先パス解決は `packages/spirits/src/update/theme.ts` に集約し、テーマ資産名の出所は `packages/spirits/src/constants.ts` の `THEME_ASSET_NAMES` 1 箇所とする。install.sh は POSIX sh で TS を import できず、`scripts/self-update-smoke.sh`、`scripts/install.test.sh` の fixture、`.github/workflows/spirits-release.yml` もファイル名を直接書く必要があるため、シェル / YAML 側にも同じ名前が複製される（既存の `spirits-linux-x64` 名や `.spirits-tmp-` プレフィックスと同じ方向の重複）。この複製は ARCH-DUP の計数対象外（src のみ）なので、名前の一致を検査するテスト（tasks 1.3）で守る。

**撤回条件**: 上流がテーマ JSON の後方互換を壊すなど、内容の版を判定する必要が出た場合、版マーカーを課す判断へ置き換える。

### 6. ビルドでテーマ資産とチェックサムを生成し、リリース smoke で同じ契約を検証する

**選択**: `scripts/build-binaries.ts` が `packages/coding-agent/src/modes/interactive/theme/{dark,light}.json` を `dist/theme/` へコピーし、各 `.sha256` を生成する。リリース workflow はそれらを添付する。`scripts/self-update-smoke.sh` の fixture もテーマ資産を配り、更新後の配置を検証する。

**理由**: ビルド、リリース、smoke が同じ成果物契約を共有し、テーマ欠落の回帰を CI で検出できる。`dist/theme` を作り直すことで、過去の pi ビルドが残した stale な資産を混入させない。

**代替案**: workflow がソースから直接添付する案は、ビルド成果物とリリース資産が drift し、smoke が本番と同じ経路を通らないため却下。smoke を `--version` だけに留める案は、まさに今回の故障クラスを検出できないため却下。

### 7. 既存のバイナリ資産契約を維持し、移行は 1 回の追加コマンドで済ませる

**選択**: `spirits-linux-x64` と `spirits-linux-x64.sha256` は名前も形式も変えない。旧版 updater はバイナリだけを置く。README に、旧版から更新した直後はもう一度 `spirits update` を実行するか install.sh を再実行してテーマを修復する旨を書く。

**理由**: 旧版 updater を壊さず、移行の追加コマンドを 1 回に抑えられる。テーマは実行ファイルと独立したデータなので、旧版が置いたバイナリと新しいテーマの組み合わせでも起動できる。

**代替案**: バイナリを tar.gz に改名する案は旧版 updater が 404 になり、移行に install.sh を必須化するため却下。バイナリ資産を廃止する案は後方互換を失うため却下。移行を README に書かない案は、利用者が壊れた `/settings` をそのまま踏むため却下。

**撤回条件**: 全利用者がテーマ資産対応の updater 以降へ更新されたことが確認できた時点で、単独の `spirits-linux-x64` 資産を維持する理由が消えるため、廃止の判断をやり直す。

### 8. ドキュメントは theme のみ同梱へ改訂する

**選択**: `docs/spirits-design.md` §4.5、`docs/spirits-m2-distribution.md` §5・§6・§8・§9、`packages/spirits/README.md` を更新し、theme は同梱、export-html / assets / photon wasm / native prebuilds は非同梱と書き分ける。

**理由**: 既存の「theme を同梱しない」記述は実装と矛盾する。他の資産の制約は残るため、一括で同梱する必要はない。

**代替案**: 全 assets を同梱する案は、tar・export-html・native の配布形式まで変える別 change になるため却下。ドキュメントを据え置く案は、README と設計書が実装を誤って説明するため却下。

**既存 spec の Purpose**: 現行 `openspec/specs/binary-distribution/spec.md` の Purpose は「単一バイナリとして配布」の記述が残る。既存 capability の delta の Purpose は archive 時に無視されるため、Purpose は直接編集でテーマ資産を含む記述へ更新し、本変更の実装コミットに含めて archive まで維持する。

## Risks / Trade-offs

- [Risk] リリースにテーマ資産が欠ける、またはチェックサムが一致しない → 配置前に失敗し、インストーラ / 自己更新は実行ファイルを変更しない。 → Mitigation: ビルドで資産とチェックサムを同時生成し、リリース smoke と installer / updater のテストで欠落・不一致を検証する。
- [Risk] 旧版 updater がバイナリだけを置き、テーマが欠けたままになる（移行ギャップ） → 直後の `/settings` が壊れる。 → Mitigation: 同版修復を実装し、README に追加コマンドを明記する。smoke では更新後に `theme/` を削除して旧版 updater の状態を作り、新しいバイナリの `update` でテーマが修復されることを検証する。
- [Risk] 中断でテーマの片方だけが新しくなり、組が不一致になる → 異なる版のテーマが混ざる。 → Mitigation: 各ファイルは完全な JSON で、次回の更新が両方を揃える。仕様はファイル単位の完全性を要求し、組の一致は要求しない。
- [Risk] テーマのファイル名・配置先は pi の内部契約であり、上流変更で壊れる → `/settings` が再び落ちる。 → Mitigation: 名前と配置先は `packages/spirits/src/constants.ts` を唯一の出所とし、シェル / YAML 側の複製は一致を検査するテスト（tasks 1.3）で守る。上流の解決先の変化は上流追従のレビューと、リリース前の手動 tmux 確認（tasks 5.2 で `/settings` を開く）で検出する。リリース smoke が自動で見るのはチェックサム、`--version`、テーマ内容の一致までとする。
- [Risk] リリース資産とリクエストが増え、失敗面が広がる → ダウンロード失敗で更新できない。 → Mitigation: テーマは小さく、同版で揃っていれば取得しない。全成果物を検証してから配置する。
- [Risk] `dist/theme` に過去のビルドの残骸が残る → 異なる内容のテーマがリリースに混ざる。 → Mitigation: ビルドスクリプトが `dist/theme` を作り直す。
- [Risk] 「最新より新しい」prerelease ではテーマを修復しない → その版の `/settings` が壊れたままになり得る。 → Mitigation: その経路ではテーマを変更せず、`VERSION` 指定の install.sh で同じ版の資産を配置できる旨を README に書く。
- [Risk] install.sh は main から配信されるため、テーマ必須化後の install.sh に対してテーマ資産を持たないリリース（0.6.0 以前）を指定すると失敗する → マージから次版リリースまでの窓、`curl | sh` での新規インストールと `VERSION=0.6.0` 以前が失敗する。既存インストールで `VERSION` を指定しない再実行も、最新として解決されたリリースがテーマ資産を持たない間は同版修復の取得先が無いため失敗する（変更前は「already up to date」で成功していた）。 → Mitigation: README に、テーマ資産を持たないリリースはそのタグの install.sh を使う旨と、窓の間は `VERSION` 未指定の再実行も失敗する旨を書く。マージ後すぐ次版をリリースして窓を閉じる。失敗時は配置前に終わり、実行ファイルと既存テーマを変更しない。

## Migration Plan

- 新規インストールは実行ファイルとテーマを同時に配置する。
- 既存インストールは install.sh を再実行するか `spirits update` を実行する。旧版 updater が先にバイナリを置いた場合は、新しいバイナリで `spirits update` をもう一度実行するとテーマだけが修復される。
- テーマ資産を必須化した install.sh に対し、テーマ資産を持たないリリースを指定すると失敗する。その版を導入する場合はそのタグの install.sh を使う旨を README に書く。`VERSION` を指定しない再実行も、最新として解決されたリリースがテーマ資産を持たない窓では同版修復の取得先が無いため失敗する。
- 本変更のマージ後は速やかに次のリリースを作成し、install.sh の取得元（main）と最新の stable リリースの不一致の窓を短くする。
- ロールバックはコードとリリース資産を戻す。旧バイナリは `theme/` を無視するので、残ったテーマ資産は害がない。アンインストール案内は `theme/` の削除も示す。
