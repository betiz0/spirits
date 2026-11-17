# session-clear Delta

## REMOVED Requirements

### Requirement: /clear は会話を LLM 文脈とチャット表示から外す
**Reason**: `/clear` はフォークのコア差分で実装されており、ホストの `/clear` は同じ挙動を持たないため。
**Migration**: `managed-commands` の「`/spirits-clear` は区切りより前の会話を LLM 文脈から外す」を使う。チャット表示はホストの `/clear` の挙動に従う。

### Requirement: /clear は以前の会話を削除しない
**Reason**: セッションファイルの扱いはホストの `/clear` の挙動に従うため。
**Migration**: 会話の区切りは `/spirits-clear` が session に記録する。ホストの `/clear` はホストの既定に従う。

### Requirement: /clear は同じセッションファイルと ID を使い続ける
**Reason**: セッション ID とファイルの扱いはホストの `/clear` の挙動に従うため。
**Migration**: `/spirits-clear` は session ID とファイルを変えない。ホストの `/clear` はホストの既定に従う。

### Requirement: /clear は拡張がセッションに保存した状態を保持する
**Reason**: ホストの `/clear` が拡張の entry をどう扱うかはホストの設計に従うため。
**Migration**: `/spirits-clear` は TODO、goal、memory などの拡張状態を保持する。

### Requirement: /clear はモデル設定を保持する
**Reason**: ホストの `/clear` のモデル設定の扱いはホストに従うため。
**Migration**: `/spirits-clear` はモデルと thinking レベルを変えない。

### Requirement: /clear はコンテキスト使用量を 0 にする
**Reason**: ホストの `/clear` はコンテキスト使用量の表示を 0 にしないため。
**Migration**: `/spirits-clear` の使用量の推算の扱いは `managed-commands` の「自動 compaction はクリア済みの会話を文脈に戻さない」が記録する。

### Requirement: 応答中と compaction 中の /clear は拒否される
**Reason**: ホストの `/clear` の同時実行の扱いはホストに従うため。
**Migration**: `/spirits-clear` はホストの応答・compaction の進行中はホストの既定に従う。

### Requirement: /clear は拡張の実行時状態を破棄しない
**Reason**: ホストの `/clear` は拡張の実行時状態の扱いを保証しないため。
**Migration**: `/spirits-clear` は拡張の実行時状態を保持する。