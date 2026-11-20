# Spec Delta

## MODIFIED Requirements

### Requirement: code-mode プロンプトの適用
システムは、エージェント実行の開始前にシステムプロンプトへ `spirits` セクションを追加しなければならない。(SHALL)
セクションは次を含まなければならない。(SHALL)

- ツール選択の基準に沿って tsrepl を使うこと。基準は tsrepl の promptGuidelines と同じ 4 項目(ファイルの読み書きは read / edit / write、bash は単発で出力を自分で読む用途、出力をコードで扱う処理と使い捨てコードは tsrepl の TypeScript、python は例外なく実行しない)とする
- `sh` で bash を呼ぶコード例と、同じ呼び出しを `tool("bash", ...)` で書くコード例、および `sh` が `tool("bash", ...)` と同じ結果を返すこと
- `rlm` の使いどころと深度上限があること
- `note` とスキル保存の判断基準(次のセッションでも役立つ事実か)と、子へ渡す情報は prompt に含めること
- Phase 1 のセル評価ルール(`return` / `out`、`use` の許可範囲と `await use(...)` の書き方)
- `tool()` で他のツールを呼ぶ使用例と、エラー扱いのツール結果でも構造化結果が返り終了コードを確認する必要があること

コード例は、ファイルの内容を `sh` や `tool("bash", ...)` 経由の `cat` で読む例と、python を実行する例を含んではならない。(MUST)

#### Scenario: ルートセッションへの適用
- **WHEN** エージェントを開始してシステムプロンプトを取得する
- **THEN** `spirits` セクションに `tsrepl`、`bash`、`return`、`rlm`、`note`、`スキル` が含まれ、tsrepl を唯一または最優先の実行面とする表現は含まれない

#### Scenario: ツール呼び出しの使用例の掲載
- **WHEN** エージェントを開始してシステムプロンプトを取得する
- **THEN** `spirits` セクションのコードブロックに、`sh(` を使う例と、`tool("bash"` を使う例と、bash 以外のツールを呼ぶ `tool(` の例が含まれ、`exit_code` の確認が含まれる

#### Scenario: use の書き方の掲載
- **WHEN** エージェントを開始してシステムプロンプトを取得する
- **THEN** `spirits` セクションに `await use("node:` が含まれる

#### Scenario: ファイルを sh で読む例と python の例を載せない
- **WHEN** エージェントを開始してシステムプロンプトを取得する
- **THEN** `spirits` セクションのコードブロックに `sh("cat ` と `python` は含まれない

#### Scenario: 規則の文面の単一出典
- **WHEN** エージェントを開始してシステムプロンプトを取得し、登録された tsrepl ツールの promptGuidelines と比較する
- **THEN** `spirits` セクションのツール選択の基準は promptGuidelines の 4 項目と一字一句一致し、別の書き回しは含まれない

#### Scenario: 既存プロンプトの維持
- **WHEN** tsrepl と bash が有効なエージェントを開始してシステムプロンプトを取得する
- **THEN** Pi 既定のツール一覧のセクションは残り、bash の掲載と tsrepl の掲載が並んで含まれる。Pi 既定の規則のセクションも残り、ファイル操作を bash で行うよう促す既定の規則が消えていない
