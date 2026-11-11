# binary-distribution Delta

## ADDED Requirements

### Requirement: 既定経路の起動役の分岐
コンパイル済み `spirits` は、起動時に経路を選び、既定では managed を起動しなければならない。(SHALL)
環境変数 `SPIRITS_ROUTE` が `fork` の場合に従来の fork を起動し、それ以外の値と未設定では managed を起動する。(SHALL)
未コンパイルの実行では常に fork を起動する。(SHALL)
分岐は pi を import する前に決め、managed を起動した場合は fork の pi を起動してはならない。(MUST)
fork を起動する手段は、fork を削除する変更までの間、残さなければならない。(SHALL)

#### Scenario: 既定で managed
- **WHEN** `SPIRITS_ROUTE` を設定せずにコンパイル済み `spirits` を起動する
- **THEN** managed が起動し、fork の pi は起動しない

#### Scenario: SPIRITS_ROUTE=fork
- **WHEN** `SPIRITS_ROUTE=fork` を設定してコンパイル済み `spirits` を起動する
- **THEN** 従来の fork が起動し、managed の検証・spawn は行わない

#### Scenario: その他の値は managed
- **WHEN** `SPIRITS_ROUTE` に `fork` 以外の値を設定して起動する
- **THEN** managed を起動し、不明な値であることを理由に失敗しない

#### Scenario: 未コンパイル実行
- **WHEN** ソースからエントリを実行する
- **THEN** managed を起動せず fork が起動する

### Requirement: managed 一式のリリース成果物
リリースは、起動役の実行ファイルに加えて、managed の一式の取得元となる manifest と spirits 拡張 bundle、およびそれぞれの `.sha256` を GitHub Release に添付しなければならない。(SHALL)
manifest が記録する拡張 bundle の版は、リリースタグの版と一致しなければならない。(SHALL)

#### Scenario: 一式の添付
- **WHEN** `spirits-v0.7.0` タグを push してリリースが作成される
- **THEN** manifest、拡張 bundle、それぞれの `.sha256` が添付され、manifest の拡張の版は `0.7.0` である

#### Scenario: 起動役と同じリリースから取得できる
- **WHEN** `spirits-v0.7.0` のリリースから manifest と bundle を取得する
- **THEN** 起動役の実行ファイルと同じタグの成果物が得られる

### Requirement: bundle へ埋め込む版
拡張 bundle のビルドは、manifest に記録する版を `SPIRITS_VERSION` として bundle に埋め込まなければならない。(SHALL)
埋め込まれた版は、起動ヘッダーの表示と、同梱スキルの版ディレクトリ名に使われる。(SHALL)

#### Scenario: 版が埋め込まれる
- **WHEN** 版 `0.7.0` で拡張 bundle をビルドする
- **THEN** bundle は `0.7.0` を埋め込み、開発用のフォールバック値を含まない

#### Scenario: 同梱スキルのディレクトリ名
- **WHEN** 埋め込み版 `0.7.0` の bundle をもつ managed 起動で同梱スキルを書き出す
- **THEN** 書き出し先は `<agent dir>/bundled-skills/0.7.0/` になる

### Requirement: リリースでの版の一致確認
リリース処理は、ビルドした拡張 bundle に埋め込まれた版と、タグから導出した `--version` の版が一致することを確認し、一致しない場合はリリースを公開してはならない。(MUST)

#### Scenario: 一致しない場合の非公開
- **WHEN** タグの版と bundle に埋め込んだ版が異なる状態でリリース処理が実行される
- **THEN** 確認手順が失敗し、リリースは公開されない

#### Scenario: 一致する場合
- **WHEN** タグの版と bundle に埋め込んだ版が一致する
- **THEN** 確認手順は成功し、後続の公開処理が進む

### Requirement: インストーラによる managed 一式の導入
インストーラは、起動役の実行ファイルを配置した後、同じリリースの manifest から managed の一式を取得し、検証して導入しなければならない。(SHALL)
導入は検証済みのバイナリを配置した後に実行し、配置済みの実行ファイルとテーマ資産を取り替えてはならない。(MUST)
managed の一式の取得または導入に失敗した場合、インストーラは理由と修復コマンド `spirits managed-pi repair`、および `SPIRITS_ROUTE=fork` で起動する方法を表示して非ゼロで終了しなければならない。(MUST)

#### Scenario: 同じリリースの導入
- **WHEN** `VERSION=0.7.0` を指定してインストーラを実行する
- **THEN** `spirits-v0.7.0` の manifest と bundle が使われ、`~/.spirits/managed-pi` に一式が導入される

#### Scenario: managed 導入失敗時の非ゼロ
- **WHEN** 実行ファイルの配置に成功したが managed の manifest の取得に失敗する
- **THEN** 終了コードは非ゼロになり、理由と `spirits managed-pi repair` と `SPIRITS_ROUTE=fork` が表示される

#### Scenario: 実行ファイルは保持される
- **WHEN** managed の導入に失敗する
- **THEN** 配置済みの実行ファイルとテーマ資産は検証済みの新しい内容のまま残る

## MODIFIED Requirements

### Requirement: コンパイル済み spirits の起動
システムは、コンパイル済み `spirits` の既定の起動経路で spirits 拡張を利用者による追加指定なしで読み込み、専用 Pi を起動しなければならない。(SHALL)
システムは、自己更新として処理する `update`、`spirits managed-pi`、`--version` / `-v` を除き、`spirits` に渡された CLI 引数を `--` なしでそのまま Pi の CLI 解釈へ渡さなければならない。(SHALL)
起動したセッションでは、モデルから `tsrepl` を他のツールと同じ経路で呼び出せなければならない。(SHALL)

#### Scenario: 引数なし起動
- **WHEN** コンパイル済み `spirits` を引数なしで起動する
- **THEN** Pi の通常の起動が始まり、セッションで `tsrepl` が有効なツールとして登録されている

#### Scenario: CLI 引数の透過
- **WHEN** `spirits --help` を実行する
- **THEN** Pi のヘルプが表示され、終了コード 0 で終わる

#### Scenario: Pi の引数の透過
- **WHEN** `spirits --continue` および `spirits --session <file>` を実行する
- **THEN** 引数を変換せずに Pi へ渡す

#### Scenario: 追加拡張の指定
- **WHEN** ツールを登録する拡張を指定して `spirits -e <拡張パス>` を実行する
- **THEN** 組み込み spirits 拡張のツールに加えて、指定した拡張が登録するツールもセッションで利用可能になる

### Requirement: 後段フェーズ機能への非依存
コンパイル用エントリとインストーラは、M3 以降の機能(rlm、Continual Harness、Phase 2)を import・参照してはならない。(MUST)
コンパイル用エントリは、「起動経路を選ぶ」責務、「spirits 拡張を既定ロードして Pi を起動する」責務、「自己更新として処理する `update` を自己更新へ振り分ける」責務だけを持ち、拡張内にどのツールが登録されているかを知ってはならない。(MUST)
インストーラは、バイナリの内部構成や同梱機能に依存してはならず、リリース成果物の名前とチェックサム、および `--version` の表示結果だけに依存しなければならない。(SHALL)

#### Scenario: 後段機能の非参照
- **WHEN** コンパイル用エントリとインストーラの参照を列挙する
- **THEN** rlm / harness / phase2 のモジュールやコマンドへの参照が存在しない

#### Scenario: 登録内容に依存しない起動
- **WHEN** コンパイル用エントリのソースを確認する
- **THEN** 登録済みツールの名前・一覧を参照する記述が存在しない
