# Proposal

## Why

対話 TUI でモデルと thinking レベルを既定として保存するには、`/model` の selector でモデルを選んで ctrl+s を押し、続けて `/thinking` の selector でレベルを選んで ctrl+s を押す、という 2 回の selector 操作が必要になる。`/model <provider/model>` は完全一致すればセッション内で即時に切り替わるが、thinking レベルを同時に指定する手段も、既定として保存する手段もない。

日常的に使うモデルと thinking レベルの組を 1 行で指定し、そのまま既定として保存できるようにする。

## What Changes

- `/model <provider/model> <level>` で、モデルと thinking レベルを同時に設定する。引数の最後の語が thinking レベル名(off / minimal / low / medium / high / xhigh / max、大文字小文字を区別しない)のときだけ、その語を thinking レベルとして扱う。それ以外は従来どおり引数全体をモデルの検索語として扱う。
- 指定した thinking レベルを対象モデルがサポートしない場合は、エラーを表示し、モデルも thinking レベルも変更しない。
- モデルが完全一致しない場合は、従来どおり検索語で selector を開く。thinking レベルの指定がある場合は、selector で選んだモデルの後に適用する。
- 入力欄で `/model ...` を入力して既存の `app.models.save` キー(既定 ctrl+s)を押すと、Enter と同じ処理に加えて、モデルを既定モデルとして、thinking レベルをグローバル既定として保存する。selector に移った場合も、この保存指定を selector での選択に引き継ぐ。
- 入力欄で `/thinking <level>` を入力して既存の `app.thinking.save` キー(既定 ctrl+s)を押すと、thinking レベルを設定してグローバル既定として保存する。
- `/model` の引数補完で、1 語目がモデルに完全一致し、その後に空白がある場合は、2 語目の候補として対象モデルがサポートする thinking レベルを出す。
- `/model` の引数ヒントを `<provider/model> [level]` にする。
- `docs/models.md` と `docs/usage.md` に、引数での thinking 指定と保存キーを追記する。

## Capabilities

### New Capabilities

- `model-commands`: 対話 TUI の `/model` と `/thinking` スラッシュコマンドの引数解釈、即時適用、既定としての保存、引数補完

### Modified Capabilities

なし

## Impact

- **Pi 上流コアへの差分**: あり。すべて `packages/coding-agent` 内で、`packages/tui` は変更しない。`[spirits]` プレフィックスの独立コミット 1 つに分離する。
  - `src/modes/interactive/components/custom-editor.ts`: 入力キーを app action より前に横取りできるフックを 1 つ追加する。コマンドの知識は持たせない。
  - `src/modes/interactive/interactive-mode.ts`: `/model` の引数解釈と保存指定、`/thinking` の保存指定、保存キーの横取り、拡張機能が差し替えたエディタへのフックのコピー、`/model` の 2 語目の補完。
  - `src/core/slash-commands.ts`: `/model` の `argumentHint` を変更する。
  - `docs/models.md`、`docs/usage.md`: 使い方の追記。
  - 新規ファイル `src/modes/interactive/model-command-args.ts`: `/model` の引数解析と、2 語目の thinking レベル候補の生成。
  - 新規テスト `test/model-command-args.test.ts`、`test/interactive-mode-model-command.test.ts`、`test/custom-editor-submit-shortcut.test.ts`。上流追従時の `./test.sh` で実行されるため、merge で変更が失われた場合に検知できる。
- **Spirits 拡張**: 変更なし
- **API**: `CustomEditor` に公開フィールドを 1 つ追加する。`Editor`(`packages/tui`)の `onSubmit` のシグネチャは変えない。
- **キーバインド**: 新しいキーバインド ID は追加しない。既存の `app.models.save` / `app.thinking.save` を入力欄でも使う。入力欄の ctrl+s は現在どの操作にも割り当てられていない。
- **振る舞いの変化**: `/model sonnet high` のように最後の語が thinking レベル名の場合、従来は `sonnet high` 全体を検索語にしていたが、`sonnet` を検索語、`high` を thinking レベルとして扱うようになる。
- **依存関係**: 追加なし
