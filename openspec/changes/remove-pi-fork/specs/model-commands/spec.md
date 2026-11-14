# model-commands Delta

## REMOVED Requirements

### Requirement: /model は末尾の語を thinking レベルとロールとして解釈する
**Reason**: ホストの `/model` は role 語彙を持たず、フォークのコア差分で追加していたため。
**Migration**: セッションのモデル選択はホストの `/model`、thinking レベルはホストの `/thinking`、role のロックは `/spirits-role <role>` を使う。

### Requirement: /model はサポートされない thinking レベルを拒否する
**Reason**: ホストの `/model` の挙動であり、spirits が差し替えできないため。
**Migration**: ホストの `/model` と `/thinking` の既定の挙動を使う。

### Requirement: /model は完全一致しない場合に selector を経由する
**Reason**: ホストの `/model` の selector の挙動であり、フォーク差分ではないため。
**Migration**: ホストの `/model` の selector を使う。

### Requirement: /model は保存キーで既定として保存する
**Reason**: 保存キーと保存先はホストの `/model` と `/thinking` が持ち、フォーク差分ではないため。
**Migration**: セッションのモデルと thinking レベルの既定保存はホストの `/model` と `/thinking` を使う。

### Requirement: /thinking は保存キーで既定として保存する
**Reason**: ホストの `/thinking` の挙動であり、フォーク差分ではないため。
**Migration**: ホストの `/thinking` を使う。

### Requirement: 保存キーはコマンド以外の入力を変更しない
**Reason**: ホストの保存キーの挙動であり、フォーク差分ではないため。
**Migration**: ホストの保存キーの既定の挙動を使う。

### Requirement: 拡張機能が差し替えたエディタでも保存キーが働く
**Reason**: ホストのエディタと保存キーの挙動であり、フォーク差分ではないため。
**Migration**: ホストのエディタと保存キーの既定の挙動を使う。

### Requirement: /model の引数補完は 2 語目に thinking レベルとロールを出す
**Reason**: ホストの `/model` は role 語彙を持たず、フォークの補完差分は削除されるため。
**Migration**: ロールの設定は `/spirits-role` の補完を使う。ホストの `/model` の補完はホストの既定に従う。

### Requirement: /model の引数ヒントは thinking レベルとロールを示す
**Reason**: ホストの `/model` の引数ヒントはホストが決めるため。
**Migration**: ホストの `/model` の引数ヒントを使う。