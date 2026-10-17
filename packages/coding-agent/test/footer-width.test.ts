import { visibleWidth } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { FooterComponent, formatCwdForFooter } from "../src/modes/interactive/components/footer.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

type AssistantUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
};

function createSession(options: {
	sessionName: string;
	modelId?: string;
	provider?: string;
	reasoning?: boolean;
	thinkingLevel?: string;
	usage?: AssistantUsage;
	branchUsage?: AssistantUsage;
	compactionUsage?: AssistantUsage;
	toolUsage?: AssistantUsage;
	usingSubscription?: boolean;
	routedModel?: { model: { id: string }; thinkingLevel?: string; role?: string };
}): AgentSession {
	const usage = options.usage;
	const entries: Array<Record<string, unknown>> = [];

	if (usage !== undefined) {
		entries.push({
			type: "message",
			message: {
				role: "assistant",
				usage,
			},
		});
	}

	if (options.branchUsage !== undefined) {
		entries.push({
			type: "branch_summary",
			usage: options.branchUsage,
		});
	}

	if (options.compactionUsage !== undefined) {
		entries.push({
			type: "compaction",
			usage: options.compactionUsage,
		});
	}

	if (options.toolUsage !== undefined) {
		entries.push({
			type: "message",
			message: {
				role: "toolResult",
				usage: options.toolUsage,
			},
		});
	}

	const session = {
		state: {
			model: {
				id: options.modelId ?? "test-model",
				provider: options.provider ?? "test",
				contextWindow: 200_000,
				reasoning: options.reasoning ?? false,
			},
			thinkingLevel: options.thinkingLevel ?? "off",
		},
		sessionManager: {
			getEntries: () => entries,
			getEntryCount: () => entries.length,
			getSessionId: () => "test-session",
			getLeafId: () => null,
			getSessionName: () => options.sessionName,
			getCwd: () => "/tmp/project",
		},
		getContextUsage: () => ({ contextWindow: 200_000, percent: 12.3 }),
		routedModel: options.routedModel,
		modelRuntime: {
			isUsingSubscription: () => options.usingSubscription ?? false,
		},
	};

	return session as unknown as AgentSession;
}

function createFooterData(providerCount: number): ReadonlyFooterDataProvider {
	const provider = {
		getGitBranch: () => "main",
		getExtensionStatuses: () => new Map<string, string>(),
		getAvailableProviderCount: () => providerCount,
		onBranchChange: (callback: () => void) => {
			void callback;
			return () => {};
		},
	};

	return provider;
}

describe("formatCwdForFooter", () => {
	it("does not abbreviate sibling paths that share the home prefix", () => {
		expect(formatCwdForFooter("/home/user2", "/home/user")).toBe("/home/user2");
	});

	it("abbreviates the home directory and descendants", () => {
		expect(formatCwdForFooter("/home/user", "/home/user")).toBe("~");
		expect(formatCwdForFooter("/home/user/project", "/home/user")).toBe("~/project");
	});
});

