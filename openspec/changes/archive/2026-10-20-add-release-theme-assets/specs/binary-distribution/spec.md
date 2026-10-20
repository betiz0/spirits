# Spec Delta

## MODIFIED Requirements

### Requirement: チェックサム検証
インストーラは、ダウンロードした実行ファイルおよびテーマ資産を、それぞれの `.sha256` とともに一時ディレクトリで `sha256sum -c` により検証しなければならない。(SHALL)
検証に失敗した場合、一時ファイルを削除して非ゼロで終了し、`~/.spirits/bin/spirits` と `~/.spirits/bin/theme/` を作成・変更してはならない。(MUST)
検証に成功した場合に限り、配置処理へ進まなければならない。(SHALL)

#### Scenario: 検証失敗時に配置しない
- **WHEN** ダウンロードした実行ファイルを改変し、`.sha256` と一致しない状態でインストーラを実行する
- **THEN** 終了コードは非ゼロになり、`~/.spirits/bin/spirits` は作成されず、既存ファイルがあれば元の内容のまま残る

#### Scenario: 検証成功
- **WHEN** 実行ファイルと `.sha256` が一致する状態でインストーラを実行する
- **THEN** 配置処理が実行される

#### Scenario: テーマ資産の検証失敗時に配置しない
- **WHEN** ダウンロードしたテーマ資産を改変し、`.sha256` と一致しない状態でインストーラを実行する
- **THEN** 終了コードは非ゼロになり、`~/.spirits/bin/spirits` と既存のテーマ資産は元の内容のまま残る

#### Scenario: テーマ資産を持たないリリースの失敗
- **WHEN** `VERSION=0.6.0` のようにテーマ資産を持たないリリースを指定してインストーラを実行する
- **THEN** 終了コードは非ゼロになり、`~/.spirits/bin/spirits` と `~/.spirits/bin/theme/` は作成も変更もされない

#### Scenario: テーマ資産を持たない最新リリースの失敗
- **WHEN** `VERSION` を指定せずにインストーラを実行し、最新として解決されたリリースがテーマ資産を持たない状態である
- **THEN** 終了コードは非ゼロになり、`~/.spirits/bin/spirits` と `~/.spirits/bin/theme/` は作成も変更もされない

### Requirement: 配置と冪等性
インストーラは、検証済みの実行ファイルを `~/.spirits/bin/spirits` に、検証済みのテーマ資産を `~/.spirits/bin/theme/dark.json` と `~/.spirits/bin/theme/light.json` に配置しなければならない。(SHALL)
インストーラは、配置した実行ファイルに実行ビットを付与しなければならない。(SHALL)
配置先ディレクトリが無い場合は作成しなければならない。(SHALL)
`VERSION` を指定しない実行では、インストール済みの実行ファイルの `--version` 出力の先頭行 `spirits <version>` から取り出したバージョンが、最新として解決されたバージョンと等しく、かつテーマ資産が揃っている場合、ダウンロードと配置を行わず、インストール済みバージョンが最新である旨を表示しなければならない。(SHALL)
`VERSION` を指定しない実行で、インストール済みバージョンが最新として解決されたバージョンと等しく、テーマ資産が欠けている場合、インストーラは実行ファイルを変更せずにテーマ資産だけを取得・検証・配置し、テーマ資産を修復した旨を表示しなければならない。(SHALL)
インストール済みの実行ファイルが無い場合、その `--version` が非ゼロで終了した場合、または出力からバージョンを取り出せない場合、インストーラはダウンロードと配置へ進まなければならない。(SHALL)
`VERSION` を指定した実行、および異なるバージョンが解決された実行では、既存ファイルを上書きして同じ結果にならなければならない。インストール済みバージョンが解決されたバージョンより新しい場合(prerelease ビルドなど)も上書きする。この点で、置換しない `spirits update` とは挙動が異なる。(SHALL)
配置の途中のどの時点でも、`~/.spirits/bin/spirits` は元の実行ファイル全体か、検証済みの新しい実行ファイル全体のいずれかでなければならない。(SHALL)
テーマ資産の配置の途中のどの時点でも、各ファイルは元の内容全体か、検証済みの新しい内容全体のいずれかでなければならない。(SHALL)
インストーラは、失敗した場合、および SIGINT または SIGTERM を受けて中断した場合、自身が作成した一時ファイルを削除しなければならない。(SHALL)
インストーラは、開始時に、配置先ディレクトリに残っている過去のインストーラまたは自己更新の一時ファイルを削除しなければならない。ただし、実行中の別のインストーラまたは自己更新が使用している一時ファイルは削除してはならない。(SHALL)
配置には root 権限を要求してはならない。(SHALL)

