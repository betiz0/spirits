/**
 * Model-facing guidance for the continual-harness host functions.
 *
 * `createTsreplTool` concatenates each `HostFnEntry.description` into the tsrepl tool
 * description, so this text reaches the model even after the prompt-set codemode tool
 * the `spirits` prompt section. Tool names are interpolated from the Layer 2 constants
 * so the guidance cannot drift from the registered codemode tools.
 */

import {
	TOOL_NAME_PROMPT_SET,
	TOOL_NAME_SKILL_DELETE,
	TOOL_NAME_SKILL_LIST,
	TOOL_NAME_SKILL_SAVE,
} from "../constants.ts";

/** Separator between guidance lines. */
const LINE_SEPARATOR = "\n";

/** Goal guidance: get and set. */
const GOAL_HEADING = "## goal: ゴールの取得と設定";
const GOAL_GET_LINE = "- `goal()` は現在のブランチのゴールを返します。明示設定が無ければ、そのブランチの最初のユーザー指示を返します。";
const GOAL_SET_LINE = "- `goal(text)` はゴールを明示設定し、以降の `goal()` で返します。";

/** Note guidance: append semantics plus the codemode tool surface. */
const NOTE_HEADING = "## note: メモリへの追記とハーネス操作";
const NOTE_APPEND_LINE = "- `note(text)` はセッションを跨いで役立つ事実をメモリへ 1 行で追記します。`text` 内の改行は半角スペース 1 つに正規化されます。";
const TOOL_INTRO_LINE = "- スキルと code-mode プロンプトは `await tool(name, args)` で操作します。";

/** One line per codemode tool; the tool names come from the Layer 2 constants. */
const TOOL_SKILL_SAVE_LINE = `  - \`${TOOL_NAME_SKILL_SAVE}\`: \`{ name, description, body }\``;
const TOOL_SKILL_LIST_LINE = `  - \`${TOOL_NAME_SKILL_LIST}\`: \`{}\``;
const TOOL_SKILL_DELETE_LINE = `  - \`${TOOL_NAME_SKILL_DELETE}\`: \`{ name }\``;
const TOOL_PROMPT_SET_LINE = `  - \`${TOOL_NAME_PROMPT_SET}\`: \`{ content }\``;
const RELOAD_LINE = "- スキルの変更は次のセッションまたは `/reload` から有効になります。";

/** Guidance for the `goal` host function (get and set). */
export function buildGoalGuidance(): string {
	return [GOAL_HEADING, GOAL_GET_LINE, GOAL_SET_LINE].join(LINE_SEPARATOR);
}

/** Guidance for the `note` host function, including the codemode tool surface. */
export function buildNoteGuidance(): string {
	return [
		NOTE_HEADING,
		NOTE_APPEND_LINE,
		TOOL_INTRO_LINE,
		TOOL_SKILL_SAVE_LINE,
		TOOL_SKILL_LIST_LINE,
		TOOL_SKILL_DELETE_LINE,
		TOOL_PROMPT_SET_LINE,
		RELOAD_LINE,
	].join(LINE_SEPARATOR);
}
