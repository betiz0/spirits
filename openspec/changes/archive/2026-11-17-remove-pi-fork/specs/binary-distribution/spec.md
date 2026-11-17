# binary-distribution Delta

## MODIFIED Requirements

### Requirement: コンパイル済み spirits の起動
システムは、コンパイル済み `spirits` の既定の起動経路で、検証済みのホスト Pi 一式を起動し、そのホストが spirits 拡張 bundle を読み込まなければならない。(SHALL)
起動役はホストのソースやパッケージを実行ファイルに内包してはならない。(MUST)
システムは、自己更新として処理する `update`、`spirits managed-pi`、`--version` / `-v`、`--help` / `-h` を除き、`spirits` に渡された CLI 引数を `--` なしでそのままホストの CLI 解釈へ渡さなければならない。(SHALL)
`--` を指定した場合、起動役は `--` より後の引数を解釈せず、`--` を除いてホストへ渡さなければならない。(SHALL)
`SPIRITS_ROUTE=fork` が設定されている場合の扱いは「既定経路の起動役の分岐」に従う。(SHALL)

#### Scenario: 引数なし起動
- **WHEN** コンパイル済み `spirits` を引数なしで起動する
- **THEN** 検証済みのホスト Pi が起動し、セッションで `tsrepl` が有効なツールとして登録されている

#### Scenario: 起動役はホストを内包しない
- **WHEN** コンパイル済み `spirits` の実行ファイルを調べる
- **THEN** ホストのソースやパッケージは含まれず、ホストは managed root の固定 artifact から起動される

#### Scenario: CLI 引数の透過
- **WHEN** `spirits --continue` を実行する
- **THEN** `--continue` が書き換えられずにホストの CLI 解釈へ渡る

#### Scenario: 起動役の help
- **WHEN** `spirits --help` を実行する
- **THEN** 起動役自身の help が表示され、終了コード 0 で終わる

#### Scenario: Pi の引数の透過
- **WHEN** `spirits -- --continue` および `spirits -- --session <file>` を実行する
- **THEN** `--` より後がホストへそのまま渡る

#### Scenario: 追加拡張の指定
- **WHEN** ツールを登録する拡張を指定して `spirits -- -e <拡張パス>` を実行する
- **THEN** ホストがその拡張を読み込み、組み込み spirits 拡張のツールに加えてセッションで利用可能になる

### Requirement: 後段フェーズ機能への非依存
コンパイル用エントリとインストーラは、M3 以降の機能(rlm、Continual Harness、Phase 2)を import・参照してはならない。(MUST)
コンパイル用エントリは、「起動役の版と自己更新を処理する」責務、「ホスト一式の導入状態を確認し、検証して起動する」責務、「`--help` / `-h` の help を出す」責務だけを持ち、拡張内にどのツールが登録されているかを知ってはならない。(MUST)
インストーラは、バイナリの内部構成や同梱機能に依存してはならず、リリース成果物の名前とチェックサム、および `--version` の表示結果だけに依存しなければならない。(SHALL)

#### Scenario: 後段機能の非参照
- **WHEN** コンパイル用エントリとインストーラの参照を列挙する
- **THEN** rlm / harness / phase2 のモジュールやコマンドへの参照が存在しない

#### Scenario: 登録内容に依存しない起動
- **WHEN** コンパイル用エントリのソースを確認する
- **THEN** 登録済みツールの名前・一覧を参照する記述が存在しない

