import { expect, test } from "bun:test";
import {
	DEFAULT_MAX_DEPTH,
	RLM_MAX_TOOL_CALLS,
	countsAgainstToolBudget,
	depthLimitError,
	isToolBudgetExceeded,
	resolveChildMaxDepth,
} from "../src/rlm/depth.ts";

test("default max depth", () => {
	expect(DEFAULT_MAX_DEPTH).toBe(2);
	expect(RLM_MAX_TOOL_CALLS).toBe(50);
});

test("child max clamps down", () => {
	expect(resolveChildMaxDepth(2, 1)).toBe(1);
	expect(resolveChildMaxDepth(2, 0)).toBe(0);
});

test("child max never raises", () => {
	expect(resolveChildMaxDepth(2, 5)).toBe(2);
	expect(resolveChildMaxDepth(2, undefined)).toBe(2);
});

test("depth limit message includes limit and guidance", () => {
	const error = depthLimitError(2);
	expect(error.message).toContain("2");
	expect(error.message).toContain("現在の層");
});

test("budget counts top-level only", () => {
	expect(countsAgainstToolBudget({ type: "tool_execution_start" })).toBe(true);
	expect(countsAgainstToolBudget({ type: "tool_execution_start", parentToolCallId: "p1" })).toBe(false);
	expect(countsAgainstToolBudget({ type: "tool_execution_end" })).toBe(false);
});

test("budget boundary 50 ok 51 exceeded", () => {
	expect(isToolBudgetExceeded(50)).toBe(false);
	expect(isToolBudgetExceeded(51)).toBe(true);
});