#### Scenario: 初回配置
- **WHEN** `~/.spirits/bin` が無い状態でインストーラを実行する
- **THEN** ディレクトリが作成され、`~/.spirits/bin/spirits` が実行可能ファイルとして存在し、`~/.spirits/bin/theme/dark.json` と `~/.spirits/bin/theme/light.json` が存在する

#### Scenario: 再実行
- **WHEN** `VERSION` を指定せず、インストール済みと同じバージョンが最新として解決され、テーマ資産が揃っている状態でインストーラを実行する
- **THEN** 処理は成功し、`~/.spirits/bin/spirits` とテーマ資産の内容は変更されず、インストール済みバージョンが最新である旨が表示される

#### Scenario: テーマ資産の修復
- **WHEN** `VERSION` を指定せず、インストール済みと同じバージョンが最新として解決され、`~/.spirits/bin/theme/dark.json` または `light.json` が欠けている状態でインストーラを実行する
- **THEN** 実行ファイルは変更されず、テーマ資産が配置され、修復した旨が表示され、終了コードは 0 になる

#### Scenario: VERSION 明示での再配置
- **WHEN** 0.1.0 がインストール済みの環境で `VERSION=0.1.0` を指定してインストーラを実行する
- **THEN** 成果物がダウンロードされ、`~/.spirits/bin/spirits` は 0.1.0 の実行ファイルで置き換えられ、テーマ資産も 0.1.0 の内容で置き換えられる

#### Scenario: 別バージョンへの再実行
- **WHEN** `VERSION=0.1.0` でインストール済みの環境で `VERSION=0.2.0` のインストーラを実行する
- **THEN** 処理は成功し、`~/.spirits/bin/spirits` の内容は 0.2.0 の実行ファイルに置き換わり、実行可能のままになり、テーマ資産も 0.2.0 の内容になる

#### Scenario: 新しい prerelease からの置換
- **WHEN** 0.4.0-rc.1 がインストール済みで最新 stable が 0.3.0 の環境で、`VERSION` を指定せずにインストーラを実行する
- **THEN** 成果物がダウンロードされ、`~/.spirits/bin/spirits` は 0.3.0 の実行ファイルで置き換えられ、テーマ資産も 0.3.0 の内容になる

#### Scenario: バージョンを判定できない場合の配置
- **WHEN** インストール済みの `~/.spirits/bin/spirits --version` が非ゼロで終了する環境で、`VERSION` を指定せずにインストーラを実行する
- **THEN** 成果物がダウンロードされ、`~/.spirits/bin/spirits` は最新版の実行ファイルで置き換えられ、テーマ資産も最新版の内容になる

#### Scenario: 中断時の既存ファイル維持
- **WHEN** 既存の `~/.spirits/bin/spirits` がある状態で、ダウンロード中のインストーラに SIGINT を送る
- **THEN** `~/.spirits/bin/spirits` は元の内容と実行ビットを保ち、インストーラの一時ファイルは残らない

#### Scenario: 残った一時ファイルの削除
- **WHEN** 既に終了したプロセスが残した一時ファイルが `~/.spirits/bin` にある状態でインストーラを実行する
- **THEN** その一時ファイルは削除される

#### Scenario: 実行中の一時ファイルの保護
- **WHEN** 実行中の `spirits update` が使用している一時ファイルが `~/.spirits/bin` にある状態でインストーラを実行する
- **THEN** その一時ファイルは削除されない

