/**
 * The `goal` host function.
 *
 * `goal()` resolves the goal on the current branch: the latest `spirits_goal` custom
 * entry wins; otherwise the first user message text; otherwise "". `goal(text)` appends
 * a `spirits_goal` entry and returns the text.
 *
 * Resolution uses only `getBranch()` (root to current leaf), so goals set on abandoned
 * branches never leak into the result.
 */

import type {
	AgentMessage,
	CustomEntry,
	ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { isRecord } from "../repl/guards.ts";
import type { HostFnCallable, HostFnEntry, HostFnScope } from "../repl/registry.ts";
import { buildGoalGuidance } from "./guidance.ts";

/** Custom session entry type recording an explicitly set goal. */
const GOAL_ENTRY_TYPE = "spirits_goal";

/** Key of the goal string inside the entry data. */
const GOAL_DATA_KEY = "goal";

export interface CreateGoalHostFnOptions {
	pi: Pick<ExtensionAPI, "appendEntry">;
}

/** Build the `goal` host function. */
export function createGoalHostFn(options: CreateGoalHostFnOptions): HostFnEntry {
	const { pi } = options;
	return {
		name: "goal",
		description: buildGoalGuidance(),
		create(scope: HostFnScope): HostFnCallable {
			return (...args: unknown[]): string => {
				if (args.length === 0) {
					return resolveGoal(scope);
				}
				const text = args[0];
				if (typeof text !== "string") {
					throw new Error("goal: text は文字列でなければなりません。");
				}
				if (text.trim() === "") {
					throw new Error("goal: 空または空白のみの text は設定できません。");
				}
				pi.appendEntry(GOAL_ENTRY_TYPE, { [GOAL_DATA_KEY]: text });
				return text;
			};
		},
	};
}

/** Resolve the goal from the current branch, preferring the latest explicit setting. */
function resolveGoal(scope: HostFnScope): string {
	const branch = scope.toolContext.sessionManager.getBranch();
	let explicit: string | undefined;
	// `undefined` means "not seen yet"; an empty text still fixes the first user message,
	// so a later user message cannot become the goal (e.g. an image-only first message).
	let firstUser: string | undefined;
	for (const entry of branch) {
		if (entry.type === "custom") {
			const goal = readGoal(entry);
			if (goal !== undefined) {
				explicit = goal;
			}
		} else if (entry.type === "message" && entry.message.role === "user" && firstUser === undefined) {
			firstUser = messageText(entry.message);
		}
	}
	return explicit ?? firstUser ?? "";
}

function readGoal(entry: CustomEntry): string | undefined {
	if (entry.customType !== GOAL_ENTRY_TYPE || !isRecord(entry.data)) {
		return undefined;
	}
	const goal = entry.data[GOAL_DATA_KEY];
	return typeof goal === "string" ? goal : undefined;
}

function messageText(message: AgentMessage): string {
	const content = message.content;
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	let text = "";
	for (const part of content) {
		if (part.type === "text") {
			text += part.text;
		}
	}
	return text;
}
