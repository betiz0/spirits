import { expect, test } from "bun:test";
import { RLM_MAX_TOOL_CALLS } from "../src/rlm/depth.ts";
import { buildRlmGuidance } from "../src/rlm/guidance.ts";

test("guidance root covers await, string, timeout, serial, limits", () => {
	const text = buildRlmGuidance({ depth: 0, maxDepth: 2 });
	expect(text).toContain("await rlm(");
	expect(text).toContain("文字列");
	expect(text).toContain("親の REPL 変数を見られません");
	expect(text).toContain("timeout");
	expect(text).toContain("直列");
	expect(text).toContain("深度上限は 2");
	expect(text).toContain(String(RLM_MAX_TOOL_CALLS));
});

test("guidance at depth limit omits usage example", () => {
	const text = buildRlmGuidance({ depth: 2, maxDepth: 2 });
	expect(text).toContain("呼ぶことはできません");
	expect(text).toContain("2");
	expect(text).not.toContain("await rlm(");
});

test("guidance child states parent and string return", () => {
	const text = buildRlmGuidance({ depth: 1, maxDepth: 2 });
	expect(text).toContain("親エージェントが `rlm` で起動した子");
	expect(text).toContain("文字列として返ります");
});

test("guidance child at depth limit keeps child note", () => {
	const text = buildRlmGuidance({ depth: 2, maxDepth: 2 });
	expect(text).toContain("親エージェントが `rlm` で起動した子");
	expect(text).not.toContain("await rlm(");
});

test("guidance uses depth constants", () => {
	const text = buildRlmGuidance({ depth: 0, maxDepth: 2 });
	expect(text).toContain(`${RLM_MAX_TOOL_CALLS} 回`);
});

test("guidance states maxDepth is absolute depth", () => {
	const root = buildRlmGuidance({ depth: 0, maxDepth: 2 });
	expect(root).toContain("絶対深度");

	const atLimit = buildRlmGuidance({ depth: 2, maxDepth: 2 });
	expect(atLimit).not.toContain("絶対深度");
});
