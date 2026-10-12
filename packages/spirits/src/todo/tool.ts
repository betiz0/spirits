/**
 * The `manage_todos` tool.
 *
 * One call carries a batch of operations. The batch applies in order and is
 * all-or-nothing: a single invalid operation returns an error with its position and
 * reason, and no snapshot is appended. On success exactly one `spirits_todo` snapshot
 * is appended and the full list is returned.
 */

import { Type } from "typebox";
import type {
	AgentToolResult,
	ExtensionAPI,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../config.ts";
import { DEFAULT_TODO_MAX_LINES } from "../constants.ts";
import {
	applyTodoUpdates,
	resolveTodoSnapshot,
	type TodoApplyError,
	type TodoSnapshot,
	TODO_ENTRY_TYPE,
} from "./state.ts";
import { updateTodoPanel } from "./widget.ts";

/** External tool name. */
export const MANAGE_TODOS_TOOL_NAME = "manage_todos";

/** Short line added to the tools section of the system prompt. */
export const MANAGE_TODOS_PROMPT_SNIPPET = "セッション TODO 一覧の管理";

/** Rules added to the system prompt while the tool is available. */
export const MANAGE_TODOS_PROMPT_GUIDELINES = [
	"manage_todos でセッション TODO を管理し、作業の進捗に合わせて追加・更新・完了・削除を行う。",
	"ID はツールが採番し、削除しても再利用されない。操作には結果に含まれる ID を使う。",
	"複数の更新は 1 回の呼び出しにまとめる。1 つでも不正な操作があると何も適用されない。",
];

/** Tool label. */
const LABEL_MANAGE_TODOS = "TODO 管理";

/** Tool description. */
const DESCRIPTION_MANAGE_TODOS =
	"セッション TODO を一括で追加・更新・削除します。ID はツールが採番し、削除しても再利用されません。不正な操作が 1 つでもあると何も適用されず、位置と理由を返します。";

/** Result text fragments. */
const MESSAGE_EMPTY = "TODO はありません。";
const MESSAGE_ITEM_DONE = "- [x]";
const MESSAGE_ITEM_PENDING = "- [ ]";
const MESSAGE_ID_PREFIX = " #";
const MESSAGE_SPACE = " ";
const MESSAGE_LINE_SEPARATOR = "\n";

/** Parameter descriptions. */
const PARAM_UPDATES = "適用する操作の配列。先頭から順に適用されます。";
const PARAM_ADD_TEXT = "追加する項目のテキスト。空または空白のみは不可。";
const PARAM_ID = "対象項目の ID。";
const PARAM_UPDATE_TEXT = "新しいテキスト。done と併用可。少なくとも一方の指定が必要。";
const PARAM_UPDATE_DONE = "完了状態。テキストと併用可。少なくとも一方の指定が必要。";

const addOperation = Type.Object({
	op: Type.Literal("add"),
	text: Type.String({ description: PARAM_ADD_TEXT }),
});

const updateOperation = Type.Object({
	op: Type.Literal("update"),
	id: Type.Number({ description: PARAM_ID }),
	text: Type.Optional(Type.String({ description: PARAM_UPDATE_TEXT })),
	done: Type.Optional(Type.Boolean({ description: PARAM_UPDATE_DONE })),
});

const deleteOperation = Type.Object({
	op: Type.Literal("delete"),
	id: Type.Number({ description: PARAM_ID }),
});

const parameters = Type.Object({
	updates: Type.Array(Type.Union([addOperation, updateOperation, deleteOperation]), {
		description: PARAM_UPDATES,
	}),
});

export type ManageTodosParameters = typeof parameters;
export type ManageTodosDetails = TodoSnapshot | TodoApplyError;

export interface ManageTodosToolOptions {
	/** Extension API used to append the snapshot to the session. */
	pi: Pick<ExtensionAPI, "appendEntry">;
	/** TODO lines shown by the panel. Defaults to `DEFAULT_TODO_MAX_LINES`. */
	maxLines?: number;
}

/** Format an invalid batch as a single line with the failing position. */
export function formatTodoError(error: TodoApplyError): string {
	const position = error.index === undefined ? "updates" : `updates[${error.index}]`;
	return `${position}: ${error.reason}`;
}

/** One line per item, or the empty notice. */
export function formatTodoSnapshot(snapshot: TodoSnapshot): string {
	if (snapshot.items.length === 0) {
		return MESSAGE_EMPTY;
	}
	return snapshot.items
		.map((item) => {
			const marker = item.done ? MESSAGE_ITEM_DONE : MESSAGE_ITEM_PENDING;
			return `${marker}${MESSAGE_ID_PREFIX}${item.id}${MESSAGE_SPACE}${item.text}`;
		})
		.join(MESSAGE_LINE_SEPARATOR);
}

/** Build the `manage_todos` tool bound to the extension API that persists snapshots. */
export function createManageTodosTool(
	options: ManageTodosToolOptions,
): ToolDefinition<ManageTodosParameters, ManageTodosDetails> {
	const { pi } = options;
	const maxLines = options.maxLines ?? DEFAULT_TODO_MAX_LINES;
	return {
		name: MANAGE_TODOS_TOOL_NAME,
		label: LABEL_MANAGE_TODOS,
		description: DESCRIPTION_MANAGE_TODOS,
		promptSnippet: MANAGE_TODOS_PROMPT_SNIPPET,
		promptGuidelines: [...MANAGE_TODOS_PROMPT_GUIDELINES],
		parameters,
		exposure: "direct",
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<ManageTodosDetails>> {
			const current = resolveTodoSnapshot(ctx.sessionManager.getBranch());
			const result = applyTodoUpdates(current, params.updates);
			if (!result.ok) {
				return {
					content: [{ type: "text", text: formatTodoError(result.error) }],
					details: result.error,
					isError: true,
				};
			}

			pi.appendEntry(TODO_ENTRY_TYPE, result.snapshot);
			updateTodoPanel(ctx, result.snapshot, maxLines);
			return {
				content: [{ type: "text", text: formatTodoSnapshot(result.snapshot) }],
				details: result.snapshot,
			};
		},
	};
}

/** Register the `manage_todos` tool on a pi extension. */
export function registerManageTodos(pi: ExtensionAPI): void {
	const { maxLines } = loadConfig(process.env).todo;
	pi.registerTool(createManageTodosTool({ pi, maxLines }));
}