### Requirement: 既定経路の起動役の分岐
`spirits` は、起動時に経路を選ばず、常に検証済みの managed ホストを起動しなければならない。(SHALL) 未コンパイルの実行も managed ホストを起動する。(SHALL)
managed の一式が未導入のとき、コンパイル済みは同じリリースから取得して起動し、未コンパイルは導入方法を表示して非ゼロで終了しなければならない。(SHALL) 詳細は managed-pi の「既定経路の一式の欠落と失敗時の挙動」に従う。
`SPIRITS_ROUTE=fork` が設定されている場合、起動役はホストを起動する経路でだけ、フォークを起動せず、`SPIRITS_ROUTE` が廃止された理由、`unset SPIRITS_ROUTE` で managed が起動すること、旧版への戻し方を表示して非ゼロで終了しなければならない。(MUST)
`SPIRITS_ROUTE=fork` が設定されていても、`update`、`managed-pi`、`--version` / `-v`、`--help` / `-h` は通常どおり処理しなければならない。(SHALL)

#### Scenario: 既定で managed
- **WHEN** `SPIRITS_ROUTE` を設定せずにコンパイル済み `spirits` を起動する
- **THEN** 検証済みのホストが起動する

#### Scenario: SPIRITS_ROUTE=fork
- **WHEN** `SPIRITS_ROUTE=fork` を設定してコンパイル済み `spirits` を起動する
- **THEN** フォークもホストも起動せず、廃止された理由、`unset SPIRITS_ROUTE`、旧版への戻し方が表示され、終了コードは非ゼロになる

#### Scenario: SPIRITS_ROUTE=fork でもサブコマンドは動く
- **WHEN** `SPIRITS_ROUTE=fork` を設定して `spirits --version`、`spirits --help`、`spirits update`、`spirits managed-pi help` を実行する
- **THEN** それぞれ設定が無い場合と同じ出力と終了コードになり、`SPIRITS_ROUTE` の廃止エラーは出ない

#### Scenario: 未コンパイル実行
- **WHEN** managed の一式を導入済みの環境で、ソースからエントリを実行する
- **THEN** 導入済みの managed ホストが検証されて起動する

#### Scenario: その他の値は managed
- **WHEN** `SPIRITS_ROUTE` に `fork` 以外の値を設定して起動する
- **THEN** managed が起動し、不明な値であることを理由に失敗しない

#### Scenario: ホスト未導入
- **WHEN** managed ホストが未導入の状態で、ソースからエントリを実行する
- **THEN** `spirits managed-pi install` またはマニフェスト URL の指定方法が表示され、終了コードは非ゼロになる

### Requirement: 配置と冪等性
インストーラは、検証済みの実行ファイルを `~/.spirits/bin/spirits` に配置しなければならない。(SHALL)
インストーラは、配置した実行ファイルに実行ビットを付与しなければならない。(SHALL)
配置先ディレクトリが無い場合は作成しなければならない。(SHALL)
配置には root 権限を要求してはならない。(SHALL)
既存の `~/.spirits/bin/theme/` は削除も変更もしてはならない。(MUST)

#### Scenario: 初回配置
- **WHEN** `~/.spirits/bin` が無い状態でインストーラを実行する
- **THEN** ディレクトリが作成され、`~/.spirits/bin/spirits` が実行可能ファイルとして存在し、`~/.spirits/bin/theme/` は作られない

#### Scenario: 旧版のテーマ資産の残置
- **WHEN** 旧版が配置した `~/.spirits/bin/theme/dark.json` がある状態でインストーラを実行する
- **THEN** そのファイルは元の内容のまま残る

### Requirement: バージョンを明示した再配置
`VERSION` を指定した実行、および異なるバージョンが解決された実行では、既存ファイルを上書きして同じ結果にならなければならない。インストール済みバージョンが解決されたバージョンより新しい場合(prerelease ビルドなど)も上書きする。この点で、置換しない `spirits update` とは挙動が異なる。(SHALL)

#### Scenario: VERSION 明示での再配置
- **WHEN** 0.1.0 がインストール済みの環境で `VERSION=0.1.0` を指定してインストーラを実行する
- **THEN** 成果物がダウンロードされ、`~/.spirits/bin/spirits` は 0.1.0 の実行ファイルで置き換えられる

