import { expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { createCompatRunner } from "../../../scripts/managed-pi-compat/runner.ts";

test("runner isolates HOME and agent dir", async () => {
	const runner = await createCompatRunner();
	try {
		expect(runner.home.startsWith(runner.workRoot)).toBe(true);
		expect(runner.agentDir.startsWith(runner.workRoot)).toBe(true);
		const env = runner.env();
		expect(env.HOME).toBe(runner.home);
		expect(env.SPIRITS_CODING_AGENT_DIR).toBe(runner.agentDir);
		expect(env.PI_CODING_AGENT_DIR).toBeUndefined();
	} finally {
		await runner.cleanup();
	}
});

test("runner records the execution mode", async () => {
	const runner = await createCompatRunner({ mode: "fixture" });
	try {
		runner.setMode("official");
		runner.setEvidence({
			targetCommit: "abc123",
			runtime: { runner: "bun 1.4.4", host: "bun 1.4.4", requiredApis: { getSettings: true } },
		});
		await runner.run("managed extension load", async () => ({ state: "confirmed", detail: "ok" }));
		const path = await runner.writeResult();
		const parsed = JSON.parse(await Bun.file(path).text()) as {
			mode: string;
			runnerCompleted: boolean;
			compatibilityMet: boolean;
			runtime: { host: string };
			observationEvidence: Array<{ observation: string }>;
		};
		expect(parsed.mode).toBe("official");
		expect(parsed.runnerCompleted).toBe(true);
		expect(parsed.compatibilityMet).toBe(false);
		expect(parsed.runtime.host).toBe("bun 1.4.4");
		expect(parsed.observationEvidence[0]?.observation).toBe("managed extension load");
		const summary = await Bun.file(join(dirname(path), "managed-pi-compat-result.md")).text();
		expect(summary).toContain("Mode: official");
		expect(summary).toContain("managed extension load");
	} finally {
		await runner.cleanup();
	}
});

test("every item records its command", async () => {
	const runner = await createCompatRunner({ mode: "official" });
	try {
		const command = ["/managed/pi", "--mode", "rpc"];
		await runner.run("managed extension load", async () => ({
			state: "confirmed",
			detail: "ok",
			log: { command, stdout: "started", stderr: "ANTHROPIC_API_KEY=sk-live-secret-value" },
		}));
		await runner.run("host version", async () => ({ state: "confirmed", detail: "ok" }));
		runner.notRun("rlm child abort", "artifact unavailable");
		const path = await runner.writeResult();
		const parsed = JSON.parse(await Bun.file(path).text()) as {
			logs: Array<{ item: string; command?: string[]; stdout?: string; stderr?: string }>;
		};
		const executed = runner.results().filter((result) => result.state !== "not-run").map((result) => result.name);
		expect(parsed.logs.map((entry) => entry.item)).toEqual(executed);
		expect(parsed.logs.every((entry) => (entry.command?.length ?? 0) > 0)).toBe(true);
		expect(parsed.logs[0]?.command).toEqual(command);
		expect(parsed.logs[0]?.stdout).toBe("started");
		expect(parsed.logs[0]?.stderr).toContain("ANTHROPIC_API_KEY=***");
		expect(parsed.logs[0]?.stderr).not.toContain("sk-live-secret-value");
	} finally {
		await runner.cleanup();
	}
});

test("a changed existing agent dir fails an item, not only the evidence field", async () => {
	const untouched = await createCompatRunner({ mode: "official" });
	const touched = await createCompatRunner({ mode: "official" });
	try {
		expect((await untouched.verifyExistingAgentDir()).state).toBe("confirmed");
		await Bun.write(join(touched.existingAgentDir, "settings.json"), '{ "theme": "lighter-than-dark" }\n');
		const item = await touched.verifyExistingAgentDir();
		expect(item.state).toBe("failed");
		expect(item.detail).toContain("must never write there");
		const parsed = JSON.parse(await Bun.file(await touched.writeResult()).text()) as {
			existingAgentDirUnchanged: boolean;
			results: Array<{ name: string; state: string }>;
		};
		expect(parsed.existingAgentDirUnchanged).toBe(false);
		expect(
			parsed.results.some((result) => result.name === "existing agent dir untouched" && result.state === "failed"),
		).toBe(true);
	} finally {
		await untouched.cleanup();
		await touched.cleanup();
	}
});

test("the summary head carries the definitions, the runner version and every issue", async () => {
	const runner = await createCompatRunner({ mode: "official" });
	try {
		runner.setEvidence({
			runnerProvenance: { commit: "abc1234def", diffSha256: "d".repeat(64), untracked: ["scratch/x.ts"], clean: false },
		});
		await runner.run("managed extension load", async () => ({ state: "confirmed", detail: "ok" }));
		await runner.run("rlm auto parent", async () => ({ state: "limited", detail: "known limitation" }));
		await runner.run("rlm child abort", async () => ({ state: "unavailable", detail: "the host refused the abort" }));
		await runner.run("role/clear/model matrix", async () => ({
			state: "confirmed",
			detail: "2 of 9 purposes observed",
			data: {
				purposes: [
					{ id: "skill-strong-phase", state: "available" },
					{ id: "thinking-level", state: "limited" },
					{ id: "conversation-clear", state: "not-run" },
				],
			},
		}));
		runner.notRun("settings write compatibility", "the API does not expose it");
		await runner.verifyExistingAgentDir();
		const path = await runner.writeResult();
		const summary = await Bun.file(join(dirname(path), "managed-pi-compat-result.md")).text();
		const head = summary.slice(0, summary.indexOf("## Items"));
		expect(head).toContain("Runner completed: false (every recorded item was processed");
		expect(head).toContain("Compatibility met: false (official mode only, and every required observation");
		expect(head).toContain("Runner version: abc1234def (diff sha256 " + "d".repeat(64) + ", 1 untracked, clean=false)");
		// A required item that is not confirmed is listed before the item dump, so a reader cannot miss it.
		// Every breakdown names all five states, so a missing label is never read as "not measured".
		expect(head).toContain("Results: confirmed=3 limited=1 unavailable=1 not-run=1 failed=0");
		// The two `confirmed` judgements a reader overreads carry their condition in the head.
		expect(head).toContain("Note: `rlm child abort` is confirmed conditionally");
		expect(head).toContain("never at `agent_settled`");
		expect(head).toContain("Note: `role/clear/model matrix` is confirmed when any purpose was observed");
		expect(head).toContain("This run observed 2 of 3 purposes.");
		expect(head).toContain("## Required observations not confirmed");
		expect(head).toContain("[unavailable] rlm child abort");
		expect(head).toContain("[limited] rlm auto parent");
		expect(head).toContain("[not-run] settings write compatibility");
		expect(head.indexOf("rlm auto parent")).toBeLessThan(summary.indexOf("## Items"));
		const parsed = JSON.parse(await Bun.file(path).text()) as Record<string, unknown>;
		expect(String(parsed.runnerCompletedDefinition)).toContain("not-run");
		expect(String(parsed.compatibilityMetDefinition)).toContain("required observation");
		expect(parsed.runnerProvenance).toMatchObject({ commit: "abc1234def", clean: false });
	} finally {
		await runner.cleanup();
	}
});

test("existing agent dir immutability is measured, not assumed", async () => {
	const runner = await createCompatRunner();
	try {
		// The temporary HOME carries a seeded `~/.spirits/agent`, so "unchanged" has something to check.
		expect(await Bun.file(join(runner.existingAgentDir, "settings.json")).exists()).toBe(true);
		expect(await Bun.file(join(runner.existingAgentDir, "sessions", "project", "s1.jsonl")).exists()).toBe(true);
		await runner.run("managed extension load", async () => ({ state: "confirmed", detail: "ok" }));
		const untouched = JSON.parse(await Bun.file(await runner.writeResult()).text()) as {
			existingAgentDirUnchanged?: boolean;
		};
		expect(untouched.existingAgentDirUnchanged).toBe(true);
		// A write into that tree flips the recorded evidence.
		await Bun.write(join(runner.existingAgentDir, "settings.json"), '{ "theme": "lighter-than-dark" }\n');
		const touched = JSON.parse(
			await Bun.file(await runner.writeResult(join(runner.workRoot, "second", "result.json"))).text(),
		) as { existingAgentDirUnchanged?: boolean };
		expect(touched.existingAgentDirUnchanged).toBe(false);
	} finally {
		await runner.cleanup();
	}
});

test("runner records not-run separately", async () => {
	const runner = await createCompatRunner();
	try {
		runner.notRun("managed artifact", "artifact unavailable");
		await runner.run("passing item", async () => ({ state: "confirmed", detail: "ok" }));
		await runner.run("throwing item", async () => {
			throw new Error("boom");
		});
		const states = runner.results().map((result) => `${result.name}:${result.state}`);
		expect(states).toEqual(["managed artifact:not-run", "passing item:confirmed", "throwing item:failed"]);
		const path = await runner.writeResult();
		expect(JSON.parse(await Bun.file(path).text()).results).toHaveLength(3);
	} finally {
		await runner.cleanup();
	}
});
