# host-upgrade Specification

## Purpose

固定した公式 Pi ホスト artifact の版と SHA256 を更新し、`packages/spirits` の固定 devDependency と `tsc` による型検査、公式 artifact 上での互換性を検証してからリリースする手順を、再実行可能な契約として定める。

## Requirements

### Requirement: ホスト artifact の固定
システムは、起動役と managed 一式が使う公式 Pi ホストを、1 つの版と 1 つの artifact SHA256 として固定しなければならない。(SHALL) 固定値はソース内の 1 か所に置き、manifest 生成と検証の両方が同じ値を読まなければならない。(MUST)
固定した artifact の SHA256 が一致しない場合、インストールと起動は失敗しなければならない。(MUST)

#### Scenario: 固定値の参照
- **WHEN** リリースの manifest を生成する
- **THEN** `pi.version` と `pi.artifact.sha256` が、検証が使うものと同じ固定値から作られる

#### Scenario: 改変された artifact の拒否
- **WHEN** 固定 SHA256 と一致しない Pi artifact を導入する
- **THEN** 導入は失敗し、理由が表示され、何も配置されない
### Requirement: ホスト版の更新手順
リポジトリは、ホストの版を更新する手順書 `docs/spirits-host-upgrade.md` を保持しなければならない。(SHALL)
手順書は、`packages/spirits` の固定 devDependency (対象版) の更新と `tsc` による型検査、固定値 (artifact SHA256・overlay 版) の更新、拡張 bundle と manifest の再生成、公式 artifact での互換性実測、tmux 検証を、この順で、各手順の実行コマンドとともに記載しなければならない。(MUST)
手順書は、いずれかの手順が失敗した場合に更新を中止し、固定値の変更をコミットしないことを記載しなければならない。(MUST)

#### Scenario: 手順の順序とコマンド
- **WHEN** `docs/spirits-host-upgrade.md` を読む
- **THEN** devDependency の更新と `tsc` から tmux 検証までがこの順に並び、各手順に実行コマンドが付いている

#### Scenario: 失敗時の中止
- **WHEN** 手順書の失敗時の扱いを読む
- **THEN** `tsc` による型検査または公式 artifact での互換性実測が失敗した場合は更新を中止し、固定値の変更をコミットしない旨が記載されている
### Requirement: 公式型による型検査
システムは、`packages/spirits` の固定した公式パッケージ (`@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui`) を devDependency として完全一致で保持し、ホストの型を実型として `tsc --noEmit` で検査しなければならない。(SHALL) `packages/spirits/src/types/` にホスト型の再宣言 (型ミラー) を置いてはならない。(MUST) `packages/spirits` の解決が root の workspace 経由で fork のソースへ向いてはならない。(MUST) `scripts/check-pi-type-mirror.ts` を置いてはならない。(MUST)

#### Scenario: 実型で検査する
- **WHEN** `packages/spirits` で `bun run check` を実行する
- **THEN** ホストの公開型を固定 devDependency の実体から解決し、型エラーが 0 件である

#### Scenario: 型ミラーを置かない
- **WHEN** `packages/spirits/src/types/` を調べる
- **THEN** ホスト API の再宣言 (型ミラー) が無い

#### Scenario: 公開面の外は失敗する
- **WHEN** `@earendil-works/pi-coding-agent/core/session` のように `exports` に無い subpath を import する
- **THEN** `tsc` はその specifier を解決できず失敗する
### Requirement: 公式 artifact での互換性実測
システムは、ホストの版を更新したとき、固定した公式 artifact と対象 commit の拡張 bundle で互換性ランナーの公式モードを実行し、必須観測が `confirmed` または `limited` で、失敗が 0 件であることを確認しなければならない。(SHALL) `not-run` を成功として扱ってはならない。(MUST)

#### Scenario: 公式モードの成功
- **WHEN** 公式 artifact で互換性ランナーを実行する
- **THEN** 必須観測に `failed` が無く、結果に公式モードの識別情報が記録される

#### Scenario: 必須観測の未実行
- **WHEN** 必須観測の一部が `not-run` になる
- **THEN** 互換性確認は成功として報告されない
### Requirement: tmux 検証
システムは、ホストの版を更新したとき、ビルドした起動役と managed 一式を tmux 検証ランナーで起動し、起動ヘッダ、`/spirits-clear`、および `tsrepl` の呼び出しを確認しなければならない。(SHALL) 検証ランナーは検証後にプロセスと一時リソースを回収しなければならない。(MUST)

#### Scenario: 対話起動の確認
- **WHEN** ビルドした起動役を tmux 検証ランナーで起動する
- **THEN** 起動ヘッダと `tsrepl` のツール登録が確認でき、検証後にペインのプロセスが残らない
### Requirement: 旧版への戻し方
リポジトリは、新しい起動役が動かないときの戻し方を文書に保持しなければならない。(SHALL) 文書は、`~/.spirits/bin` の退避、フォーク最終コミットに打ったタグから旧版バイナリを再ビルドする手順 (リリースと同じ model data の準備を含む)、および旧版で fork を起動するための `SPIRITS_ROUTE=fork` の指定を含まなければならない。(MUST)

#### Scenario: 戻し方の確認
- **WHEN** リリース後の手順書を確認する
- **THEN** `~/.spirits/bin` の退避先、タグから旧版バイナリを再ビルドするコマンド、旧版で fork を起動するための `SPIRITS_ROUTE=fork` が記載されている
### Requirement: 自己更新経路の検証
システムは、ホストの版と起動役を更新したとき、一つ前のリリースの `spirits` 実行ファイルから `spirits update` を実行し、新しい版へ更新され、同じリリースの managed 一式が導入されることを確認しなければならない。(SHALL)

#### Scenario: 旧版からの更新
- **WHEN** 一つ前のリリースの実行ファイルで `spirits update` を実行する
- **THEN** 新しい実行ファイルへ置換され、同じリリースの manifest と bundle が managed root に導入され、終了コードは 0 になる
