# managed-pi Specification

## Purpose

公式 Pi の固定成果物と spirits 拡張 bundle を対応付けて導入し、通常の spirits 起動とは別の明示的な実験経路で起動できるようにする。既定経路、既存データ、Pi コアを変更せず、専用経路の失敗を旧経路への暗黙の切り替えで隠さない。

## Requirements

### Requirement: 実験経路の明示選択
システムは、専用 Pi を使う実験経路を、利用者が明示的に指定した場合だけ起動しなければならない。(SHALL)
明示的な指定がない通常の `spirits` 起動、`spirits update`、インストーラ、既定の保存先、既定の Pi 実体を変更してはならない。(MUST)
実験経路は、システムの `pi`、PATH 上の `pi`、既定の compiled spirits を暗黙に使用してはならない。(MUST)
専用 Pi が未導入、破損、非対応の場合、実験経路は理由と復旧手順を表示して非ゼロで終了し、旧経路へ黙って切り替えてはならない。(MUST)
専用経路は、起動前に実行プラットフォームが対応表の platform と一致することを確認し、一致しない場合は Pi を spawn せず理由を表示して非ゼロで終了しなければならない。(MUST)

#### Scenario: 明示指定による起動
- **WHEN** 利用者が専用 Pi の導入後に `spirits managed-pi -- --help` を実行する
- **THEN** 絶対パスで管理された専用 Pi が起動し、システムの `pi` は使用されない

#### Scenario: 明示指定なしの通常起動
- **WHEN** 利用者が `spirits` を引数なしで実行する
- **THEN** 既存の compiled spirits の起動経路が使われ、専用 Pi の有無は起動結果に影響しない

#### Scenario: 未導入時の失敗
- **WHEN** 専用 Pi を導入せずに `spirits managed-pi` を実行する
- **THEN** 専用 Pi が未導入である旨と導入コマンドが表示され、終了コードは非ゼロになり、システムの `pi` は起動しない

#### Scenario: 破損時の非 fallback
- **WHEN** 管理された専用 Pi の実行ファイルが改変され、記録されたチェックサムと一致しない状態で `spirits managed-pi` を実行する
- **THEN** 整合性検証の失敗が表示され、終了コードは非ゼロになり、通常の spirits 起動へ切り替わらない

#### Scenario: 非対応プラットフォーム
- **WHEN** 対応表が `linux-x64` の専用 Pi を別のプラットフォームで起動しようとする
- **THEN** 非対応である旨と復旧手順が表示され、終了コードは非ゼロになり、Pi は spawn されない

### Requirement: 専用成果物の対応付けと導入
システムは、専用 Pi の版、Pi artifact のチェックサム、spirits 拡張 bundle の版とチェックサム、必要なアセット、対象プラットフォームを 1 つの対応表として扱わなければならない。(SHALL)
導入は、実行前にすべての成果物の取得元とチェックサムを検証し、1 つでも不一致または欠落があれば何も配置してはならない。(MUST)
導入先は通常の `~/.spirits/bin` および `~/.spirits/agent` のファイルを置換してはならない。(MUST)

#### Scenario: 対応する組の導入
- **WHEN** 対応表に記録された Pi artifact、拡張 bundle、アセットをすべて取得でき、チェックサムが一致する
- **THEN** 専用経路用の領域に成果物が配置され、導入が成功した旨と Pi と拡張の版が表示される

#### Scenario: チェックサム不一致
- **WHEN** 拡張 bundle のチェックサムが対応表と一致しない
- **THEN** 配置は行われず、既存の導入済み成果物は変更されず、終了コードは非ゼロになる

#### Scenario: 組み合わせの不一致
- **WHEN** 対応表に記録されていない Pi の版を指定して導入する
- **THEN** 未対応の組み合わせである旨が表示され、成果物は配置されない

#### Scenario: 通常配布物の維持
- **WHEN** 専用 Pi を導入する
- **THEN** `~/.spirits/bin/spirits`、`~/.spirits/bin/theme/`、既存の `spirits update` の動作は変更されない

