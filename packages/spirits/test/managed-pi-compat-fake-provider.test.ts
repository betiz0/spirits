import { expect, test } from "bun:test";
import { requestFakeToolCall, startFakeProvider } from "../../../scripts/managed-pi-compat/fake-provider.ts";
import { executeCapturedTsrepl, createProbeTsreplTool } from "../../../scripts/managed-pi-compat/tsrepl.ts";

test("model tool call reaches tsrepl", async () => {
	const provider = startFakeProvider({ name: "tsrepl", arguments: { code: "return 1 + 1" } });
	try {
		const result = await requestFakeToolCall(provider.baseUrl, "tsrepl");
		expect(result.toolCalls[0]?.name).toBe("tsrepl");
		const cell = await executeCapturedTsrepl(
			createProbeTsreplTool(),
			String(result.toolCalls[0]?.arguments.code),
			process.cwd(),
		);
		expect(cell.text).toContain("2");
	} finally {
		provider.stop();
	}
});

test("no real credentials are read", async () => {
	const provider = startFakeProvider({ name: "tsrepl", arguments: { code: "return 2" } });
	try {
		await requestFakeToolCall(provider.baseUrl, "tsrepl");
		expect(provider.requests).toHaveLength(1);
		expect(provider.requests[0]?.authorization).toBe("Bearer fake");
	} finally {
		provider.stop();
	}
});

test("fake provider success is not reported as real provider compatibility", async () => {
	const provider = startFakeProvider({ name: "tsrepl", arguments: { code: "return 1" } });
	try {
		const result = await requestFakeToolCall(provider.baseUrl, "tsrepl");
		expect(result.label).toEqual({ scope: "fake-provider", realProviderCompatibility: false });
	} finally {
		provider.stop();
	}
});
