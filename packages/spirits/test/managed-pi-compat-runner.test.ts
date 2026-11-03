import { expect, test } from "bun:test";
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