### Requirement: 明示的な更新と復旧
システムは、専用 Pi の更新を明示的な更新操作でのみ行い、実験経路の起動時に最新版の確認や自動更新を行ってはならない。(MUST)
更新に失敗した場合、更新前の検証済み成果物を起動可能なまま残さなければならない。(SHALL)
再導入は、既存の専用経路用成果物が破損または欠落している場合に、対応表の同じ組へ復旧できなければならない。(SHALL)

#### Scenario: 起動時に更新しない
- **WHEN** 専用 Pi の新しい版が公開された後に `spirits managed-pi` を起動する
- **THEN** ネットワークによる版の確認や自動更新は発生せず、導入済みの版で起動する

#### Scenario: 明示更新
- **WHEN** 利用者が `spirits managed-pi update` を実行し、新しい対応表の取得と検証に成功する
- **THEN** 専用 Pi と拡張 bundle が対応する組に置き換わり、次回の実験経路の起動から新しい組が使われる

#### Scenario: 更新失敗時の維持
- **WHEN** 更新の途中でチェックサム検証または配置が失敗する
- **THEN** 終了コードは非ゼロになり、更新前の専用 Pi と拡張 bundle はそのまま起動できる

#### Scenario: 破損からの復旧
- **WHEN** 専用経路用の拡張 bundle が欠落している状態で同じ版を再導入する
- **THEN** 対応表の検証済み bundle が再配置され、実験経路が再び起動できる

### Requirement: 起動前の identity と保存先の確定
システムは、`--help`、`--version` を含む Pi の実行前に、専用 Pi のアプリ名を spirits に、保存先を spirits の agent dir に確定しなければならない。(SHALL)
明示された `SPIRITS_CODING_AGENT_DIR` を保存先として尊重し、未指定時は `~/.spirits/agent` を使わなければならない。(SHALL)
`PI_CODING_AGENT_DIR` を保存先の指定として読んではならない。(MUST)
`PI_PACKAGE_DIR` は専用 Pi の package dir に固定するか除去し、外部の値で app 名、版、アセットを差し替えられてはならない。(MUST)

#### Scenario: 保存先の既定値
- **WHEN** `SPIRITS_CODING_AGENT_DIR` を設定せずに `spirits managed-pi --help` を実行する
- **THEN** 専用 Pi の表示は spirits になり、agent dir は `~/.spirits/agent` として解決される

#### Scenario: 明示された保存先
- **WHEN** `SPIRITS_CODING_AGENT_DIR=/tmp/managed-agent` を設定して `spirits managed-pi` を起動する
- **THEN** 設定・認証・セッションの保存先は `/tmp/managed-agent` になり、`~/.spirits/agent` は使われない

#### Scenario: 旧環境変数の無視
- **WHEN** `PI_CODING_AGENT_DIR=/tmp/old-agent` を設定して `spirits managed-pi` を起動する
- **THEN** 保存先は `/tmp/old-agent` ではなく、`SPIRITS_CODING_AGENT_DIR` または `~/.spirits/agent` になる

#### Scenario: package dir の差し替え防止
- **WHEN** `PI_PACKAGE_DIR` に別の package.json を持つディレクトリを指定して `spirits managed-pi --version` を実行する
- **THEN** app 名、版、アセットは専用 Pi の対応表の値のままで、指定した package の値にはならない

### Requirement: 必要な環境変数の保持
システムは、identity と保存先の確定のために干渉する変数だけを処理し、API キー、proxy、認証情報など Pi の実行に必要な環境変数を一律に削除してはならない。(MUST)
作業ディレクトリは Pi の project 探索にだけ使い、システム Pi の agent dir や設定を読んではならない。(MUST)

#### Scenario: API キーと proxy の保持
- **WHEN** `ANTHROPIC_API_KEY` と `HTTPS_PROXY` を設定して `spirits managed-pi` を起動する
- **THEN** 専用 Pi のプロセス環境に両方の値が引き継がれる

#### Scenario: システム Pi の設定を読まない
- **WHEN** 実 HOME に `~/.pi/agent/settings.json` があり、隔離した HOME で `spirits managed-pi --help` を実行する
- **THEN** 専用経路は実 HOME の `~/.pi` を読み書きせず、隔離した保存先だけを使う