#### Scenario: 別バージョンへの再実行
- **WHEN** `VERSION=0.1.0` でインストール済みの環境で `VERSION=0.2.0` のインストーラを実行する
- **THEN** 処理は成功し、`~/.spirits/bin/spirits` の内容は 0.2.0 の実行ファイルに置き換わり、実行可能のままになる

#### Scenario: 新しい prerelease からの置換
- **WHEN** 0.4.0-rc.1 がインストール済みで最新 stable が 0.3.0 の環境で、`VERSION` を指定せずにインストーラを実行する
- **THEN** 成果物がダウンロードされ、`~/.spirits/bin/spirits` は 0.3.0 の実行ファイルで置き換えられる

### Requirement: 配置の原子的性質と一時ファイルの掃除
配置の途中のどの時点でも、`~/.spirits/bin/spirits` は元の実行ファイル全体か、検証済みの新しい実行ファイル全体のいずれかでなければならない。(SHALL)
インストーラは、失敗した場合、および SIGINT または SIGTERM を受けて中断した場合、自身が作成した一時ファイルを削除しなければならない。(SHALL)
インストーラは、開始時に、配置先ディレクトリに残っている過去のインストーラまたは自己更新の一時ファイルを削除しなければならない。ただし、実行中の別のインストーラまたは自己更新が使用している一時ファイルは削除してはならない。(SHALL)

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
インストーラは、`--uninstall` 指定時に、配置済みの `~/.spirits/bin/spirits`、ホスト一式 `~/.spirits/managed-pi`、およびデータディレクトリ `~/.spirits/agent/` を削除するためのコマンドを標準出力へ案内しなければならない。(SHALL)
`--uninstall` 指定時、インストーラはファイルとディレクトリを変更してはならず、shell rc を編集してはならない。(MUST)
`--uninstall` 指定時、インストーラはネットワークアクセスを行わず、`curl` / `sha256sum` を要求してはならない。(SHALL)
`--uninstall` は、対象が存在しない場合も終了コード 0 で終わらなければならない。(SHALL)

#### Scenario: 削除案内の出力
- **WHEN** `--uninstall` を指定してインストーラを実行する
- **THEN** `~/.spirits/bin/spirits`、`~/.spirits/managed-pi`、`~/.spirits/agent/` を削除するコマンドが出力され、終了コードは 0 になり、インストール済みファイルとデータディレクトリは変更されない

#### Scenario: 未インストールでの案内
- **WHEN** `spirits` が配置されていない環境で `--uninstall` を実行する
- **THEN** 案内が表示され、終了コードは 0 になる

#### Scenario: 依存コマンドなしでの案内
- **WHEN** `PATH` 上に `curl` も `sha256sum` も無い Linux x86_64 環境で `--uninstall` を実行する
- **THEN** 案内が表示され、終了コードは 0 になる

### Requirement: 外部拡張のロード
ホスト Pi は、`~/.spirits/agent/extensions/` に配置された外部 TypeScript 拡張を、組み込み spirits 拡張 bundle と合わせてロードしなければならない。(SHALL)
外部拡張からホストのパッケージを import できなければならない。(SHALL)
外部拡張が独自の node_modules 依存を要求し、それがホストに存在しない場合、ホストはその拡張のロード失敗を拡張パスを含むエラーとして stderr に報告し、非ゼロの終了コードで終了しなければならない。(SHALL)
`--help` のようにセッションを開始しないコマンドが指定された場合は、外部拡張のロード失敗があっても help の出力を優先し、終了コード 0 で終了しなければならない。(SHALL)
ホストの実行ファイルがパッケージマネージャを内包しないため拡張の依存解決には別途 Bun が必要である旨を、README に記載しなければならない。(SHALL)

#### Scenario: 外部拡張のロード
- **WHEN** `~/.spirits/agent/extensions/` にツールを登録する外部拡張を配置して `spirits` を起動する
- **THEN** そのツールがセッションで利用可能になる

