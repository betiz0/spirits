/**
 * rlm depth limits and child tool-call budget.
 *
 * Depth is held in the host function closure (never in the REPL context), and a child's limit
 * can only be lowered through `opts.maxDepth`. The root limit is fixed for M3.
 */

/** Root session depth limit. M3 provides no way to change it. */
export const DEFAULT_MAX_DEPTH = 2;

/** Maximum tool calls a child session may start within one `rlm` call. */
export const RLM_MAX_TOOL_CALLS = 50;

/** Clamp a requested limit to the inherited limit. A raise is reduced to the inherited value. */
export function resolveChildMaxDepth(inherited: number, requested: number | undefined): number {
	if (requested === undefined) {
		return inherited;
	}
	return Math.min(inherited, requested);
}

/** Error thrown when a session at or above its depth limit calls `rlm`. */
export function depthLimitError(limit: number): Error {
	return new Error(
		`深度上限（${limit}）に達したため、子エージェントを起動できません。問題を分割せず、現在の層で直接処理してください。`,
	);
}

/**
 * Whether a session event counts against the child tool-call budget.
 *
 * Only model-issued calls count: nested calls made through `ctx.executeTool()` carry a
 * `parentToolCallId` and are excluded.
 */
export function countsAgainstToolBudget(event: { type: string; parentToolCallId?: string }): boolean {
	return event.type === "tool_execution_start" && event.parentToolCallId === undefined;
}

/** Whether `count` exceeded the budget. 50 calls are allowed, the 51st exceeds it. */
export function isToolBudgetExceeded(count: number): boolean {
	return count > RLM_MAX_TOOL_CALLS;
}
