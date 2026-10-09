/**
 * codemode tool definitions for the continual harness.
 *
 * These tools are not declared to the model: `exposure: "codemode"` keeps them out of the
 * system prompt and the enabled-tool set, and cells reach them through `tool(name, args)`.
 * The names are the external contract (Layer 2 constants) and are also interpolated into
 * the `goal` / `note` guidance so the model can discover them. Labels, descriptions, and
 * result wording are Layer 1 constants at the top of this file; the tool definitions
 * themselves contain no string literals.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	SKILL_DESCRIPTION_MAX_LENGTH,
	SKILL_NAME_MAX_LENGTH,
	SKILL_NAME_PATTERN,
	TOOL_NAME_PROMPT_SET,
	TOOL_NAME_SKILL_DELETE,
	TOOL_NAME_SKILL_LIST,
	TOOL_NAME_SKILL_SAVE,
} from "../constants.ts";
import { promptBackupPath, promptOverridePath, skillsDir } from "./paths.ts";
import { resolveCodeModePrompt } from "./prompt.ts";
import { deleteSkill, listSkills, saveSkill, type SkillSummary } from "./skills.ts";

/** Result sentences. */
const MESSAGE_SKILL_SAVED = "スキルを保存しました";
const MESSAGE_SKILL_DELETED = "スキルを削除しました";
const MESSAGE_SKILLS = "スキル";
const MESSAGE_NO_SKILLS = "スキルはありません";
const MESSAGE_SAVED_TO = "保存先";
const MESSAGE_PROMPT_UPDATED = "code-mode プロンプトを更新しました";
const MESSAGE_BACKUP = "バックアップ";

/** Applied when a skill changed; reload timing is not obvious from the filesystem. */
const MESSAGE_RELOAD = "変更は次のセッションまたは /reload から有効になります。";

/** Result formatting fragments. */
const MESSAGE_SEPARATOR = ": ";
const MESSAGE_LINE_SEPARATOR = "\n";
const MESSAGE_LIST_ITEM_PREFIX = "- ";
const MESSAGE_COUNT_SUFFIX = " 件";
const MESSAGE_PAREN_OPEN = "（";
const MESSAGE_PAREN_CLOSE = "）";
const MESSAGE_HEADER_SUFFIX = ":";

/** Tool labels. */
const LABEL_SKILL_SAVE = "スキル保存";
const LABEL_SKILL_LIST = "スキル一覧";
const LABEL_SKILL_DELETE = "スキル削除";
const LABEL_PROMPT_SET = "code-mode プロンプト更新";

/** Tool descriptions. */
const DESCRIPTION_SKILL_SAVE = "スキルを Agent Skills 形式で保存または上書きします。";
const DESCRIPTION_SKILL_LIST = "保存済みスキルの名前と説明を返します。";
const DESCRIPTION_SKILL_DELETE = "スキルのディレクトリを削除します。";
const DESCRIPTION_PROMPT_SET = "code-mode プロンプトを上書きし、変更前を .bak に保存します。";

/** Parameter descriptions; the skill name interpolates the Layer 2 rule and limit. */
const PARAM_SKILL_NAME_SAVE = `スキル名（${SKILL_NAME_PATTERN.source}、${SKILL_NAME_MAX_LENGTH} 文字以下）`;
const PARAM_SKILL_DESCRIPTION = `スキルの説明（${SKILL_DESCRIPTION_MAX_LENGTH} 文字以下、空・空白のみは不可）`;
const PARAM_SKILL_BODY = "スキル本文（空・空白のみは不可）";
const PARAM_SKILL_DELETE_NAME = "削除するスキル名";
const PARAM_PROMPT_CONTENT = "新しい code-mode プロンプト本文（空・空白のみは不可）";

/** Error for an empty prompt override. */
const ERROR_EMPTY_CONTENT = "code-mode プロンプトの content は空または空白のみにできません。";

const skillSaveParameters = Type.Object({
	name: Type.String({ description: PARAM_SKILL_NAME_SAVE }),
	description: Type.String({ description: PARAM_SKILL_DESCRIPTION }),
	body: Type.String({ description: PARAM_SKILL_BODY }),
});

const skillListParameters = Type.Object({});

const skillDeleteParameters = Type.Object({
	name: Type.String({ description: PARAM_SKILL_DELETE_NAME }),
});

const promptSetParameters = Type.Object({
	content: Type.String({ description: PARAM_PROMPT_CONTENT }),
});