### Requirement: アンインストールの案内
インストーラは、`--uninstall` 指定時に、配置済みの `~/.spirits/bin/spirits`、`~/.spirits/bin/theme/`、およびデータディレクトリ `~/.spirits/agent/` を削除するためのコマンドを標準出力へ案内しなければならない。(SHALL)
`--uninstall` 指定時、インストーラはファイルとディレクトリを変更してはならず、shell rc を編集してはならない。(MUST)
`--uninstall` 指定時、インストーラはネットワークアクセスを行わず、`curl` / `sha256sum` を要求してはならない。(SHALL)
`--uninstall` は、対象が存在しない場合も終了コード 0 で終わらなければならない。(SHALL)

#### Scenario: 削除案内の出力
- **WHEN** `--uninstall` を指定してインストーラを実行する
- **THEN** `~/.spirits/bin/spirits`、`~/.spirits/bin/theme/`、`~/.spirits/agent/` を削除するコマンドが出力され、終了コードは 0 になり、インストール済みファイルとデータディレクトリは変更されない

#### Scenario: 未インストールでの案内
- **WHEN** `spirits` が配置されていない環境で `--uninstall` を実行する
- **THEN** 案内が表示され、終了コードは 0 になる

#### Scenario: 依存コマンドなしでの案内
- **WHEN** `PATH` 上に `curl` も `sha256sum` も無い Linux x86_64 環境で `--uninstall` を実行する
- **THEN** 案内が表示され、終了コードは 0 になる

### Requirement: リリース成果物
リポジトリは `spirits-v*` 形式のタグ push を契機に、ubuntu ランナーと固定した Bun(1.4.2 以上)で依存導入・テスト・ビルドを実行し、`spirits-linux-x64` と `spirits-linux-x64.sha256`、および組み込みテーマの `dark.json` と `light.json`、それぞれの `.sha256` を GitHub Release に添付しなければならない。(SHALL)
リリースノートには、ビルドに使用した内包 Bun のバージョンを記載しなければならない。(SHALL)
タグのバージョン部に `-` を含む場合(例: `spirits-v0.3.0-rc.1`)、リリースは prerelease として公開しなければならない。(SHALL)
テストまたはビルドが失敗した場合、リリースを公開してはならない。(MUST)
`spirits-v*` 以外のタグ push と、タグ以外の手動起動は、このリリース処理を起動してはならない。(SHALL)

#### Scenario: タグ push によるリリース
- **WHEN** `spirits-v0.1.0` タグを push する
- **THEN** 専用の GitHub Release が作成され、実行ファイルとテーマ資産、およびそれぞれのチェックサムが添付され、リリースノートに内包 Bun のバージョンが含まれる

#### Scenario: テーマ資産の添付
- **WHEN** `spirits-v0.1.0` タグを push してリリースが作成される
- **THEN** `dark.json`、`dark.json.sha256`、`light.json`、`light.json.sha256` が添付され、各 `.sha256` は対応するファイルと一致する

#### Scenario: prerelease の公開
- **WHEN** `spirits-v0.0.0-test` タグを push する
- **THEN** 作成される Release は prerelease として公開される

#### Scenario: 検証失敗時の非公開
- **WHEN** リリースビルドのテストが失敗する
- **THEN** 実行ファイルを含む Release は公開されない

#### Scenario: 既存 pi リリースとの分離
- **WHEN** `v1.0.0` のように `spirits-` で始まらないタグを push する
- **THEN** spirits のリリース処理は起動せず、既存の pi リリース処理だけが動作する

## ADDED Requirements

### Requirement: 組み込みテーマ資産の配置
インストーラは、pi が組み込みテーマを解決できるよう、実行ファイルと同じディレクトリの `theme/` に `dark.json` と `light.json` を配置しなければならない。(SHALL)
テーマ資産の配置は実行ファイルの配置より先に行わなければならない。実行ファイルは最後に置く。(SHALL)
配置するテーマ資産は、pi の組み込みテーマと同じ内容でなければならない。(SHALL)

#### Scenario: 新規インストール後のテーマ解決
- **WHEN** テーマ資産を含むリリースをインストーラで新規に導入し、`spirits` を起動して `/settings` を開く
- **THEN** 例外が表示されず、テーマの選択肢に `system`、`dark`、`light` が含まれる

#### Scenario: テーマ資産の内容
- **WHEN** インストーラで導入した `~/.spirits/bin/theme/dark.json` と `light.json` を読む
- **THEN** どちらも JSON として解析でき、pi が起動時に組み込みテーマとして読み込める
