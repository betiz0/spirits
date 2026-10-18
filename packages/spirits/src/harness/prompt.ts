/**
 * The code-mode system prompt injected as the `spirits` section.
 *
 * The built-in prompt lives here as a TypeScript constant so it ships inside the compiled
 * binary without asset loading. An override at `<agentDir>/prompts/spirits/code-mode.md`
 * (written by the prompt-set codemode tool) wins when it is readable and not blank.
 *
 * The prompt lives in a `prompts/spirits/` subdirectory, not directly under `prompts/`,
 * because pi treats top-level `prompts/*.md` files as `/` prompt templates.
 */

import { readFile } from "node:fs/promises";
import {
	TOOL_NAME_PROMPT_SET,
	TOOL_NAME_SKILL_DELETE,
	TOOL_NAME_SKILL_LIST,
	TOOL_NAME_SKILL_SAVE,
} from "../constants.ts";
import { TSREPL_PROMPT_GUIDELINES } from "../tools.ts";
import { promptOverridePath } from "./paths.ts";

/** Built-in code-mode prompt. Not exported: resolution goes through `resolveCodeModePrompt`. */
const DEFAULT_CODE_MODE_PROMPT = [
	"## spirits code-mode",
	// One copy of the rule: the same bullets pi lists in `<rules>` as the tsrepl guidelines.
	`- ツール選択の基準: ${TSREPL_PROMPT_GUIDELINES.join(" / ")}`,
	"- セルをまたいで残るのは `globalThis` への代入だけで、`const` / `let` / `function` はセル内に閉じる。値を返したセルの値は次のセルで `_` として読める。",
	"- `tool()` はエラー扱いの結果でも、そのツールが `outputSchema` を宣言していれば構造化結果を返す。bash の非ゼロ終了は例外ではなく `exit_code` に乗るため、成否は `exit_code` で確認する。",
	"- 使用例(`tool(\"bash\", ...)` の結果を加工して、値は小さく返す):",
	"```ts",
	"// 検索: 先頭 10 行だけを返す(0 件でも exit_code 1 で例外にならない)",
	'const hits = await tool("bash", { command: "rg -n TODO src" });',
	"return { code: hits.exit_code, lines: hits.output.split(\"\\n\").slice(0, 10) };",
	"",
	'// JSON: 必要なキーだけ読む',
	'const pkg = await tool("bash", { command: "cat package.json" });',
	"return { code: pkg.exit_code, version: JSON.parse(pkg.output).version };",
	"",
	"// テスト: 加工はセルの中で行う。パイプに切らせた末尾の exit_code は末尾コマンドのものになる",
	'const run = await tool("bash", { command: "bun test 2>&1" });',
	"const failed = run.output.split(\"\\n\").filter((line) => line.includes(\"(fail)\"));",
	"return { code: run.exit_code, failed: failed.slice(0, 20) };",
	"```",
	"- セルの値は `return <式>` または `out(<式>)` で返し、複数行の出力は `print(...)` を使います。",
	"- `use()` で import できるのは `node:` / `bun:` の組込と、セッション cwd 配下の `./` / `../` 相対パスだけです。",
	"- 文脈量の多い調査や独立した実装は `rlm(prompt)` で子エージェントへ委譲します。使いどころ、深度上限、ツール呼び出し上限、直列化、timeout の注意は tsrepl のツール説明の `rlm` の項を参照してください(上限値はここに書きません)。",
	"- 子セッションにはメモリ要約・スキル・この code-mode プロンプト・`goal` / `note` は自動で渡りません。子に必要な情報は `rlm` の prompt に含めてください。",
	"- 次のセッションでも役立つ事実は `note(text)` でメモリへ残します。一度きりの出力や探索ログは書かず、再利用できる知識に絞ります。",
	`- 再利用できる手順はスキルとして保存します。基準は「次のセッションの自分が同じ手順を再発見せずに使えるか」です。保存・一覧・削除は codemode ツール ${TOOL_NAME_SKILL_SAVE} / ${TOOL_NAME_SKILL_LIST} / ${TOOL_NAME_SKILL_DELETE} を \`await tool(name, args)\` 経由で呼びます。スキルの変更は次のセッションまたは \`/reload\` から有効になります。`,
	`- この code-mode プロンプト自体を更新する場合は ${TOOL_NAME_PROMPT_SET}({ content }) を使います。`,
].join("\n");

/**
 * Resolve the effective code-mode prompt: the readable, non-blank override when present,
 * otherwise the built-in default. Read failures fall back without surfacing an error.
 */
export async function resolveCodeModePrompt(agentDir: string): Promise<string> {
	try {
		const content = await readFile(promptOverridePath(agentDir), "utf8");
		if (content.trim() !== "") {
			return content;
		}
	} catch {
		// Missing or unreadable override: use the built-in prompt.
	}
	return DEFAULT_CODE_MODE_PROMPT;
}
