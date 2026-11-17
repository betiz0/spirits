# model-role-badge Delta

## REMOVED Requirements

### Requirement: ロールバッジの表記
**Reason**: footer の `[role]` バッジはフォークのコア差分で実装されており、ホストは footer の右側表示を変えられないため。
**Migration**: role の表示は `managed-commands` の「role badge は拡張の status 行に出す」を使う。

### Requirement: バッジの位置
**Reason**: ホストの footer の右側表示を spirits が制御できないため。
**Migration**: 拡張の status 行に表示する。ホストのモデル表示の位置とは共有しない。

### Requirement: 幅不足時の優先順位
**Reason**: ホストの footer の幅処理を spirits が制御できないため。
**Migration**: 拡張の status 行の表示に一本化する。

### Requirement: バッジの更新タイミング
**Reason**: ホストの footer への描画経路が無いため。
**Migration**: `managed-commands` の「role badge は拡張の status 行に出す」に従う。