### Requirement: 拡張 bundle とホスト SDK の一体性
システムは、専用 Pi に読み込む spirits 拡張を、Markdown などのアセットを文字列として埋め込んだ事前 bundle として配布しなければならない。(SHALL)
bundle は Pi が提供する host module を external に保ち、Pi SDK、TUI、typebox の別実体を内包してはならない。(MUST)
専用 Pi 上で rlm の子セッションを生成する場合、親と同じホスト実体の SDK を使わなければならない。(SHALL)

#### Scenario: Markdown アセットの保持
- **WHEN** 専用 Pi で bundle 済み拡張をロードし、同梱スキルを書き出す
- **THEN** 書き出された `SKILL.md` は raw Markdown であり、HTML 化された内容ではない

#### Scenario: host module の同一性
- **WHEN** 専用 Pi で bundle 済み拡張をロードし、拡張が参照する Pi の版を確認する
- **THEN** 参照される版は専用 Pi artifact の版と一致し、bundle 内の別の Pi SDK の版にはならない

### Requirement: 不足 API の限定互換モード
システムは、専用 Pi のホストに spirits が必要とする任意 API が無い場合、拡張全体のロードを失敗させず、文書化された限定互換モードでロードしなければならない。(SHALL)
限定互換モードでは、利用できない機能を起動時に明示し、利用可能であるかのように表示してはならない。(MUST)
既存の通常起動で同じ API が利用できる場合、限定互換モードを使ってはならない。(MUST)

#### Scenario: role API が無い場合のロード
- **WHEN** 専用 Pi のホストに role 登録 API が無い状態で `spirits managed-pi` を起動する
- **THEN** spirits 拡張はロードされ、`tsrepl` と TODO と harness のツールが登録され、role 関連機能が制限される旨が表示される

#### Scenario: role API がある場合の通常動作
- **WHEN** role 登録 API を持つホストで spirits 拡張を起動する
- **THEN** 限定互換モードは使われず、既存の role 登録と `/model` 連携の動作が使われる

### Requirement: 既存データの非破壊な利用
システムは、専用経路の既定の保存先として既存の `~/.spirits/agent` を使い、利用者の手作業による移動や認証の再設定を要求してはならない。(SHALL)
起動時に自動のデータ移行、破壊的な変換、既存ファイルの削除を行ってはならない。(MUST)
読み取り互換と書き込み互換を区別し、書き込み互換が未確認である間は、変換が必要な操作を互換性テストで検出したら aborted として理由付きで記録し、成功として扱ってはならない。(MUST)
起動 wrapper はユーザーデータを書き換えず、Pi 内部の保存を中断する経路を持たない。製品経路での変換検出と中止は後続 change の対象とし、この change では実装済みであるかのように扱ってはならない。(MUST)

#### Scenario: 既存設定の読み取り
- **WHEN** 既存の `~/.spirits/agent` に settings、auth、sessions、extensions がある状態で専用経路を起動する
- **THEN** 専用経路は同じ保存先を使い、利用者に手動移動や認証の再設定を要求しない

#### Scenario: 自動移行をしない
- **WHEN** 専用経路を初めて起動する
- **THEN** 既存データの自動変換、バックアップの自動作成、旧ディレクトリの削除は行われない

#### Scenario: 変換が必要な操作の記録
- **WHEN** 互換性テストの書き込みが既存データの破壊的な変換を必要とする
- **THEN** その操作は aborted として記録され、変換が必要である旨とフィクスチャが変更されていないことが確認される

### Requirement: 専用経路の非依存性
専用経路の起動と互換性テストは、M3 以降の機能(rlm、Continual Harness、Phase 2)の存在を前提に、通常起動や配布の既定経路を変更してはならない。(MUST)
専用経路の起動は、Pi の更新確認、既定経路の自己更新、テレメトリの既定動作を変更してはならない。(MUST)

#### Scenario: 既定経路の非変更
- **WHEN** 専用経路を導入した後に通常の `spirits` と `spirits update` を実行する
- **THEN** それぞれの出力、保存先、終了コードは専用経路の導入前と同じである

#### Scenario: 更新通知の非変更
- **WHEN** 専用経路を起動する
- **THEN** 既存の `PI_SKIP_VERSION_CHECK` とテレメトリの既定値が通常起動と異なる扱いを受けない
