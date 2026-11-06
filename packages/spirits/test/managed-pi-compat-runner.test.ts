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
