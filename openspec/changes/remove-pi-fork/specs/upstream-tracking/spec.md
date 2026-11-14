# upstream-tracking Delta

## REMOVED Requirements

### Requirement: 上流リモートからの merge による取り込み
**Reason**: リポジトリから Pi のソースツリーが無くなり、上流 merge という取り込み方法が消えるため。
**Migration**: `host-upgrade` の「ホスト版の更新手順」に従う。

### Requirement: 上流追従手順の文書化
**Reason**: 上流 merge ではなく固定 artifact の差し替えになるため。
**Migration**: `docs/spirits-upstream-sync.md` を `docs/spirits-host-upgrade.md` に置き換える。

### Requirement: 取り込みのコミット構成
**Reason**: merge コミットという構成が無くなるため。
**Migration**: 版更新は 1 変更 = 1 コミットで行い、固定値と検証結果を同じ変更に含める。

### Requirement: 取り込み後の検証
**Reason**: 検証対象がソースの merge ではなくホスト artifact の差し替えになるため。
**Migration**: `host-upgrade` の「ホスト版の更新手順」と「公式 artifact での互換性実測」に従う。

### Requirement: Pi コアと root 設定の変更に対する spirits CI
**Reason**: `packages/` 配下のコアが無くなり、CI の対象が `packages/spirits` と root 構成だけになるため。
**Migration**: `spirits-ci.yml` の paths を `packages/spirits/**`、`scripts/**`、root 構成ファイルだけにする。

### Requirement: fork 差分の分離維持
**Reason**: Pi コアへの差分が 0 件になり、差分の分離という規律が不要になるため。
**Migration**: ホストへのソースパッチは禁止する。ギャップは拡張で代替するか削除する。

### Requirement: Pi コア差分の登録簿
**Reason**: `[spirits]` コア差分が無くなり、登録簿を維持する対象が消えるため。
**Migration**: `docs/spirits-core-diffs.md` を削除する。ホストへの差分は 0 件を維持する。

### Requirement: 取り込み時の登録簿との突き合わせ
**Reason**: 登録簿が無くなるため。
**Migration**: `host-upgrade` の「型ミラーの照合」と「公式 artifact での互換性実測」が、ホスト API の変化を検出する。