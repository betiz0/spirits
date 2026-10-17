import type { Model } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import {
	getThinkingLevelArgumentCompletions,
	parseModelCommandArgs,
} from "../src/modes/interactive/model-command-args.ts";

function createModel(id: string, provider: string, options?: { reasoning?: boolean }): Model<any> {
	return {
		id,
		provider,
		name: id,
		reasoning: options?.reasoning ?? false,
	} as Model<any>;
}

const reasoningModel = createModel("claude-sonnet-4-5", "anthropic", { reasoning: true });
const plainModel = createModel("gpt-5.5", "openai", { reasoning: false });

/** The vocabulary spirits registers, spelled the way the save key stores it. */
const ROLES = ["normal", "strong"];

describe("parseModelCommandArgs", () => {
	it("splits a trailing thinking level from the model term", () => {
		expect(parseModelCommandArgs("anthropic/claude-sonnet-4-5 high")).toEqual({
			searchTerm: "anthropic/claude-sonnet-4-5",
			thinkingLevel: "high",
		});
	});

	it("matches thinking level names case-insensitively", () => {
		expect(parseModelCommandArgs("anthropic/claude-sonnet-4-5 HIGH")).toEqual({
			searchTerm: "anthropic/claude-sonnet-4-5",
			thinkingLevel: "high",
		});
	});

	it("keeps a multi-word search term when the last word is not a level", () => {
		expect(parseModelCommandArgs("claude sonnet")).toEqual({ searchTerm: "claude sonnet" });
	});

	it("treats a single level-like word as the model term", () => {
		expect(parseModelCommandArgs("high")).toEqual({ searchTerm: "high" });
	});

	it("returns no search term for empty arguments", () => {
		expect(parseModelCommandArgs("")).toEqual({});
		expect(parseModelCommandArgs("   ")).toEqual({});
	});

	it("splits a trailing role from the model term", () => {
		expect(parseModelCommandArgs("anthropic/claude-sonnet-4-5 strong", ROLES)).toEqual({
			searchTerm: "anthropic/claude-sonnet-4-5",
			role: "strong",
		});
		expect(parseModelCommandArgs("anthropic/claude-sonnet-4-5 normal", ROLES)).toEqual({
			searchTerm: "anthropic/claude-sonnet-4-5",
			role: "normal",
		});
	});

	it("matches role names case-insensitively and returns the registered spelling", () => {
		expect(parseModelCommandArgs("anthropic/claude-sonnet-4-5 STRONG", ROLES)).toEqual({
			searchTerm: "anthropic/claude-sonnet-4-5",
			role: "strong",
		});
	});

	it("takes the level before the role in `<model> <level> <role>` order", () => {
		expect(parseModelCommandArgs("anthropic/claude-sonnet-4-5 high strong", ROLES)).toEqual({
			searchTerm: "anthropic/claude-sonnet-4-5",
			thinkingLevel: "high",
			role: "strong",
		});
	});

	it("keeps a role word inside the search term when it precedes the level", () => {
		expect(parseModelCommandArgs("anthropic/claude-sonnet-4-5 strong high", ROLES)).toEqual({
			searchTerm: "anthropic/claude-sonnet-4-5 strong",
			thinkingLevel: "high",
		});
	});

	it("treats a single role-like word as the model term", () => {
		expect(parseModelCommandArgs("normal", ROLES)).toEqual({ searchTerm: "normal" });
	});

	it("keeps the search term when the last word is no role", () => {
		expect(parseModelCommandArgs("anthropic/claude-sonnet-4-5 invalidrole", ROLES)).toEqual({
			searchTerm: "anthropic/claude-sonnet-4-5 invalidrole",
		});
		expect(parseModelCommandArgs("claude sonnet", ROLES)).toEqual({ searchTerm: "claude sonnet" });
	});

	it("takes no role when no vocabulary is registered", () => {
		expect(parseModelCommandArgs("anthropic/claude-sonnet-4-5 strong")).toEqual({
			searchTerm: "anthropic/claude-sonnet-4-5 strong",
		});
		expect(parseModelCommandArgs("anthropic/claude-sonnet-4-5 strong", [])).toEqual({
			searchTerm: "anthropic/claude-sonnet-4-5 strong",
		});
	});
});

describe("getThinkingLevelArgumentCompletions", () => {
	it("suggests supported thinking levels after an exact model match", () => {
		const items = getThinkingLevelArgumentCompletions("anthropic/claude-sonnet-4-5 h", [reasoningModel]);
		expect(items).not.toBeNull();
		expect(items?.map((item) => item.label)).toEqual(["high"]);
	});

	it("keeps the model reference in the completion value", () => {
		const items = getThinkingLevelArgumentCompletions("anthropic/claude-sonnet-4-5 hi", [reasoningModel]);
		expect(items?.map((item) => item.value)).toEqual(["anthropic/claude-sonnet-4-5 high"]);
	});

	it("suggests only off for a non-reasoning model", () => {
		const items = getThinkingLevelArgumentCompletions("openai/gpt-5.5 ", [plainModel, reasoningModel]);
		expect(items?.map((item) => item.value)).toEqual(["openai/gpt-5.5 off"]);
	});

	it("returns no level suggestions when the first word is not an exact match", () => {
		expect(getThinkingLevelArgumentCompletions("claude son", [reasoningModel])).toBeNull();
	});

	it("returns no level suggestions without a trailing word separator", () => {
		expect(getThinkingLevelArgumentCompletions("claude", [reasoningModel])).toBeNull();
		expect(getThinkingLevelArgumentCompletions("", [reasoningModel])).toBeNull();
	});

	// spec "model-commands / /model の引数補完は 2 語目に thinking レベルとロールを出す": ロールの候補
	it("suggests the registered roles after an exact model match", () => {
		const items = getThinkingLevelArgumentCompletions("anthropic/claude-sonnet-4-5 s", [reasoningModel], ROLES);
		expect(items?.map((item) => item.value)).toEqual(["anthropic/claude-sonnet-4-5 strong"]);
	});

	it("suggests levels before roles and keeps the model reference", () => {
		const items = getThinkingLevelArgumentCompletions("anthropic/claude-sonnet-4-5 ", [reasoningModel], ROLES);
		expect(items?.map((item) => item.label)).toEqual(["off", "minimal", "low", "medium", "high", "normal", "strong"]);
		expect(items?.at(-1)?.value).toBe("anthropic/claude-sonnet-4-5 strong");
	});

	it("suggests no role when no vocabulary is registered", () => {
		const items = getThinkingLevelArgumentCompletions("anthropic/claude-sonnet-4-5 s", [reasoningModel]);
		expect(items).toBeNull();
	});
});