#### Scenario: バンドル済み pi パッケージの import
- **WHEN** 外部拡張が `@earendil-works/pi-coding-agent` を import する
- **THEN** import はホストが提供するパッケージへ解決される

#### Scenario: 依存不足の拡張
- **WHEN** 外部拡張がホストに存在しないベア指定子のパッケージを import する
- **THEN** セッションは起動せず、ロード失敗がその拡張のパスを含むエラーとして stderr に報告され、終了コードは非ゼロになる

#### Scenario: セッションを開始しないコマンドの優先
- **WHEN** 依存不足の外部拡張が存在する状態で `spirits --help` を実行する
- **THEN** help が表示され、ロード失敗のエラーは表示されず、終了コードは 0 になる

#### Scenario: README の案内
- **WHEN** `packages/spirits/README.md` を確認する
- **THEN** 外部拡張の依存解決には別途 Bun が必要である旨が記載されている

### Requirement: リリース成果物
リポジトリは `spirits-v*` 形式のタグ push を契機に、ubuntu ランナーと固定した Bun(1.4.2 以上)で依存導入・テスト・ビルドを実行し、`spirits-linux-x64` と `spirits-linux-x64.sha256` を GitHub Release に添付しなければならない。(SHALL)
リリースは、旧版の自己更新が取得するテーマ資産 `dark.json`、`light.json` と、それぞれの `.sha256` を、互換用として引き続き添付しなければならない。(SHALL) 新しい起動役、インストーラ、自己更新はこれらを使ってはならない。(MUST)
リリースノートには、ビルドに使用した内包 Bun のバージョンを記載しなければならない。(SHALL)
タグのバージョン部に `-` を含む場合(例: `spirits-v0.3.0-rc.1`)、リリースは prerelease として公開しなければならない。(SHALL)
テストまたはビルドが失敗した場合、リリースを公開してはならない。(MUST)
`spirits-v*` 以外のタグ push と、タグ以外の手動起動は、このリリース処理を起動してはならない。(SHALL)

#### Scenario: タグ push によるリリース
- **WHEN** `spirits-v0.1.0` タグを push する
- **THEN** 専用の GitHub Release が作成され、実行ファイルとそのチェックサムが添付され、リリースノートに内包 Bun のバージョンが含まれる

#### Scenario: テーマ資産の添付
- **WHEN** `spirits-v0.1.0` タグを push してリリースが作成される
- **THEN** `dark.json`、`light.json` とそれぞれの `.sha256` が互換用として添付され、`sha256sum -c` で検証でき、どちらも JSON として解析できる

#### Scenario: prerelease の公開
- **WHEN** `spirits-v0.0.0-test` タグを push する
- **THEN** 作成される Release は prerelease として公開される

#### Scenario: 検証失敗時の非公開
- **WHEN** リリースビルドのテストが失敗する
- **THEN** 実行ファイルを含む Release は公開されない

#### Scenario: 既存 pi リリースとの分離
- **WHEN** `v1.0.0` のように `spirits-` で始まらないタグを push する
- **THEN** spirits のリリース処理は起動しない

### Requirement: インストーラによる managed 一式の導入
インストーラは、起動役の実行ファイルを配置した後、同じリリースの manifest から managed の一式を取得し、検証して導入しなければならない。(SHALL)
導入は検証済みのバイナリを配置した後に実行し、配置済みの実行ファイルを取り替えてはならない。(MUST)
managed の一式の取得または導入に失敗した場合、インストーラは理由と修復コマンド `spirits managed-pi repair`、および旧版への戻し方を表示して非ゼロで終了しなければならない。(MUST)

#### Scenario: 同じリリースの導入
- **WHEN** `VERSION=0.7.0` を指定してインストーラを実行する
- **THEN** `spirits-v0.7.0` の manifest と bundle が使われ、`~/.spirits/managed-pi` に一式が導入される

