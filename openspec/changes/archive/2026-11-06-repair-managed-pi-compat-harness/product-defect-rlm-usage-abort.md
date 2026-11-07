# 製品側確認待ち事項: rlm 子の最中に中断すると `rlm_usage` が残らない

> **訂正(2026-11-06)**: この文書の結論は誤り。`rlm_usage` は残っている。ランナーが `agent_settled` の 1 回読みで
> 判定していたため見逃していた。子のリクエストが閉じた後の読みでは `customType: "rlm_usage"` のエントリが
> 1 件(`outcome: "aborted"`)現れ、公式実行の `rlm child abort` は `confirmed` になった。訂正の根拠と再実行記録は
> [verify2-rerun.md](verify2-rerun.md)。以下の再現条件・証拠・切り分けの残課題は当時の記録としてそのまま残す。
> 製品課題として残るのは 1 点だけにして、優先度を低いバックログに落とす。読み取りタイミングを正したとしても、中断した呼び出し元に
> `rlm_usage` が戻るより先にセルの AbortError が返る(= 記録が親の応答より後に着く)という順序の問題である。もっとも
> 製品内に `rlm_usage` の読み手は無く、現在の fork route(`~/.spirits/bin/spirits` 0.6.0)でも同じ順序になる
> ことが実測で分かったので、移行を止める根拠にはしない。
>
> `outcome` が `entry.data.outcome` にしか無い点は製品課題ではない。`pi.appendEntry(customType, data)` は
> `CustomEntry`(`{ type: "custom", customType, data }`、`packages/coding-agent/src/core/session-manager.ts`)
> を追記する標準的な形であり、`entry.outcome` を読むランナー側の計測が誤っていた。読み方は
> `scripts/managed-pi-compat/rlm.ts` の `rlmUsageOutcome` で修正済みで、製品側の変更是不要。

互換性ランナーの公式実行で判明した、製品側の挙動として報告する事項。この change の実装範囲ではないため、別 change 候補として扱う。

## 結論

専用 Pi 上で rlm の子セッションが実行中に親の呼び出しを中断すると、中断自体はセルに届くが、セッションに中断を示す `rlm_usage` エントリが残らない。完了時の `rlm_usage` は同じ経路で観測できるため、観測手段の不足ではなく、中断経路での記録欠落と疑われる。

## 再現条件

- 公式 Pi 1.5.0(`pi-linux-x64.tar.gz`、sha256 `df870ba0e344cb7b3358d8d8f19397b8b8d225a8669784736ad68a5c2169d53b`、展開後実行ファイル sha256 `61a84400938da652ed69aac9c1ad2ca23af3c9bd8cc2f46ce571ed84ae6a35e5`)
- 対象 commit `a0bd389c449030dc60e9dd3e72bc7a6f58679ae9` からビルドした拡張 bundle(sha256 `51f306d132b35b1c34bebe56f157c14e5e88348366bcb6d041585d7354e28f29`)
- fake provider をプログラム登録した拡張を `-e` で読み込み、親セッションのモデルを物理モデル `compat-fake/fake-model` に `set_model` する
- 親セルは `return await rlm("child task")`
- fake provider は親のリクエストには `tsrepl` のツール呼び出しで、子のリクエストには 8 秒の遅延あとにテキストで応じる(子は `rlm` を再帰しない)
- `tool_execution_start`(toolName `tsrepl`) を確認してから 1.5 秒後、RPC で `{"type":"abort"}` を送り、`agent_settled` まで待つ
- 読み取りは 2 経路。RPC の `get_entries` と、probe 拡張が `agent_settled` で書き出す `customType === "rlm_usage"` エントリ

実行コマンド:

```sh
bun scripts/managed-pi-compat/run.ts --mode official \
  --artifact-root <staged-official-artifact-root> \
  --bundle <target-commit-bundle.js> \
  --commit <sha> \
  --out <tmp>/result.json
```

## 証拠

同じ official 実行(`mode: "official"`、`runnerCompleted: false`、`compatibilityMet: true`)の中身。

| 項目 | 状態 | 内容 |
| --- | --- | --- |
| `rlm child creation` | `confirmed` | 子のセッションは作成される |
| `rlm child answer` | `confirmed` | 完了した子は最終回答を返す |
| `rlm child usage` | `confirmed` | 完了した子の `rlm_usage` は観測される |
| `rlm child abort` | `not-run` | 「中断は発火させたが `rlm_usage` の中断記録が観測できない」 |

`rlm child abort` 項目の `data` に中断の到達と記録の欠落が並ぶ。

```json
{
  "cellText": "[error]\nAbortError: 呼び出し元の中断により実行を打ち切りました。\n部分実行により永続コンテキストが不整合になっている可能性があります。\n`reset: true` でコンテキストを初期化できます。\n提案: reset: true で再生成するか、timeout を増やして再実行してください。",
  "cellIsError": true,
  "rlmUsageEntries": 0
}
```

`logs` の `rlm child abort` エントリに起動コマンドと上記 stdout が入る。結果 JSON と要約はリポジトリ外に保管した(保管方針は `docs/spirits-managed-pi.md` の「詳細ログ・JSON の保管と再実行」)。今回の測定ファイルは `/tmp/pi-compat-evidence/official-result.json` と `/tmp/pi-compat-evidence/official-summary.md`( `--out /tmp/official4/result.json` の隣に出力されたもの)。一時領域なので、上記の pi 版・artifact SHA・bundle SHA・対象 commit が同一実行の指紋として残る。リポジトリへ要約を残すのは対象結果を選んで記録する別操作とする。

## 影響

- 中断された rlm 子セッションの使用量・成否がセッションから復元できない。完了時の `rlm_usage` を前提に集計・表示する箇所は、中断について何も表示できない。
- 「部分実行により永続コンテキストが不整合になっている可能性があります」というセル側の案内に対して、どの子でどこまで進んだかを示す記録が残らない。
- 互換性判定への影響はない。`rlm child abort` は測定できない項目として `REQUIRED_OBSERVATIONS` に含めていないため、`compatibilityMet` を止める要因にはならない。

## 切り分けの残課題

- 子の応答を待っている途中で abort されると、呼び出し元が `rlm_usage` の書き込み前に抜けている可能性。完了経路では同じエントリが書かれている。
- 親側の abort 処理が custom entry を append する前に resolve しているなら、中断時だけ書き込み順序が逆転する。
- 確認には製品側で `rlm_usage` を書き込む箇所と中断経路の順序を追う。ランナー側の計測追加では決着しない。
