# Spec Delta

## MODIFIED Requirements

### Requirement: code-mode プロンプトの適用
システムは、エージェント実行の開始前にシステムプロンプトへ `spirits` セクションを追加しなければならない。(SHALL)
セクションは次を含まなければならない。(SHALL)

- ツール選択の基準に沿って tsrepl を使うこと。基準は tsrepl の promptGuidelines と同じ 3 項目(bash は単発で出力をそのまま読む用途、分岐・繰り返し・出力の加工は tsrepl の TypeScript、使い捨てコードはセルで書き他言語のインラインコードとスクラッチスクリプトを bash から実行しない)とする
- `sh` で bash を呼ぶコード例と、同じ呼び出しを `tool("bash", ...)` で書くコード例、および `sh` が `tool("bash", ...)` と同じ結果を返すこと
- `rlm` の使いどころと深度上限があること
- `note` とスキル保存の判断基準(次のセッションでも役立つ事実か)と、子へ渡す情報は prompt に含めること
- Phase 1 のセル評価ルール(`return` / `out`、`use` の許可範囲)
- `tool()` で他のツールを呼ぶ使用例と、エラー扱いのツール結果でも構造化結果が返り終了コードを確認する必要があること

#### Scenario: ルートセッションへの適用
- **WHEN** エージェントを開始してシステムプロンプトを取得する
- **THEN** `spirits` セクションに `tsrepl`、`bash`、`return`、`rlm`、`note`、`スキル` が含まれ、tsrepl を唯一または最優先の実行面とする表現は含まれない

#### Scenario: ツール呼び出しの使用例の掲載
- **WHEN** エージェントを開始してシステムプロンプトを取得する
- **THEN** `spirits` セクションのコードブロックに、`sh(` を使う例と、`tool("bash"` を使う例と、bash 以外のツールを呼ぶ `tool(` の例が含まれ、`exit_code` の確認が含まれる

#### Scenario: 規則の文面の単一出典
- **WHEN** エージェントを開始してシステムプロンプトを取得し、登録された tsrepl ツールの promptGuidelines と比較する
- **THEN** `spirits` セクションのツール選択の基準は promptGuidelines の 3 項目と一字一句一致し、別の書き回しは含まれない

#### Scenario: 既存プロンプトの維持
- **WHEN** tsrepl と bash が有効なエージェントを開始してシステムプロンプトを取得する
- **THEN** Pi 既定のツール一覧のセクションは残り、bash の掲載と tsrepl の掲載が並んで含まれる。Pi 既定の規則のセクションも残り、ファイル操作を bash で行うよう促す既定の規則が消えていない