#### Scenario: managed 導入失敗時の非ゼロ
- **WHEN** 実行ファイルの配置に成功したが managed の manifest の取得に失敗する
- **THEN** 終了コードは非ゼロになり、理由と `spirits managed-pi repair` と旧版への戻し方が表示される

#### Scenario: 実行ファイルは保持される
- **WHEN** managed の導入に失敗する
- **THEN** 配置済みの実行ファイルは検証済みの新しい内容のまま残る

## REMOVED Requirements

### Requirement: 組み込みテーマ資産の配置
**Reason**: テーマはホスト Pi の配布物に含まれ、起動役もインストーラもテーマ資産を使わなくなったため。
**Migration**: テーマは managed 一式のホスト artifact が提供する。リリースは旧版の自己更新のためにテーマ資産を互換用として添付し続けるが、インストーラは取得も配置もしない。既存の `~/.spirits/bin/theme/` は残置物として変更しない。

### Requirement: チェックサム検証
**Reason**: インストーラがテーマ資産を扱わなくなり、テーマ資産の検証を前提とするシナリオを外すため。
**Migration**: 追加する要件「実行ファイルのチェックサム検証」に従う。

### Requirement: 再実行の判定
**Reason**: インストーラがテーマ資産を修復しなくなり、テーマ資産の修復のシナリオを外すため。
**Migration**: 追加する要件「再実行時の版の判定」に従う。既存の `~/.spirits/bin/theme/` は修復も変更もしない。

## ADDED Requirements

### Requirement: 実行ファイルのチェックサム検証
インストーラは、ダウンロードした実行ファイルを、その `.sha256` とともに一時ディレクトリで `sha256sum -c` により検証しなければならない。(SHALL)
検証に失敗した場合、一時ファイルを削除して非ゼロで終了し、`~/.spirits/bin/spirits` を作成・変更してはならない。(MUST)
検証に成功した場合に限り、配置処理へ進まなければならない。(SHALL)
インストーラは、リリースに添付されたテーマ資産を取得してはならない。(MUST)

#### Scenario: 検証失敗時に配置しない
- **WHEN** ダウンロードした実行ファイルを改変し、`.sha256` と一致しない状態でインストーラを実行する
- **THEN** 終了コードは非ゼロになり、`~/.spirits/bin/spirits` は作成されず、既存ファイルがあれば元の内容のまま残る

#### Scenario: 検証成功
- **WHEN** 実行ファイルと `.sha256` が一致する状態でインストーラを実行する
- **THEN** 配置処理が実行される

#### Scenario: テーマ資産を取得しない
- **WHEN** テーマ資産を添付したリリースを指定してインストーラを実行する
- **THEN** `dark.json` と `light.json` はダウンロードされず、`~/.spirits/bin/theme/` は作成も変更もされない

### Requirement: 再実行時の版の判定
`VERSION` を指定しない実行では、インストール済みの実行ファイルの `--version` 出力の先頭行 `spirits <version>` から取り出したバージョンが、最新として解決されたバージョンと等しい場合、実行ファイルのダウンロードと配置を行わず、インストール済みバージョンが最新である旨を表示しなければならない。(SHALL)
インストール済みの実行ファイルが無い場合、その `--version` が非ゼロで終了した場合、または出力からバージョンを取り出せない場合、インストーラはダウンロードと配置へ進まなければならない。(SHALL)

#### Scenario: 再実行
- **WHEN** `VERSION` を指定せず、インストール済みと同じバージョンが最新として解決された状態でインストーラを実行する
- **THEN** 処理は成功し、`~/.spirits/bin/spirits` の内容は変更されず、インストール済みバージョンが最新である旨が表示される

#### Scenario: バージョンを判定できない場合の配置
- **WHEN** インストール済みの `~/.spirits/bin/spirits --version` が非ゼロで終了する環境で、`VERSION` を指定せずにインストーラを実行する
- **THEN** 成果物がダウンロードされ、`~/.spirits/bin/spirits` は最新版の実行ファイルで置き換えられる