function textResult(text: string): AgentToolResult<undefined> {
	return { content: [{ type: "text", text }], details: undefined };
}

/** Confirmation after a skill write, including the reload timing. */
function savedMessage(filePath: string): string {
	return `${MESSAGE_SKILL_SAVED}${MESSAGE_SEPARATOR}${filePath}${MESSAGE_LINE_SEPARATOR}${MESSAGE_RELOAD}`;
}

/** One line per listed skill, or the empty-list notice. */
function skillsMessage(skills: readonly SkillSummary[], dir: string): string {
	if (skills.length === 0) {
		return `${MESSAGE_NO_SKILLS}${MESSAGE_PAREN_OPEN}${MESSAGE_SAVED_TO}${MESSAGE_SEPARATOR}${dir}${MESSAGE_PAREN_CLOSE}`;
	}
	const header = `${MESSAGE_SKILLS} ${skills.length}${MESSAGE_COUNT_SUFFIX}${MESSAGE_PAREN_OPEN}${MESSAGE_SAVED_TO}${MESSAGE_SEPARATOR}${dir}${MESSAGE_PAREN_CLOSE}${MESSAGE_HEADER_SUFFIX}`;
	const lines = skills.map(
		(skill) => `${MESSAGE_LIST_ITEM_PREFIX}${skill.name}${MESSAGE_SEPARATOR}${skill.description}`,
	);
	return [header, ...lines].join(MESSAGE_LINE_SEPARATOR);
}

/** Build the four codemode tools bound to `agentDir`. */
export function createHarnessTools(agentDir: string): readonly ToolDefinition[] {
	return [skillSaveTool(agentDir), skillListTool(agentDir), skillDeleteTool(agentDir), promptSetTool(agentDir)];
}

function skillSaveTool(agentDir: string): ToolDefinition<typeof skillSaveParameters, undefined> {
	return {
		name: TOOL_NAME_SKILL_SAVE,
		label: LABEL_SKILL_SAVE,
		description: DESCRIPTION_SKILL_SAVE,
		parameters: skillSaveParameters,
		exposure: "codemode",
		async execute(_toolCallId, params) {
			const saved = await saveSkill(agentDir, params);
			return textResult(savedMessage(saved.path));
		},
	};
}

function skillListTool(agentDir: string): ToolDefinition<typeof skillListParameters, undefined> {
	return {
		name: TOOL_NAME_SKILL_LIST,
		label: LABEL_SKILL_LIST,
		description: DESCRIPTION_SKILL_LIST,
		parameters: skillListParameters,
		exposure: "codemode",
		async execute(_toolCallId, _params) {
			return textResult(skillsMessage(await listSkills(agentDir), skillsDir(agentDir)));
		},
	};
}

function skillDeleteTool(agentDir: string): ToolDefinition<typeof skillDeleteParameters, undefined> {
	return {
		name: TOOL_NAME_SKILL_DELETE,
		label: LABEL_SKILL_DELETE,
		description: DESCRIPTION_SKILL_DELETE,
		parameters: skillDeleteParameters,
		exposure: "codemode",
		async execute(_toolCallId, params) {
			const deleted = await deleteSkill(agentDir, params.name);
			return textResult(`${MESSAGE_SKILL_DELETED}${MESSAGE_SEPARATOR}${deleted.path}`);
		},
	};
}

function promptSetTool(agentDir: string): ToolDefinition<typeof promptSetParameters, undefined> {
	return {
		name: TOOL_NAME_PROMPT_SET,
		label: LABEL_PROMPT_SET,
		description: DESCRIPTION_PROMPT_SET,
		parameters: promptSetParameters,
		exposure: "codemode",
		async execute(_toolCallId, params) {
			if (typeof params.content !== "string" || params.content.trim() === "") {
				throw new Error(ERROR_EMPTY_CONTENT);
			}
			const override = promptOverridePath(agentDir);
			const backup = promptBackupPath(agentDir);
			const current = await resolveCodeModePrompt(agentDir);
			await mkdir(path.dirname(override), { recursive: true });
			await writeFile(backup, current, "utf8");
			await writeFile(override, params.content, "utf8");
			return textResult(
				`${MESSAGE_PROMPT_UPDATED}${MESSAGE_SEPARATOR}${override}${MESSAGE_LINE_SEPARATOR}${MESSAGE_BACKUP}${MESSAGE_SEPARATOR}${backup}`,
			);
		},
	};
}