describe("FooterComponent width handling", () => {
	beforeAll(() => {
		initTheme(undefined, false);
	});

	it("keeps all lines within width for wide session names", () => {
		const width = 93;
		const session = createSession({ sessionName: "한글".repeat(30) });
		const footer = new FooterComponent(session, createFooterData(1));

		const lines = footer.render(width);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("keeps stats line within width for wide model and provider names", () => {
		const width = 60;
		const session = createSession({
			sessionName: "",
			modelId: "模".repeat(30),
			provider: "공급자",
			reasoning: true,
			thinkingLevel: "high",
			usage: {
				input: 12_345,
				output: 6_789,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 1.234 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(2));

		const lines = footer.render(width);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("shows the physical model a virtual model routed to", () => {
		const session = createSession({
			sessionName: "",
			modelId: "auto",
			reasoning: true,
			thinkingLevel: "high",
			routedModel: { model: { id: "gpt-5.6-luna" }, thinkingLevel: "medium" },
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const statsLine = stripAnsi(footer.render(120)[1]);

		expect(statsLine).toContain("auto \u2022 high \u2192 gpt-5.6-luna \u2022 medium");
	});

	// Right side of a virtual selection: `auto • high → claude-opus-4-7 • high` is 36 visible columns,
	// the badge adds 9, the provider prefix adds 10, and the stats side is 17 with no usage recorded.
	function roleSession(role: string | undefined) {
		return createSession({
			sessionName: "",
			modelId: "auto",
			provider: "spirits",
			reasoning: true,
			thinkingLevel: "high",
			routedModel: { model: { id: "claude-opus-4-7" }, thinkingLevel: "high", role },
		});
	}

	it("prefixes the role badge to the right side", () => {
		const footer = new FooterComponent(roleSession("strong"), createFooterData(1));

		const statsLine = stripAnsi(footer.render(120)[1]);

		// The right side is right-aligned, so it ends the line.
		expect(statsLine.endsWith("[strong] auto • high → claude-opus-4-7 • high")).toBe(true);
	});

	it("keeps the badge before the provider prefix", () => {
		const footer = new FooterComponent(roleSession("normal"), createFooterData(2));

		const statsLine = stripAnsi(footer.render(120)[1]);

		expect(statsLine).toContain("[normal] (spirits) auto • high → claude-opus-4-7 • high");
	});

	it("keeps the badge before the routed model", () => {
		const footer = new FooterComponent(roleSession("strong"), createFooterData(1));

		const statsLine = stripAnsi(footer.render(120)[1]);

		const badge = statsLine.indexOf("[strong]");

		// Both the selection and the routed display follow the badge.
		expect(statsLine.indexOf("auto • high", badge)).toBeGreaterThan(badge);
		expect(statsLine.indexOf("→ claude-opus-4-7", badge)).toBeGreaterThan(badge);
	});

	it("omits the badge when no role is recorded", () => {
		const footer = new FooterComponent(roleSession(undefined), createFooterData(2));

		const statsLine = stripAnsi(footer.render(120)[1]);

		expect(statsLine).not.toContain("[");
		expect(statsLine).toContain("(spirits) auto • high → claude-opus-4-7 • high");
	});

	it("drops the provider prefix before truncating the badge", () => {
		// 70 columns fit the badge, the model and the routed model, but not the provider prefix too.
		const footer = new FooterComponent(roleSession("strong"), createFooterData(2));

		const statsLine = stripAnsi(footer.render(70)[1]);

		expect(statsLine).not.toContain("(spirits)");
		expect(statsLine).toContain("[strong] auto • high → claude-opus-4-7 • high");
		expect(visibleWidth(statsLine)).toBeLessThanOrEqual(70);
	});

	it("keeps the badge while truncating the tail", () => {
		const footer = new FooterComponent(roleSession("strong"), createFooterData(2));

		const statsLine = stripAnsi(footer.render(60)[1]);

		expect(statsLine).toContain("[strong] auto");
		// The tail goes first: the routed model's thinking level is what the truncation cut.
		expect(statsLine).not.toContain("claude-opus-4-7 • high");
		expect(visibleWidth(statsLine)).toBeLessThanOrEqual(60);
	});

	it("drops the whole right side, badge included, when there is no room", () => {
		const footer = new FooterComponent(roleSession("strong"), createFooterData(2));

		// 19 columns leave nothing after the stats and the minimum padding, so the right side is not
		// rendered at all: the badge does not survive on its own either.
		const lines = footer.render(19);
		const statsLine = stripAnsi(lines[1]);

		expect(lines).toHaveLength(2);
		expect(statsLine).toBe("12.3%/200k (auto)");
		expect(statsLine).not.toContain("[");
		expect(statsLine).not.toContain("claude-opus-4-7");
		expect(visibleWidth(statsLine)).toBeLessThanOrEqual(19);
	});

	// spec "model-role-badge / ロールバッジの表記": 制御文字を含むロール
	it("renders a role with control characters on one line", () => {
		const footer = new FooterComponent(roleSession("stro\n\tng"), createFooterData(1));

		const lines = footer.render(120);
		const statsLine = stripAnsi(lines[1]);

		// The badge stays a single line, and the footer keeps its two lines.
		expect(lines).toHaveLength(2);
		expect(statsLine).toContain("[stro ng]");
		expect(statsLine).not.toContain("\n");
	});

	it("includes summary and tool result usage in the total cost", () => {
		const session = createSession({
			sessionName: "",
			usage: {
				input: 100,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0.5 },
			},
			branchUsage: {
				input: 20,
				output: 5,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0.25 },
			},
			compactionUsage: {
				input: 5,
				output: 2,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0.125 },
			},
			toolUsage: {
				input: 15,
				output: 3,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0.375 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const statsLine = stripAnsi(footer.render(120)[1]);
		expect(statsLine).toContain("$1.250");
	});

	it("updates cached usage totals after an entry is appended", () => {
		const usage = { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0.5 } };
		const session = createSession({ sessionName: "", usage });
		const footer = new FooterComponent(session, createFooterData(1));
		expect(stripAnsi(footer.render(120)[1])).toContain("$0.500");

		session.sessionManager.getEntries().push({ type: "message", message: { role: "assistant", usage } } as never);
		expect(stripAnsi(footer.render(120)[1])).toContain("$1.000");
	});

	it("shows the latest cache hit rate when cache usage is present", () => {
		const session = createSession({
			sessionName: "",
			usage: {
				input: 100,
				output: 10,
				cacheRead: 50,
				cacheWrite: 50,
				cost: { total: 0.001 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const statsLine = stripAnsi(footer.render(120)[1]);
		expect(statsLine).toContain("CH25.0%");
	});

	it("marks Kimi Coding costs as subscription estimates", () => {
		const session = createSession({
			sessionName: "",
			provider: "kimi-coding",
			usage: {
				input: 100,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 1.234 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));

		expect(stripAnsi(footer.render(120)[1])).toContain("$1.234 (sub)");
	});

	it("marks explicitly identified subscription auth", () => {
		const session = createSession({ sessionName: "", provider: "anthropic", usingSubscription: true });
		const footer = new FooterComponent(session, createFooterData(1));

		expect(stripAnsi(footer.render(120)[1])).toContain("$0.000 (sub)");
	});

	it("does not mark generic OAuth sign-in as a subscription", () => {
		const session = createSession({
			sessionName: "",
			provider: "openrouter",
			usage: {
				input: 100,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 1.234 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));
		const stats = stripAnsi(footer.render(120)[1]);

		expect(stats).toContain("$1.234");
		expect(stats).not.toContain("(sub)");
	});
});
